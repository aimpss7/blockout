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
    description: 'Dolly-zoom recipe; lens animation is owned by the underlying preset.'
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
  maxFrames = 6
): number[] {
  const safeDuration = Math.max(0.001, duration)
  const safeFps = Math.max(1, fps)
  const end = Math.max(0, safeDuration - 1 / safeFps)
  const candidates = [
    0,
    end,
    ...cameraMarkTimes,
    safeDuration * 0.25,
    safeDuration * 0.5,
    safeDuration * 0.75
  ]
    .map((t) => Math.min(end, Math.max(0, t)))
    .sort((a, b) => a - b)

  const unique: number[] = []
  for (const t of candidates) {
    if (unique.length === 0 || Math.abs(t - unique[unique.length - 1]!) > 1e-4) unique.push(t)
  }

  const cap = Math.max(2, Math.floor(maxFrames))
  if (unique.length <= cap) return unique

  const out = [unique[0]!]
  const innerSlots = cap - 2
  for (let i = 1; i <= innerSlots; i++) {
    const idx = Math.round((i * (unique.length - 1)) / (innerSlots + 1))
    const value = unique[idx]!
    if (Math.abs(value - out[out.length - 1]!) > 1e-4) out.push(value)
  }
  const last = unique[unique.length - 1]!
  if (Math.abs(last - out[out.length - 1]!) > 1e-4) out.push(last)
  return out.slice(0, cap)
}
