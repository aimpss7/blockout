import { describe, expect, it } from 'vitest'
import { CAMERA_MOVE_PRESETS } from '../../src/engine/camera-moves'
import { CAMERA_RECIPES, directorStateToken, reviewTimes } from '../../src/engine/director'
import { createProject } from '../../src/engine/schema'
import { getProfile } from '../../src/engine/profiles'

describe('agent director helpers', () => {
  it('changes the stale-state token when the document changes', () => {
    const doc = createProject('Token test')
    const scene = doc.scenes[0]!
    const shot = scene.shots[0]!
    const before = directorStateToken(doc, scene.id, shot.id)
    shot.duration = 7
    const after = directorStateToken(doc, scene.id, shot.id)
    expect(after).not.toBe(before)
  })

  it('builds a capped, ordered review timeline that includes the shot edges', () => {
    const times = reviewTimes(8, 24, [1, 2, 3, 4, 5, 6, 7], 6)
    expect(times).toHaveLength(6)
    expect(times[0]).toBe(0)
    expect(times[times.length - 1]).toBeCloseTo(8 - 1 / 24)
    expect([...times].sort((a, b) => a - b)).toEqual(times)
  })

  it('defaults new projects to the official Seedance 2.5 reference workflow', () => {
    const doc = createProject('Seedance test')
    const profile = getProfile('seedance-2.5')
    expect(doc.settings.defaultProfileId).toBe('seedance-2.5')
    expect(profile.maxDuration).toBe(30)
    expect(profile.refModes).toEqual(['referenceVideo', 'stills'])
  })

  it('keeps an approved hero-frame time in a capped review sheet', () => {
    const times = reviewTimes(10, 24, [1, 2, 3, 4, 5, 6, 7, 8, 9], 5, [6.4])
    expect(times).toContain(6.4)
    expect(times[0]).toBe(0)
    expect(times[times.length - 1]).toBeCloseTo(10 - 1 / 24)
  })

  it('keeps director recipes mapped to real deterministic camera presets', () => {
    const presetIds = new Set(CAMERA_MOVE_PRESETS.map((p) => p.id))
    const recipeIds = new Set<string>()
    for (const recipe of CAMERA_RECIPES) {
      expect(recipeIds.has(recipe.id)).toBe(false)
      recipeIds.add(recipe.id)
      expect(presetIds.has(recipe.presetId)).toBe(true)
    }
  })
})
