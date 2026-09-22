#!/usr/bin/env node
// Modified for cross-platform Windows support in 2026; see MODIFICATIONS.md.
/**
 * Blockout MCP server — zero-dependency Node >=18 stdio bridge.
 *
 * Speaks the MCP stdio transport: newline-delimited JSON-RPC 2.0 on
 * stdin/stdout (NOT Content-Length framed). Each tools/call is forwarded to
 * the running app's HTTP control server, discovered via
 * Blockout's platform config directory (random localhost port + bearer token).
 *
 * Uses only node built-ins + global fetch — run directly with `node`.
 */

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'

function configDir() {
  if (process.env.BLOCKOUT_CONFIG_DIR?.trim()) return process.env.BLOCKOUT_CONFIG_DIR.trim()
  if (process.platform === 'win32') {
    const namespace = process.env.BLOCKOUT_CONFIG_NAMESPACE || 'blockout'
    const segments = namespace.split(/[\\/]+/).filter((part) => part && part !== '.' && part !== '..')
    return join(
      process.env.APPDATA || join(homedir(), 'AppData', 'Roaming'),
      ...(segments.length > 0 ? segments : ['blockout'])
    )
  }
  return join(homedir(), '.config', 'blockout')
}

const DISCOVERY_FILES = process.env.BLOCKOUT_CONFIG_DIR?.trim()
  ? [join(configDir(), 'control.json')]
  : [...new Set([
      join(configDir(), 'control.json'),
      // Legacy descriptor location; descriptors without protocolVersion remain valid.
      join(homedir(), '.config', 'blockout', 'control.json')
    ])]
const PROTOCOL_VERSION = '2024-11-05'

/* --------------------------------- tools -------------------------------- */

