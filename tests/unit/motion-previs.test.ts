import { describe, expect, it } from 'vitest'
import {
  motionPrevisToCameraSpecs,
  validateMotionPrevisCameraData
} from '../../src/engine/motion-previs'

describe('Motion Previs camera import', () => {
  const raw = {
    fps: 12,
    duration: 2,
    width: 1920,
    height: 1080,
    frames: [
      { time: 0, cameraMove: { pan: 0, tilt: 0, dollyZoom: 1, roll: 0 }, confidence: 1 },
      { time: 1, cameraMove: { pan: 0.2, tilt: -0.1, dollyZoom: 1.25, roll: 0.05 }, confidence: 0.8 },
      { time: 2, cameraMove: { pan: 0.4, tilt: -0.2, dollyZoom: 1.5, roll: 0.1 }, confidence: 0.7 }
    ]
  }

  it('validates the Motion Previs v4 camera-motion shape', () => {
    const data = validateMotionPrevisCameraData(raw)
    expect(data.frames).toHaveLength(3)
    expect(data.duration).toBe(2)
    expect(data.frames[1]!.cameraMove.dollyZoom).toBe(1.25)
  })

  it('anchors measured motion to the existing Blockout camera and retimes it', () => {
    const data = validateMotionPrevisCameraData(raw)
    const specs = motionPrevisToCameraSpecs(
      data,
      {
        position: { x: 1, y: 1.6, z: 5 },
        pan: 0,
        tilt: 0,
        roll: 0,
        focalLength: 40
      },
      { duration: 4, targetFps: 12 }
    )
    expect(specs[0]!.position).toEqual({ x: 1, y: 1.6, z: 5 })
    expect(specs[specs.length - 1]!.time).toBeCloseTo(4)
    expect(specs[specs.length - 1]!.focalLength).toBeCloseTo(60)
    expect(specs[specs.length - 1]!.roll).toBeCloseTo(0.1)
    expect(specs[specs.length - 1]!.position.z).toBeLessThan(5)
  })

  it('rejects files without camera frames', () => {
    expect(() => validateMotionPrevisCameraData({ fps: 12, frames: [] })).toThrow('no frames')
  })
})
