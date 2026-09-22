# Agent Director implementation roadmap

This fork keeps Blockout as the deterministic previs engine and adds a thin
**director layer** for AI agents. The target workflow is:

```
brief / references
      ↓
one compact shot plan
      ↓
Blockout geometry + camera + blocking
      ↓
single visual review sheet
      ↓
small repair pass
      ↓
Seedance reference package
```

The goal is not to turn Blockout into Blender or an image/video generator.
Blockout owns **space, camera, blocking, timing, and reviewable intent**.
Identity, location look, product appearance, wardrobe, and style remain separate
references for the downstream video model.

## Product principles

1. **Directing before prompting.** Agents choose shot intent, framing, lens
   language, blocking, and timing instead of manipulating Three.js objects one
   property at a time.
2. **One high-level mutation beats twenty low-level calls.** A complete shot
   should normally take fewer than five MCP calls.
3. **Review visually, not from logs.** One contact sheet should replace repeated
   screenshot calls.
4. **Human edits win.** Mutations can be bound to a reviewed state token; later
   phases add explicit human locks for approved camera/actor decisions.
5. **Motion and look are separate reference roles.** The grey-box MP4 carries
   camera/blocking/timing. External images carry identity, location, product,
   wardrobe, and style.
6. **Blender is the escape hatch, not the default backend.** Complex rigging or
   bespoke animation can still use the existing GLB handoff.

## Phase 1 — agent-efficient control surface

Implemented in the first branch:

- compact `get_state` with a stale-state token;
- `replace_scene`: atomic scene + blocking + shot blueprint in one undoable
  operation;
- director-mode MCP catalog: expose only the small everyday tool set by default;
- `list_camera_recipes` / `apply_camera_recipe`: directing vocabulary over
  the existing deterministic camera-move engine;
- `review_shot`: one multi-frame visual sheet for the active shot;
- `export_shot`: deterministic reference-package export through MCP;
- Seedance 2.5 generator profile based on ByteDance's official 2026-07-31
  release information.
- parametric proxy geometry for agent-built boxes, cylinders, ramps, walls,
  and stairs without invoking Blender.

Token target: a normal shot should need roughly:

```
get_state
compile_shot
review_shot
approve_hero_frame
export_shot
```

The full legacy tool catalog remains available with
`BLOCKOUT_MCP_FULL_TOOLS=1`.

## Phase 2 — human approval and hero-frame gate

Implemented in the current branch:

- persistent shot-level human locks for camera, lens, framing and staging;
- entity-track blocking locks;
- explicit hero-frame candidate + approval state;
- agent mutations reject protected staging/camera changes;
- review sheets preserve the hero-frame time even when frame count is capped;
- Seedance 2.5 MCP exports require an approved hero frame by default.

Also implemented:

- camera-keyframe selection jumps the playhead exactly to that mark;
- explicit “Edit camera pose at this mark” handoff into the Camera panel;
- desktop Hero Frame First approval + camera/lens/framing/staging lock controls.

Still to do:

- richer warning-frame selection in review sheets;
- per-actor blocking lock controls in the desktop UI.

## Phase 3 — operator layer

In progress. The camera vocabulary now carries structured `shotSize`,
`height`, `useCase`, lens and pacing metadata, with dedicated product,
vehicle, dialogue, observational and action recipes. The Camera panel groups
recipes by purpose and also supports arbitrary 8–300mm focal lengths.

Continue expanding camera recipes from a small execution vocabulary into structured
directing recipes:

```yaml
intent: reveal
shot_size: medium-wide
lens: 35
subject: vehicle
start: foreground-occluded
move: truck-right + slight-push
pacing: slow-in / smooth-out
end_composition: right-third
```

Sources for vocabulary and validation:

- EYECANDY visual-technique taxonomy;
- Blockout's existing deterministic camera moves;
- camera motions measured by Wasserman Motion Previs Studio;
- cinematography/directing references, not copied proprietary footage.

## Phase 4 — reference-role aware Seedance handoff

Seedance 2.5 officially supports up to 30-second generations and multimodal
reference inputs including white-model / motion references. Export packages
should therefore describe reference roles explicitly:

- motion / blocking / camera → Blockout MP4;
- composition beats → Blockout stills;
- character/product identity → external stills;
- location → external stills/video;
- visual style → external style frames;
- audio → external audio references.

Blockout should not fabricate the look reference. It should make the spatial
reference unambiguous.

Official model reference:
https://seed.bytedance.com/en/blog/one-take-creation-flexible-referencing-introducing-seedance-2-5

## Phase 5 — measured-reference workflow

Partially implemented: `import_motion_previs_camera` now consumes Motion Previs
Studio v4 `camera_motion.json`, anchors the measured move to the current
Blockout camera, retimes it to the shot (or adopts source duration), and writes
editable Blockout camera marks. The source JSON is copied into the project for
provenance.

Keep Motion Previs Studio separate and use its existing analysis pipeline:

```
film / ad / phone reference
      ↓
Motion Previs Studio
camera_motion + pose + depth
      ↓
Blockout ghost reference / measured camera import
      ↓
new staging with measured camera language
```

Do not reimplement optical-flow camera solving inside Blockout unless the
existing handoff proves insufficient.

## Phase 6 — optional UX work

Only after real Seedance tests:

- WASD/QE fly navigation;
- RU/EN localization;
- faster camera-mark editor;
- reusable project-level Character / Location / Vehicle reference cards;
- revision/checkpoint UI.

## Acceptance gates

A feature is not done because an MCP call returned `ok`.

For every major change:

1. `npm run typecheck`
2. `npm run lint`
3. `npm test`
4. `npm run smoke` for renderer/export/control changes
5. Visual proof: representative frames must visibly differ when the shot is
   changed.
6. Product proof: periodically feed a real exported package to Seedance and
   judge whether camera, blocking, screen direction, and timing are followed.

## Upstream / fork policy

Base new work on the current `wassermanproductions/blockout`. Useful fork ideas
are reimplemented against the current architecture instead of wholesale
cherry-picking stale forks. Preserve Apache-2.0 NOTICE/attribution.
