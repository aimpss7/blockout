/**
 * Agent/director helpers.
 *
 * Pure TypeScript: no DOM, Three.js, Electron, time, or randomness. This module
 * keeps the agent-facing directing vocabulary compact and deterministic.
 */

import type { ProjectDoc } from './types'

export type DirectingIntent =
  | 'intimacy'
  | 'reveal'
  | 'hero'
  | 'menace'
  | 'follow'
  | 'orientation'
  | 'spectacle'
  | 'disorientation'
  | 'energy'
  | 'observation'
  | 'product'

export interface CameraRecipe {
  id: string
  name: string
  intent: DirectingIntent
  /** Existing deterministic camera-move preset used as the execution layer. */
  presetId: string
  /** Creative function, not implementation detail. */
  shotFunction: string
  /** Suggested lens for the move. Null means preserve the preset's lens logic. */
  defaultLens: number | null
  pacing: 'slow' | 'measured' | 'fast'
  /** Suggested framing language for humans/agents; execution remains editable. */
  shotSize?: 'EWS' | 'WS' | 'FS' | 'MS' | 'MCU' | 'CU' | 'ECU'
  /** Suggested camera-height language. */
  height?: 'ground' | 'low' | 'eye' | 'high' | 'overhead'
  /** Editorial use, e.g. product, dialogue, vehicle, establishing. */
  useCase?: 'character' | 'dialogue' | 'product' | 'vehicle' | 'environment' | 'action'
  description: string
}

/**
 * High-level camera vocabulary for agents. Keep this deliberately much smaller
 * than the raw camera-move catalog: agents choose an intent, Blockout executes
 * the geometry through the existing deterministic preset engine.
 */
export const CAMERA_RECIPES: CameraRecipe[] = [
  {
    id: 'intimate-push',
    name: 'Intimate Push',
    intent: 'intimacy',
    presetId: 'slow-push-in',
    shotFunction: 'Increase emotional attention without changing screen direction.',
    defaultLens: 50,
    pacing: 'slow',
    description: 'Measured push toward the subject; useful for a realization, product detail, or emotional beat.'
  },
  {
    id: 'pullback-reveal',
    name: 'Pull-Back Reveal',
    intent: 'reveal',
    presetId: 'pull-back-reveal',
    shotFunction: 'Reveal context around a subject that initially owns the frame.',
    defaultLens: 35,
    pacing: 'measured',
    description: 'Begin relatively tight, recede and rise so the environment enters the composition.'
  },
  {
    id: 'hero-arc',
    name: 'Hero Arc',
    intent: 'hero',
    presetId: 'arc-and-push',
    shotFunction: 'Turn a static subject into a hero reveal with parallax and tightening.',
    defaultLens: 35,
    pacing: 'measured',
    description: 'Arc around the subject while pushing closer; strong for vehicles, products, and character entrances.'
  },
  {
    id: 'low-menace',
    name: 'Low Menace Push',
    intent: 'menace',
    presetId: 'creep-in-low',
    shotFunction: 'Increase scale and dominance from a low camera position.',
    defaultLens: 28,
    pacing: 'slow',
    description: 'Low creeping push that makes the subject loom in frame.'
  },
  {
    id: 'follow-behind',
    name: 'Follow Behind',
    intent: 'follow',
    presetId: 'follow-behind',
    shotFunction: 'Keep movement legible while travelling with the subject.',
    defaultLens: 35,
    pacing: 'measured',
    description: 'Tracks behind a moving subject and rides its path.'
  },
  {
    id: 'lead-face',
    name: 'Lead the Subject',
    intent: 'follow',
    presetId: 'lead-the-subject',
    shotFunction: 'Travel with a subject while preserving a readable face/front profile.',
    defaultLens: 50,
    pacing: 'measured',
    description: 'Moves in front of the subject and looks back while matching its travel.'
  },
  {
    id: 'crane-world-reveal',
    name: 'Crane World Reveal',
    intent: 'reveal',
    presetId: 'crane-up-reveal',
    shotFunction: 'Open the geography of a scene without cutting away from the subject.',
    defaultLens: 28,
    pacing: 'measured',
    description: 'Rises from eye level into a broad overhead context reveal.'
  },
  {
    id: 'aerial-establish',
    name: 'Aerial Establish',
    intent: 'orientation',
    presetId: 'drone-rise-pullback',
    shotFunction: 'Establish geography and scale at the start or end of a sequence.',
    defaultLens: 24,
    pacing: 'slow',
    description: 'Rises and recedes into a wide spatial overview.'
  },
  {
    id: 'profile-orbit',
    name: 'Profile Orbit',
    intent: 'hero',
    presetId: 'orbit-90-right',
    shotFunction: 'Reveal a new profile and depth relationship around a stationary subject.',
    defaultLens: 35,
    pacing: 'measured',
    description: 'Quarter orbit that changes vantage without losing the subject.'
  },
  {
    id: 'vertigo',
    name: 'Vertigo',
    intent: 'disorientation',
    presetId: 'vertigo-dolly-zoom',
    shotFunction: 'Keep subject scale while changing perspective for psychological disorientation.',
    defaultLens: null,
    pacing: 'measured',
    shotSize: 'MS',
    height: 'eye',
    useCase: 'character',
    description: 'Dolly-zoom recipe; lens animation is owned by the underlying preset.'
  },
  {
    id: 'product-reveal',
    name: 'Product Reveal',
    intent: 'product',
    presetId: 'arc-and-push',
    shotFunction: 'Reveal form and depth while progressively concentrating attention on the object.',
    defaultLens: 50,
    pacing: 'slow',
    shotSize: 'MCU',
    height: 'eye',
    useCase: 'product',
    description: 'Controlled arc plus push for products and props; avoids an aggressive wide-angle look.'
  },
  {
    id: 'compressed-observer',
    name: 'Compressed Observer',
    intent: 'observation',
    presetId: 'slow-push-in',
    shotFunction: 'Observe from apparent distance while flattening foreground/background relationships.',
    defaultLens: 85,
    pacing: 'slow',
    shotSize: 'MS',
    height: 'eye',
    useCase: 'character',
    description: 'Long-lens observational push; useful for surveillance, isolation, and unobtrusive character coverage.'
  },
  {
    id: 'wide-energy-follow',
    name: 'Wide Energy Follow',
    intent: 'energy',
    presetId: 'follow-behind',
    shotFunction: 'Make travel feel fast and spatial by keeping a wide lens close to the moving subject.',
    defaultLens: 24,
    pacing: 'fast',
    shotSize: 'FS',
    height: 'eye',
    useCase: 'action',
    description: 'Wide moving follow with strong perspective change; useful for running, riding, and kinetic entrances.'
  },
  {
    id: 'vehicle-hero',
    name: 'Vehicle Hero',
    intent: 'hero',
    presetId: 'orbit-90-right',
    shotFunction: 'Describe the vehicle silhouette and volume with lateral parallax.',
    defaultLens: 50,
    pacing: 'measured',
    shotSize: 'FS',
    height: 'low',
    useCase: 'vehicle',
    description: 'Low, moderately long-lens quarter orbit designed for cars and other hero vehicles.'
  },
  {
    id: 'quiet-dialogue-push',
    name: 'Quiet Dialogue Push',
    intent: 'intimacy',
    presetId: 'slow-push-in',
    shotFunction: 'Increase dramatic pressure inside dialogue without calling attention to the move.',
    defaultLens: 65,
    pacing: 'slow',
    shotSize: 'MCU',
    height: 'eye',
    useCase: 'dialogue',
    description: 'Subtle longer-lens push for dialogue beats, reactions, and realizations.'
  }
]

