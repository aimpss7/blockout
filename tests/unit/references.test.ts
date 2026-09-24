import { describe, expect, it } from 'vitest'
import { REFERENCE_ROLE_HELP, validateReferenceCard } from '../../src/engine/references'

describe('reference cards', () => {
  it('keeps visual identity references semantically separate from motion', () => {
    expect(REFERENCE_ROLE_HELP.motion).toContain('not identity')
    expect(REFERENCE_ROLE_HELP.product).toContain('Product identity')
  })

  it('requires project-relative refs paths', () => {
    expect(() =>
      validateReferenceCard({
        id: 'r1',
        role: 'style',
        name: 'Look',
        relativePath: '/tmp/look.jpg',
        createdAt: new Date().toISOString()
      })
    ).toThrow('refs/')
  })
})
