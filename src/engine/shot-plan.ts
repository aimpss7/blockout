/**
 * Portable Director Shot Plan (.shot.json).
 *
 * This is the single high-level interchange format shared by:
 * - manual file import/export
 * - ChatGPT via tunnel/MCP
 * - Codex/Claude
 *
 * Keep it renderer-independent. The compiler/control layer maps this plan to
 * Blockout's document model.
 */

export const SHOT_PLAN_SCHEMA = 1 as const

export interface ShotPlanEntityMark {
  time: number
  x: number
  y?: number
  z: number
  gait?: string
  hold?: number
  easeIn?: number
  easeOut?: number
  headingDeg?: number
  joints?: Record<string, number>
}

export interface ShotPlanEntity {
  key: string
  assetId: string
  name?: string
  label?: string
  x?: number
  y?: number
  z?: number
  rotationDeg?: number
  scale?: number
  params?: Record<string, number | string>
  marks?: ShotPlanEntityMark[]
}

export interface ShotPlanCameraMark {
  time: number
  x: number
  y: number
  z: number
  panDeg: number
  tiltDeg: number
  rollDeg?: number
  focalLength?: number
  focusDistance?: number
  hold?: number
  easeIn?: number
  easeOut?: number
}

export interface DirectorShotPlan {
  schema: typeof SHOT_PLAN_SCHEMA
  type: 'blockout-shot-plan'
  title?: string
  intent?: string
  cameraRecipeId?: string
  cameraSubjectKey?: string
  heroFrameTime?: number
  lighting?: string
  entities: ShotPlanEntity[]
  shot: {
    name?: string
    duration: number
    fps?: number
    aspect?: '16:9' | '9:16' | '3:4' | '4:5' | '2.39:1' | '4:3' | '1:1'
    rig?: string
    notes?: string
    trackEntityKey?: string
    cameraMarks?: ShotPlanCameraMark[]
  }
  provenance?: {
    source?: 'human' | 'chatgpt' | 'codex' | 'claude' | 'import' | string
    createdAt?: string
    note?: string
  }
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

export function validateShotPlan(value: unknown): DirectorShotPlan {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Shot Plan must be a JSON object.')
  }
  const raw = value as Record<string, unknown>
  if (raw.schema !== SHOT_PLAN_SCHEMA || raw.type !== 'blockout-shot-plan') {
    throw new Error('Unsupported Shot Plan schema/type.')
  }
  if (!Array.isArray(raw.entities) || raw.entities.length === 0) {
    throw new Error('Shot Plan must contain at least one entity.')
  }
  const shot = raw.shot
  if (!shot || typeof shot !== 'object' || Array.isArray(shot)) {
    throw new Error('Shot Plan is missing shot.')
  }
  const duration = (shot as Record<string, unknown>).duration
  if (!finite(duration) || duration <= 0 || duration > 300) {
    throw new Error('shot.duration must be between 0 and 300 seconds.')
  }
  const keys = new Set<string>()
  for (const [index, item] of raw.entities.entries()) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error(`entities[${index}] must be an object.`)
    }
    const entity = item as Record<string, unknown>
    if (typeof entity.key !== 'string' || !entity.key.trim()) {
      throw new Error(`entities[${index}].key is required.`)
    }
    if (keys.has(entity.key)) throw new Error(`Duplicate entity key "${entity.key}".`)
    keys.add(entity.key)
    if (typeof entity.assetId !== 'string' || !entity.assetId.trim()) {
      throw new Error(`entities[${index}].assetId is required.`)
    }
  }
  return value as DirectorShotPlan
}

export function shotPlanExample(): DirectorShotPlan {
  return {
    schema: 1,
    type: 'blockout-shot-plan',
    title: 'Vertical hero approach',
    intent: 'hero approach',
    cameraRecipeId: 'hero-arc',
    cameraSubjectKey: 'hero',
    heroFrameTime: 5.2,
    lighting: 'day',
    entities: [
      {
        key: 'hero',
        assetId: 'person.woman',
        label: 'HERO',
        x: -2,
        z: 1,
        marks: [
          { time: 0, x: -2, z: 1, gait: 'stand' },
          { time: 5.2, x: 0, z: -1, gait: 'walk' }
        ]
      },
      { key: 'car', assetId: 'vehicle.suv', label: 'CAR', x: 1.8, z: -2 }
    ],
    shot: { duration: 7, fps: 24, aspect: '9:16' },
    provenance: { source: 'chatgpt' }
  }
}