export function getCameraRecipe(id: string): CameraRecipe | undefined {
  return CAMERA_RECIPES.find((recipe) => recipe.id === id)
}

/**
 * Stable, cheap stale-state token for human/agent coordination.
 * It is not a security hash; it only answers "did the project change since I
 * reviewed it?" without sending the whole document back through the MCP.
 */
export function directorStateToken(
  doc: ProjectDoc | null,
  sceneId: string | null,
  shotId: string | null
): string {
  const payload = JSON.stringify({ sceneId, shotId, doc })
  let hash = 0x811c9dc5
  for (let i = 0; i < payload.length; i++) {
    hash ^= payload.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return `v1-${(hash >>> 0).toString(16).padStart(8, '0')}`
}

/**
 * Pick a small set of representative times for one-shot visual review.
 * Camera marks are preferred, then quarter/middle beats fill the gaps. The
 * result is unique, sorted, and capped so one MCP image replaces many calls.
 */
export function reviewTimes(
  duration: number,
  fps: number,
  cameraMarkTimes: number[],
  maxFrames = 6,
  priorityTimes: number[] = []
): number[] {
  const safeDuration = Math.max(0.001, duration)
  const safeFps = Math.max(1, fps)
  const end = Math.max(0, safeDuration - 1 / safeFps)
  const clampTime = (t: number): number => Math.min(end, Math.max(0, t))
  const dedupe = (values: number[]): number[] => {
    const sorted = values.map(clampTime).sort((a, b) => a - b)
    const out: number[] = []
    for (const t of sorted) {
      if (out.length === 0 || Math.abs(t - out[out.length - 1]!) > 1e-4) out.push(t)
    }
    return out
  }

  const all = dedupe([
    0,
    end,
    ...priorityTimes,
    ...cameraMarkTimes,
    safeDuration * 0.25,
    safeDuration * 0.5,
    safeDuration * 0.75
  ])

  const cap = Math.max(2, Math.floor(maxFrames))
  if (all.length <= cap) return all

  // First/last are always useful; explicitly-approved hero frames must survive
  // capping even when a shot contains many camera marks.
  const mandatory = dedupe([0, end, ...priorityTimes])
  if (mandatory.length >= cap) {
    if (cap === 2) return dedupe([0, end])
    const interior = mandatory.filter((t) => t > 1e-4 && t < end - 1e-4)
    return dedupe([0, ...interior.slice(0, cap - 2), end]).slice(0, cap)
  }

  const selected = new Set(mandatory.map((t) => t.toFixed(6)))
  const remaining = all.filter((t) => !selected.has(t.toFixed(6)))
  const slots = cap - mandatory.length
  const sampled: number[] = []
  for (let i = 1; i <= slots; i++) {
    const idx = Math.max(
      0,
      Math.min(remaining.length - 1, Math.round((i * (remaining.length - 1)) / (slots + 1)))
    )
    if (remaining[idx] !== undefined) sampled.push(remaining[idx]!)
  }
  return dedupe([...mandatory, ...sampled]).slice(0, cap)
}
