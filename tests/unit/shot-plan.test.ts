import { describe, expect, it } from 'vitest'
import { shotPlanExample, validateShotPlan } from '../../src/engine/shot-plan'

describe('Director Shot Plan', () => {
  it('validates the portable example used by ChatGPT/Codex/import', () => {
    const plan = validateShotPlan(shotPlanExample())
    expect(plan.type).toBe('blockout-shot-plan')
    expect(plan.shot.aspect).toBe('9:16')
    expect(plan.cameraRecipeId).toBe('hero-arc')
  })

  it('rejects duplicate entity keys', () => {
    const plan = shotPlanExample()
    plan.entities.push({ key: 'hero', assetId: 'prim.cube' })
    expect(() => validateShotPlan(plan)).toThrow('Duplicate entity key')
  })

  it('supports portrait social formats', () => {
    for (const aspect of ['9:16', '3:4', '4:5'] as const) {
      const plan = shotPlanExample()
      plan.shot.aspect = aspect
      expect(validateShotPlan(plan).shot.aspect).toBe(aspect)
    }
  })
})