// Each tool name maps to a control action of the SAME name; the tool's input
// object is passed through verbatim as that action's params.
const TOOLS = [
  {
    name: 'get_state',
    description:
      'Call FIRST. Returns compact project/scene/shot state plus stateToken. Use detail="full" only when exact actor/camera marks are required. Coordinates: meters, +X right, -Z forward; heading 0 faces -Z.',
    inputSchema: {
      type: 'object',
      properties: {
        detail: { type: 'string', enum: ['compact', 'full'], description: 'Default compact to save context.' }
      },
      additionalProperties: false
    }
  },
  {
    name: 'list_assets',
    description:
      'List the placeable asset catalog (people, animals, vehicles, furniture, environment kits, primitives). Use an assetId from here with add_entity. Optionally filter by category.',
    inputSchema: {
      type: 'object',
      properties: {
        category: {
          type: 'string',
          description: 'Optional category filter, e.g. "people", "vehicles", "environment".'
        }
      },
      additionalProperties: false
    }
  },
  {
    name: 'replace_scene',
    description:
      'Agent-first atomic shot blueprint. Replaces current staging + actor marks and updates the active shot in ONE undoable mutation. Requires the stateToken from get_state so human edits cannot be overwritten silently.',
    inputSchema: {
      type: 'object',
      properties: {
        _expectedStateToken: { type: 'string', description: 'Exact stateToken from the reviewed get_state result.' },
        lighting: { type: 'string', description: 'Optional Blockout lighting preset id.' },
        entities: {
          type: 'array',
          minItems: 1,
          maxItems: 32,
          items: {
            type: 'object',
            properties: {
              key: { type: 'string', description: 'Stable blueprint key used by trackEntityKey.' },
              assetId: { type: 'string' },
              name: { type: 'string' },
              label: { type: 'string' },
              x: { type: 'number' },
              y: { type: 'number' },
              z: { type: 'number' },
              rotationDeg: { type: 'number' },
              scale: { type: 'number', description: 'Uniform entity scale.' },
              params: {
                type: 'object',
                description: 'Asset parameters. Primitives: cube/ramp/wall width,height,depth; cylinder radius,height; stairs width,height,depth,steps.',
                additionalProperties: true
              },
              marks: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    time: { type: 'number' },
                    x: { type: 'number' },
                    y: { type: 'number' },
                    z: { type: 'number' },
                    gait: { type: 'string' },
                    hold: { type: 'number' },
                    easeIn: { type: 'number' },
                    easeOut: { type: 'number' },
                    headingDeg: { type: 'number' },
                    joints: { type: 'object', additionalProperties: { type: 'number' } }
                  },
                  additionalProperties: false
                }
              }
            },
            required: ['assetId'],
            additionalProperties: false
          }
        },
        shot: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            duration: { type: 'number' },
            fps: { type: 'number' },
            aspect: { type: 'string' },
            rig: { type: 'string' },
            notes: { type: 'string' },
            trackEntityKey: { type: 'string' },
            cameraMarks: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  time: { type: 'number' },
                  x: { type: 'number' },
                  y: { type: 'number' },
                  z: { type: 'number' },
                  panDeg: { type: 'number' },
                  tiltDeg: { type: 'number' },
                  rollDeg: { type: 'number' },
                  focalLength: { type: 'number' },
                  focusDistance: { type: 'number' },
                  hold: { type: 'number' },
                  easeIn: { type: 'number' },
                  easeOut: { type: 'number' }
                },
                additionalProperties: false
              }
            }
          },
          additionalProperties: false
        }
      },
      required: ['_expectedStateToken', 'entities', 'shot'],
      additionalProperties: false
    }
  },
  {
    name: 'export_shot_plan',
    description:
      'Export the active Blockout scene/shot as a portable .shot.json Director Shot Plan for ChatGPT, Codex, Claude or file handoff.',
    inputSchema: {
      type: 'object',
      properties: {
        source: { type: 'string' },
        note: { type: 'string' }
      },
      additionalProperties: false
    }
  },
  {
    name: 'import_shot_plan',
    description:
      'Import a portable Blockout .shot.json Director Shot Plan and compile it through the exact same path used by ChatGPT/Codex.',
    inputSchema: {
      type: 'object',
      properties: {
        _expectedStateToken: { type: 'string' },
        filePath: { type: 'string', description: 'Absolute path to a .shot.json file.' }
      },
      required: ['_expectedStateToken', 'filePath'],
      additionalProperties: false
    }
  },
  {
    name: 'compile_shot',
    description:
      'Preferred director tool. In one request: atomically replace staging/blocking/shot, optionally apply a high-level camera recipe, and set directing intent + hero-frame candidate. Requires the reviewed stateToken.',
    inputSchema: {
      type: 'object',
      properties: {
        _expectedStateToken: { type: 'string' },
        intent: { type: 'string', description: 'Short directing intent, e.g. "quiet product reveal".' },
        cameraRecipeId: { type: 'string', description: 'Optional recipe from list_camera_recipes.' },
        cameraSubjectKey: { type: 'string', description: 'Entity key from entities[] used as the camera-recipe subject.' },
        heroFrameTime: { type: 'number', description: 'Candidate representative frame time in seconds; approval happens separately.' },
        lighting: { type: 'string' },
        entities: {
          type: 'array',
          minItems: 1,
          maxItems: 32,
          items: {
            type: 'object',
            properties: {
              key: { type: 'string' },
              assetId: { type: 'string' },
              name: { type: 'string' },
              label: { type: 'string' },
              x: { type: 'number' },
              y: { type: 'number' },
              z: { type: 'number' },
              rotationDeg: { type: 'number' },
              scale: { type: 'number', description: 'Uniform entity scale.' },
              params: {
                type: 'object',
                description: 'Asset parameters. Primitives: cube/ramp/wall width,height,depth; cylinder radius,height; stairs width,height,depth,steps.',
                additionalProperties: true
              },
              marks: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    time: { type: 'number' },
                    x: { type: 'number' },
                    y: { type: 'number' },
                    z: { type: 'number' },
                    gait: { type: 'string' },
                    hold: { type: 'number' },
                    easeIn: { type: 'number' },
                    easeOut: { type: 'number' },
                    headingDeg: { type: 'number' },
                    joints: { type: 'object', additionalProperties: { type: 'number' } }
                  },
                  additionalProperties: false
                }
              }
            },
            required: ['key', 'assetId'],
            additionalProperties: false
          }
        },
        shot: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            duration: { type: 'number' },
            fps: { type: 'number' },
            aspect: { type: 'string' },
            rig: { type: 'string' },
            notes: { type: 'string' },
            trackEntityKey: { type: 'string' },
            cameraMarks: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  time: { type: 'number' },
                  x: { type: 'number' },
                  y: { type: 'number' },
                  z: { type: 'number' },
                  panDeg: { type: 'number' },
                  tiltDeg: { type: 'number' },
                  rollDeg: { type: 'number' },
                  focalLength: { type: 'number' },
                  focusDistance: { type: 'number' },
                  hold: { type: 'number' },
                  easeIn: { type: 'number' },
                  easeOut: { type: 'number' }
                },
                additionalProperties: false
              }
            }
          },
          additionalProperties: false
        }
      },
      required: ['_expectedStateToken', 'entities', 'shot'],
      additionalProperties: false
    }
  },
  {
    name: 'add_entity',
    description:
      'Place a new entity on the ground. x/z in meters (+X right, -Z away); rotationDeg is clockwise from above with 0 facing -Z. Returns the new entity id.',
    inputSchema: {
      type: 'object',
      properties: {
        assetId: { type: 'string', description: 'An id from list_assets, e.g. "person.man".' },
        x: { type: 'number', description: 'X position in meters (+X right).' },
        z: { type: 'number', description: 'Z position in meters (-Z forward/away).' },
        label: { type: 'string', description: 'Optional short uppercase label, e.g. "HERO".' },
        rotationDeg: { type: 'number', description: 'Optional heading in degrees, clockwise from above; 0 faces -Z.' }
      },
      required: ['assetId', 'x', 'z'],
      additionalProperties: false
    }
  },
  {
    name: 'move_entity',
    description: 'Reposition an existing entity. Omitted fields are left unchanged.',
    inputSchema: {
      type: 'object',
      properties: {
        entityId: { type: 'string', description: 'Entity id from get_state.' },
        x: { type: 'number', description: 'X in meters (+X right).' },
        z: { type: 'number', description: 'Z in meters (-Z away).' },
        y: { type: 'number', description: 'Optional height in meters above ground.' },
        rotationDeg: { type: 'number', description: 'Optional heading, clockwise from above; 0 faces -Z.' }
      },
      required: ['entityId', 'x', 'z'],
      additionalProperties: false
    }
  },
  {
    name: 'delete_entity',
    description: 'Remove an entity from the scene.',
    inputSchema: {
      type: 'object',
      properties: { entityId: { type: 'string', description: 'Entity id from get_state.' } },
      required: ['entityId'],
      additionalProperties: false
    }
  },
  {
    name: 'add_actor_mark',
    description:
      'Drop a timeline mark for an actor entity: at time t (seconds) the actor is at x,z. Chain marks to choreograph a walk. gait sets the movement style between marks.',
    inputSchema: {
      type: 'object',
      properties: {
        entityId: { type: 'string', description: 'The actor entity id.' },
        x: { type: 'number', description: 'X in meters (+X right).' },
        z: { type: 'number', description: 'Z in meters (-Z away).' },
        time: { type: 'number', description: 'Time of the mark in seconds.' },
        gait: {
          type: 'string',
          enum: ['walk', 'jog', 'run', 'stand'],
          description: 'Movement style approaching this mark.'
        }
      },
      required: ['entityId', 'x', 'z', 'time'],
      additionalProperties: false
    }
  },
  {
    name: 'add_camera_mark',
    description:
      'Drop a camera mark at time t: camera at x,y,z (meters, y is height) looking with panDeg (clockwise from above, 0 faces -Z) and tiltDeg (positive looks up, negative down). focalLength in mm on Super 35 (24 wide, 35 normal, 50-85 tight).',
    inputSchema: {
      type: 'object',
      properties: {
        x: { type: 'number', description: 'Camera X in meters (+X right).' },
        y: { type: 'number', description: 'Camera height in meters above ground.' },
        z: { type: 'number', description: 'Camera Z in meters (-Z away).' },
        panDeg: { type: 'number', description: 'Pan in degrees, clockwise from above; 0 faces -Z.' },
        tiltDeg: { type: 'number', description: 'Tilt in degrees; positive up, negative down.' },
        time: { type: 'number', description: 'Time of the mark in seconds.' },
        focalLength: { type: 'number', description: 'Optional focal length in mm (Super 35).' }
      },
      required: ['x', 'y', 'z', 'panDeg', 'tiltDeg', 'time'],
      additionalProperties: false
    }
  },
  {
    name: 'clear_camera_marks',
    description: 'Remove all camera marks from the active shot (keeps actor marks).',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false }
  },
  {
    name: 'set_shot',
    description: 'Update the active shot settings. Omitted fields are unchanged.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Shot name.' },
        duration: { type: 'number', description: 'Shot duration in seconds.' },
        aspect: { type: 'string', description: 'Aspect ratio, e.g. "16:9", "9:16", "2.39:1".' },
        fps: { type: 'number', description: 'Frames per second.' }
      },
      additionalProperties: false
    }
  },
  {
    name: 'new_shot',
    description: 'Create a new shot in the current scene (same blocking, fresh camera). Returns the new shot.',
    inputSchema: {
      type: 'object',
      properties: { name: { type: 'string', description: 'Optional name for the new shot.' } },
      additionalProperties: false
    }
  },
  {
    name: 'apply_framing',
    description:
      'Auto-frame the camera using a preset relative to the labelled subjects: 2S (two-shot), OTS (over-the-shoulder), REV (reverse), TOP (top-down), LOW (low angle), DUTCH (canted).',
    inputSchema: {
      type: 'object',
      properties: {
        kind: {
          type: 'string',
          enum: ['2S', 'OTS', 'REV', 'TOP', 'LOW', 'DUTCH'],
          description: 'Framing preset.'
        }
      },
      required: ['kind'],
      additionalProperties: false
    }
  },
  {
    name: 'list_action_presets',
    description:
      'List motion-path presets for non-character performers: plane takeoff/landing/flyby, helicopter orbit, bird swoop, car chase moves, falling debris, thrown objects. Call before apply_action_preset.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false }
  },
  {
    name: 'apply_action_preset',
    description:
      "Lay a full motion path (with altitude) on an entity from its current pose: plane-takeoff, heli-orbit, car-chase-weave, debris-fall… Replaces the entity's existing marks.",
    inputSchema: {
      type: 'object',
      properties: {
        entityId: { type: 'string', description: 'Entity id from get_state.' },
        presetId: { type: 'string', description: 'Preset id from list_action_presets.' }
      },
      required: ['entityId', 'presetId'],
      additionalProperties: false
    }
  },
  {
    name: 'list_sequence_styles',
    description: 'List the styles available per sequence type for spawn_sequence (dance styles, fight formats, chase modes).',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false }
  },
  {
    name: 'spawn_sequence',
    description:
      'Stage a whole choreographed crowd in one call: N dancers performing together, a paired brawl or mob fight, a foot chase, or a car chase. Creates the performers AND their choreography. Position with x/z/headingDeg (heading 0 faces -Z).',
    inputSchema: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['dance', 'fight', 'footChase', 'carChase'] },
        count: { type: 'number', description: 'Number of performers (2-60).' },
        style: { type: 'string', description: 'Style id from list_sequence_styles (e.g. a dance preset id, "paired", "weaving").' },
        x: { type: 'number', description: 'Stage center X in meters (default 0).' },
        z: { type: 'number', description: 'Stage center Z in meters (default 0).' },
        headingDeg: { type: 'number', description: 'Facing/travel direction in degrees (default 0).' }
      },
      required: ['type', 'count'],
      additionalProperties: false
    }
  },
  {
    name: 'list_choreography_options',
    description:
      'Discover the choreography vocabulary before spawn_choreography / choreograph_entities: the kinds (dance/fight/chase), the styles per kind, the dance formations, and the endings per kind.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false }
  },
  {
    name: 'spawn_choreography',
    description:
      'Stage a full choreography routine — a dance number, a paired or one-vs-many fight, or a foot chase — spawning fresh performers AND their per-beat blocking in one call. Reads as real staged choreography: dances hit on the count and change formation, fights are paired attack→reaction exchanges that stay in range, chases run a serpentine path with near-misses. Position with x/z and headingDeg (heading 0 faces -Z). Call list_choreography_options for the vocabulary.',
    inputSchema: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['dance', 'fight', 'chase'], description: 'Routine type.' },
        performers: { type: 'number', description: 'Number of performers (dance 1-40, fight 2-8, chase 2-6; clamped per kind).' },
        durationS: { type: 'number', description: 'Seconds to fill (defaults to the active shot duration).' },
        style: { type: 'string', description: 'Style id from list_choreography_options (dance: hiphop/party/latin/robot/mixed; fight: brawl/martial-arts/sparring).' },
        bpm: { type: 'number', description: 'Dance tempo in beats/min (default 116).' },
        formation: {
          type: 'string',
          enum: ['line', 'twoRows', 'vShape', 'circle', 'diamond'],
          description: 'Dance starting formation.'
        },
        canon: { type: 'boolean', description: 'Dance: stagger performers into a wave (canon).' },
        mirror: { type: 'boolean', description: 'Dance: mirror odd performers (fight: mirror stances).' },
        formationChange: { type: 'boolean', description: 'Dance: walk to a fresh formation between phrases.' },
        ending: { type: 'string', description: 'Fight: finish | sparring. Chase: caught | escape.' },
        seed: { type: 'number', description: 'Optional PRNG seed for repeatable results (randomized if omitted).' },
        x: { type: 'number', description: 'Stage center X in meters (default 0).' },
        z: { type: 'number', description: 'Stage center Z in meters (default 0).' },
        headingDeg: { type: 'number', description: 'Facing / travel direction in degrees (default 0).' }
      },
      required: ['kind', 'performers'],
      additionalProperties: false
    }
  },
  {
    name: 'choreograph_entities',
    description:
      'Retarget existing PERSON entities into a choreography routine: keeps their assets and labels but replaces their timeline with a fresh dance/fight/chase built around the group. Same routine options as spawn_choreography, plus entityIds. The performer count comes from the list and the routine centers on the group, so there is no x/z.',
    inputSchema: {
      type: 'object',
      properties: {
        entityIds: { type: 'array', items: { type: 'string' }, description: 'Person entity ids from get_state.' },
        kind: { type: 'string', enum: ['dance', 'fight', 'chase'], description: 'Routine type.' },
        style: { type: 'string', description: 'Style id from list_choreography_options.' },
        durationS: { type: 'number', description: 'Seconds to fill (defaults to the active shot duration).' },
        bpm: { type: 'number', description: 'Dance tempo in beats/min (default 116).' },
        formation: {
          type: 'string',
          enum: ['line', 'twoRows', 'vShape', 'circle', 'diamond'],
          description: 'Dance starting formation.'
        },
        canon: { type: 'boolean', description: 'Dance: stagger performers into a wave (canon).' },
        mirror: { type: 'boolean', description: 'Dance: mirror odd performers (fight: mirror stances).' },
        formationChange: { type: 'boolean', description: 'Dance: walk to a fresh formation between phrases.' },
        ending: { type: 'string', description: 'Fight: finish | sparring. Chase: caught | escape.' },
        seed: { type: 'number', description: 'Optional PRNG seed (randomized if omitted).' }
      },
      required: ['entityIds', 'kind'],
      additionalProperties: false
    }
  },
  {
    name: 'list_motion_presets',
    description:
      'List the single-performer motion-preset library (fight / dance / gesture / everyday / sport / stunt) as { id, name, category, duration }. These are the motions choreography routines are built from. Optionally filter by category.',
    inputSchema: {
      type: 'object',
      properties: {
        category: {
          type: 'string',
          enum: ['fight', 'dance', 'gesture', 'stunt', 'sport', 'everyday'],
          description: 'Optional category filter.'
        }
      },
      additionalProperties: false
    }
  },
  {
    name: 'list_camera_moves',
    description:
      'List the classic camera-move presets (orbits, cranes, drone follows, vertigo dolly-zoom, whip pan…) with ids, categories, and descriptions. Call before apply_camera_move.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false }
  },
  {
    name: 'apply_camera_move',
    description:
      "Apply a classic camera-move preset to the active shot camera: generates a full set of camera marks over the shot built around a subject, riding along if the subject moves (e.g. drone-follow a flying plane). Track-style moves also enable aim-lock. Replaces the camera's existing marks.",
    inputSchema: {
      type: 'object',
      properties: {
        presetId: {
          type: 'string',
          description:
            'Preset id from list_camera_moves (e.g. "orbit-180", "follow-behind", "vertigo-dolly-zoom").'
        },
        entityId: {
          type: 'string',
          description: 'Subject to build the move around. Omit to use the first person in the scene.'
        }
      },
      required: ['presetId'],
      additionalProperties: false
    }
  },
  {
    name: 'list_camera_recipes',
    description:
      'Small directing vocabulary over the raw camera catalog. Recipes describe intent, shot function, suggested lens and pacing, then execute through deterministic Blockout camera moves.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false }
  },
  {
    name: 'apply_camera_recipe',
    description:
      'Apply one director-level camera recipe around a subject. Requires stateToken so a reviewed human edit is not silently overwritten.',
    inputSchema: {
      type: 'object',
      properties: {
        _expectedStateToken: { type: 'string', description: 'Exact stateToken from get_state or review_shot.' },
        recipeId: { type: 'string', description: 'Recipe id from list_camera_recipes.' },
        entityId: { type: 'string', description: 'Optional subject entity id.' }
      },
      required: ['_expectedStateToken', 'recipeId'],
      additionalProperties: false
    }
  },
  {
    name: 'set_human_locks',
    description:
      'Protect human-approved decisions from agent mutations. Camera/framing locks block camera recipes; lens preserves focal lengths; staging/blocking locks block atomic shot-plan replacement.',
    inputSchema: {
      type: 'object',
      properties: {
        _expectedStateToken: { type: 'string' },
        camera: { type: 'boolean' },
        lens: { type: 'boolean' },
        framing: { type: 'boolean' },
        staging: { type: 'boolean' },
        blockingEntityIds: { type: 'array', items: { type: 'string' } }
      },
      required: ['_expectedStateToken'],
      additionalProperties: false
    }
  },
  {
    name: 'approve_hero_frame',
    description:
      'Approve the representative frame after review. By default locks camera, lens, and framing so the approved composition cannot be silently changed by later agent work.',
    inputSchema: {
      type: 'object',
      properties: {
        _expectedStateToken: { type: 'string' },
        time: { type: 'number', description: 'Hero-frame time; defaults to current playhead.' },
        lockCamera: { type: 'boolean', description: 'Default true.' },
        lockLens: { type: 'boolean', description: 'Default true.' },
        lockFraming: { type: 'boolean', description: 'Default true.' }
      },
      required: ['_expectedStateToken'],
      additionalProperties: false
    }
  },
  {
    name: 'set_track_subject',
    description:
      'Aim-lock the shot camera onto an entity: the camera stays pointed at it no matter how its position moves (marks, recordings, presets). Pass no entityId to turn tracking off.',
    inputSchema: {
      type: 'object',
      properties: {
        entityId: { type: 'string', description: 'Entity id to track; omit to disable tracking.' }
      },
      additionalProperties: false
    }
  },
  {
    name: 'snap_to_ground',
    description: 'Drop an entity so it rests on the ground plane (y = 0 at its feet).',
    inputSchema: {
      type: 'object',
      properties: { entityId: { type: 'string', description: 'Entity id from get_state.' } },
      required: ['entityId'],
      additionalProperties: false
    }
  },
  {
    name: 'set_time',
    description: 'Scrub the timeline playhead to time t (seconds).',
    inputSchema: {
      type: 'object',
      properties: { t: { type: 'number', description: 'Time in seconds.' } },
      required: ['t'],
      additionalProperties: false
    }
  },
  {
    name: 'play',
    description: 'Start timeline playback from the current playhead.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false }
  },
  {
    name: 'stop',
    description: 'Stop timeline playback.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false }
  },
  {
    name: 'review_shot',
    description:
      'Render 2–9 representative moments of the ACTIVE shot into ONE contact sheet. Prefer this over repeated screenshots. Returns the sheet plus the current stateToken.',
    inputSchema: {
      type: 'object',
      properties: {
        _expectedStateToken: { type: 'string', description: 'Optional token to ensure you are reviewing the state you expect.' },
        maxFrames: { type: 'number', description: '2–9 frames, default 6.' }
      },
      additionalProperties: false
    }
  },
  {
    name: 'save_visual_checkpoint',
    description:
      'Save one compact WebP phase board showing sequential animation/camera phases plus JSON metadata. Use this for durable dailies/hero visual memory; use review_shot for temporary inspection.',
    inputSchema: {
      type: 'object',
      properties: {
        _expectedStateToken: { type: 'string' },
        kind: { type: 'string', enum: ['daily', 'hero'] },
        maxFrames: { type: 'number', description: '2–12 sequential phases; default 8.' },
        source: { type: 'string', description: 'human, chatgpt, codex, import, etc.' },
        note: { type: 'string' }
      },
      additionalProperties: false
    }
  },
  {
    name: 'export_shot',
    description:
      'Export the active shot as a deterministic generator-reference package. Default is a lean motion-reference MP4 + stills + prompt + metadata/reference roles; depth/normal are opt-in.',
    inputSchema: {
      type: 'object',
      properties: {
        _expectedStateToken: { type: 'string', description: 'Optional reviewed state token.' },
        profileId: { type: 'string', description: 'Generator profile, e.g. seedance-2.5.' },
        clean: { type: 'boolean' },
        depth: { type: 'boolean' },
        normal: { type: 'boolean' },
        labels: { type: 'string', enum: ['on', 'stillsOnly', 'off'] },
        resolution: { type: 'string', enum: ['auto', '720p', '1080p'] },
        requireApprovedHeroFrame: {
          type: 'boolean',
          description: 'Defaults true for seedance-2.5; set false only for exploratory exports.'
        }
      },
      additionalProperties: false
    }
  },
  {
    name: 'screenshot',
    description:
      'Capture the current viewport as a PNG image and return it. Use after staging or scrubbing to see what the shot looks like.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false }
  },
  {
    name: 'list_presets',
    description: 'List saved global stage presets (reusable staging setups) as { id, name, savedAt, entityCount }.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false }
  },
  {
    name: 'save_preset',
    description: 'Save the current staging as a named global preset for reuse across projects.',
    inputSchema: {
      type: 'object',
      properties: { name: { type: 'string', description: 'Name for the preset.' } },
      required: ['name'],
      additionalProperties: false
    }
  },
  {
    name: 'apply_preset',
    description: 'Load a saved stage preset by id into the current scene.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'Preset id from list_presets.' } },
      required: ['id'],
      additionalProperties: false
    }
  },
  {
    name: 'import_scan',
    description:
      "Import a Gaussian-splat / photogrammetry scan (.ply/.splat/.spz/.ksplat) as an environment. The file is copied into the project's scans/ folder and attached to the current scene. Scans are editor-only reference geometry — visible while you block, never rendered into any export pass. Returns the created scan (id, name, transform).",
    inputSchema: {
      type: 'object',
      properties: {
        sourcePath: { type: 'string', description: 'Absolute path to the scan file (.ply/.splat/.spz/.ksplat).' }
      },
      required: ['sourcePath'],
      additionalProperties: false
    }
  },
  {
    name: 'set_scan_transform',
    description:
      'Position, rotate, scale, flip, or show/hide an imported scan. Omitted fields are left unchanged; position merges onto the current position. Set flipped:true to right an upside-down .splat export.',
    inputSchema: {
      type: 'object',
      properties: {
        scanId: { type: 'string', description: 'Scan id from get_state or import_scan.' },
        position: {
          type: 'object',
          properties: {
            x: { type: 'number', description: 'X in meters (+X right).' },
            y: { type: 'number', description: 'Y in meters (height).' },
            z: { type: 'number', description: 'Z in meters (-Z away).' }
          },
          additionalProperties: false,
          description: 'World position (partial; merged onto the current position).'
        },
        rotationDeg: { type: 'number', description: 'Yaw in degrees, clockwise from above.' },
        scale: { type: 'number', description: 'Uniform scale (min 0.01).' },
        visible: { type: 'boolean', description: 'Editor-viewport visibility.' },
        flipped: { type: 'boolean', description: 'Pitch the scan 180° to right upside-down (Y-down) .splat exports.' }
      },
      required: ['scanId'],
      additionalProperties: false
    }
  },
  {
    name: 'remove_scan',
    description: 'Remove an imported scan from the current scene (the copied file is left on disk).',
    inputSchema: {
      type: 'object',
      properties: { scanId: { type: 'string', description: 'Scan id from get_state or import_scan.' } },
      required: ['scanId'],
      additionalProperties: false
    }
  },
  {
    name: 'import_motion_previs_camera',
    description:
      'Import a Motion Previs Studio v4 camera_motion.json as editable Blockout camera marks, anchored to the current shot camera. This is for measured camera language from a film/ad/reference, not for look/identity.',
    inputSchema: {
      type: 'object',
      properties: {
        _expectedStateToken: { type: 'string' },
        cameraMotionPath: { type: 'string', description: 'Absolute path to camera_motion.json from a Motion Previs bundle.' },
        targetFps: { type: 'number', description: 'Imported camera-mark density, 1–24fps; default 6.' },
        durationMode: {
          type: 'string',
          enum: ['fit-shot', 'source'],
          description: 'fit-shot retimes measured motion to current shot duration; source adopts Motion Previs duration.'
        }
      },
      required: ['_expectedStateToken', 'cameraMotionPath'],
      additionalProperties: false
    }
  },
  {
    name: 'set_reference',
    description:
      'Attach a reference video to the active shot (the Motion Previs Studio handoff v1). The clip is copied into the project’s refs/ folder and shown as a ghost underlay (or picture-in-picture) so you can match blocking against it by eye. videoPath is an absolute path to the source clip.',
    inputSchema: {
      type: 'object',
      properties: {
        handoffVersion: {
          type: 'number',
          enum: [1],
          description: 'Motion Previs handoff protocol version. Omit only for legacy clients.'
        },
        videoPath: { type: 'string', description: 'Absolute path to the reference video file.' },
        mode: { type: 'string', enum: ['ghost', 'pip'], description: 'Underlay style: ghost overlay (default) or picture-in-picture.' },
        opacity: { type: 'number', description: 'Underlay opacity 0..1 (default 0.5).' }
      },
      required: ['videoPath'],
      additionalProperties: false
    }
  }
]

