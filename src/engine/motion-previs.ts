/**
 * Motion Previs Studio camera-motion import.
 *
 * Motion Previs v4 exports cumulative normalized pan/tilt, zoom ratio and roll.
 * This adapter intentionally mirrors the *relative* camera reconstruction used
 * by Motion Previs' own Blender handoff, but anchors it to the current Blockout
 * camera instead of a hard-coded Blender camera.
 *
 * Pure module: no DOM / Three.js / Electron / randomness.
 */

import type { V3 } from './types'

export interface MotionPrevisCameraFrame {
  time: number
  frameIndex?: number
  cameraMove: {
    pan: number
    tilt: number
    dollyZoom: number
    roll: number
  }
  confidence?: number
}

export interface MotionPrevisCameraData {
  fps: number
  duration: number
  width?: number
  height?: number
  frames: MotionPrevisCameraFrame[]
  summary?: {
    averageConfidence?: number
    [key: string]: unknown
  }
}

export interface MotionPrevisBaseCamera {
  position: V3
  pan: number
  tilt: number
  roll: number
  focalLength: number
}

export interface MotionPrevisCameraSpec {
  time: number
  position: V3
  pan: number
  tilt: number
  roll: number
  focalLength: number
  confidence: number
}

export interface MotionPrevisImportOptions {
  /** Target Blockout shot duration. Source motion is retimed to this duration. */
  duration: number
  /** Max imported keyframe density. 6fps is usually enough for previs. */
  targetFps?: number
  lateralScale?: number
  verticalScale?: number
  dollyBase?: number
}

const clamp = (value: number, lo: number, hi: number): number =>
  Math.min(hi, Math.max(lo, value))

function forward(pan: number): { x: number; z: number } {
  return { x: -Math.sin(pan), z: -Math.cos(pan) }
}

function right(pan: number): { x: number; z: number } {
  return { x: Math.cos(pan), z: -Math.sin(pan) }
}

function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

export function validateMotionPrevisCameraData(value: unknown): MotionPrevisCameraData {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('camera_motion.json must contain an object.')
  }
  const raw = value as Record<string, unknown>
  if (!Array.isArray(raw.frames) || raw.frames.length === 0) {
    throw new Error('camera_motion.json has no frames.')
  }
  const frames = raw.frames.map((item, index): MotionPrevisCameraFrame => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error(`camera_motion.json frame ${index} is invalid.`)
    }
    const frame = item as Record<string, unknown>
    const move = frame.cameraMove
    if (!move || typeof move !== 'object' || Array.isArray(move)) {
      throw new Error(`camera_motion.json frame ${index} is missing cameraMove.`)
    }
    const m = move as Record<string, unknown>
    return {
      time: finite(frame.time, index / Math.max(1, finite(raw.fps, 12))),
      frameIndex: typeof frame.frameIndex === 'number' ? frame.frameIndex : index,
      cameraMove: {
        pan: finite(m.pan, 0),
        tilt: finite(m.tilt, 0),
        dollyZoom: Math.max(0.2, finite(m.dollyZoom, 1)),
        roll: finite(m.roll, 0)
      },
      confidence: clamp(finite(frame.confidence, 1), 0, 1)
    }
  })

  const duration = Math.max(
    0.001,
    finite(raw.duration, frames[frames.length - 1]?.time ?? frames.length / Math.max(1, finite(raw.fps, 12)))
  )
  return {
    fps: Math.max(1, finite(raw.fps, 12)),
    duration,
    width: typeof raw.width === 'number' ? raw.width : undefined,
    height: typeof raw.height === 'number' ? raw.height : undefined,
    frames,
    summary:
      raw.summary && typeof raw.summary === 'object' && !Array.isArray(raw.summary)
        ? (raw.summary as MotionPrevisCameraData['summary'])
        : undefined
  }
}

/**
 * Convert Motion Previs' normalized cumulative camera solve to editable
 * Blockout camera marks relative to the current camera.
 *
 * Mapping follows Motion Previs' Blender handoff constants:
 * lateral ≈ pan*3.5m, vertical ≈ tilt*2.2m, dolly depth based on 6m/zoom,
 * orientation adds pan*0.18 and tilt*0.22, lens scales by the solved zoom.
 */
export function motionPrevisToCameraSpecs(
  data: MotionPrevisCameraData,
  base: MotionPrevisBaseCamera,
  options: MotionPrevisImportOptions
): MotionPrevisCameraSpec[] {
  const targetDuration = Math.max(0.001, options.duration)
  const targetFps = clamp(options.targetFps ?? 6, 1, 24)
  const lateralScale = options.lateralScale ?? 3.5
  const verticalScale = options.verticalScale ?? 2.2
  const dollyBase = options.dollyBase ?? 6
  const sourceDuration = Math.max(0.001, data.duration)

  const sorted = [...data.frames].sort((a, b) => a.time - b.time)
  const minStep = 1 / targetFps
  const sampled: MotionPrevisCameraFrame[] = []
  let lastSourceTime = -Infinity
  for (const frame of sorted) {
    if (sampled.length === 0 || frame.time - lastSourceTime >= minStep - 1e-6) {
      sampled.push(frame)
      lastSourceTime = frame.time
    }
  }
  const last = sorted[sorted.length - 1]
  if (last && sampled[sampled.length - 1] !== last) sampled.push(last)

  const fwd = forward(base.pan)
  const side = right(base.pan)
  return sampled.map((frame) => {
    const move = frame.cameraMove
    const zoom = Math.max(0.2, move.dollyZoom)
    // Motion Previs Blender import starts at -6 and moves to -6/zoom.
    // Positive delta therefore means moving forward along the base camera aim.
    const dolly = dollyBase - dollyBase / zoom
    const lateral = move.pan * lateralScale
    const vertical = move.tilt * verticalScale
    return {
      time: clamp((frame.time / sourceDuration) * targetDuration, 0, targetDuration),
      position: {
        x: base.position.x + side.x * lateral + fwd.x * dolly,
        y: Math.max(0.05, base.position.y + vertical),
        z: base.position.z + side.z * lateral + fwd.z * dolly
      },
      pan: base.pan + move.pan * 0.18,
      tilt: clamp(base.tilt + move.tilt * 0.22, -Math.PI / 2 + 0.001, Math.PI / 2 - 0.001),
      roll: base.roll + move.roll,
      focalLength: clamp(base.focalLength * zoom, 8, 300),
      confidence: frame.confidence ?? 1
    }
  })
}