const DIRECTOR_TOOL_NAMES = new Set([
  'get_state',
  'list_assets',
  'compile_shot',
  'import_shot_plan',
  'export_shot_plan',
  'list_camera_recipes',
  'apply_camera_recipe',
  'review_shot',
  'approve_hero_frame',
  'set_human_locks',
  'save_visual_checkpoint',
  'export_shot',
  'import_motion_previs_camera',
  'set_reference'
])

const EXPOSED_TOOLS =
  process.env.BLOCKOUT_MCP_FULL_TOOLS === '1'
    ? TOOLS
    : TOOLS.filter((tool) => DIRECTOR_TOOL_NAMES.has(tool.name))

const TOOL_NAMES = new Set(EXPOSED_TOOLS.map((t) => t.name))

/* ------------------------------ control call ---------------------------- */

const NOT_RUNNING = "Blockout isn't running — launch the app first."

async function callControl(action, params) {
  let config
  for (const file of DISCOVERY_FILES) {
    try {
      const candidate = JSON.parse(await readFile(file, 'utf-8'))
      if (Number.isInteger(candidate?.port) && typeof candidate?.token === 'string') {
        config = candidate
        break
      }
    } catch {
      // Try the next current/legacy discovery location.
    }
  }
  if (!config || (config.protocolVersion !== undefined && config.protocolVersion !== 1) ||
    (config.app !== undefined && config.app !== 'blockout')) {
    return { error: NOT_RUNNING }
  }
  try {
    const res = await fetch(`http://127.0.0.1:${config.port}/rpc`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.token}`
      },
      body: JSON.stringify({ action, params: params ?? {} })
    })
    return { response: await res.json() }
  } catch {
    return { error: NOT_RUNNING }
  }
}

/* ---------------------------- JSON-RPC plumbing ------------------------- */

function write(msg) {
  process.stdout.write(JSON.stringify(msg) + '\n')
}

function reply(id, result) {
  write({ jsonrpc: '2.0', id, result })
}

function replyError(id, code, message) {
  write({ jsonrpc: '2.0', id, error: { code, message } })
}

async function handleToolCall(id, params) {
  const name = params?.name
  const args = params?.arguments ?? {}
  if (!TOOL_NAMES.has(name)) {
    reply(id, { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true })
    return
  }
  const { response, error } = await callControl(name, args)
  if (error) {
    reply(id, { content: [{ type: 'text', text: error }], isError: true })
    return
  }
  // Image result can also carry tiny structured metadata (review times/state token)
  // so the agent does not need a second state call after visual review.
  if (response && response.ok && response.data && typeof response.data.imageBase64 === 'string') {
    const { imageBase64, ...meta } = response.data
    const content = [{ type: 'image', data: imageBase64, mimeType: 'image/png' }]
    if (Object.keys(meta).length > 0) content.push({ type: 'text', text: JSON.stringify(meta) })
    reply(id, { content })
    return
  }
  reply(id, {
    content: [{ type: 'text', text: JSON.stringify(response) }],
    isError: response && response.ok === false
  })
}

async function handle(msg) {
  const { id, method, params } = msg
  switch (method) {
    case 'initialize':
      reply(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: 'blockout', version: '1.1.0-director' }
      })
      return
    case 'notifications/initialized':
      return // notification, no reply
    case 'tools/list':
      reply(id, { tools: EXPOSED_TOOLS })
      return
    case 'tools/call':
      await handleToolCall(id, params)
      return
    case 'ping':
      reply(id, {})
      return
    default:
      // Notifications (no id) are ignored; requests get method-not-found.
      if (id !== undefined && id !== null) replyError(id, -32601, `Method not found: ${method}`)
      return
  }
}

/* ------------------------------- stdin loop ----------------------------- */

let buffer = ''
process.stdin.setEncoding('utf-8')
process.stdin.on('data', (chunk) => {
  buffer += chunk
  let idx
  while ((idx = buffer.indexOf('\n')) !== -1) {
    const line = buffer.slice(0, idx).trim()
    buffer = buffer.slice(idx + 1)
    if (!line) continue
    let msg
    try {
      msg = JSON.parse(line)
    } catch {
      continue // ignore non-JSON lines
    }
    void handle(msg)
  }
})
process.stdin.on('end', () => process.exit(0))
