/**
 * Project reference cards: semantic references stay separate from motion.
 * Files themselves live in refs/; these cards tell humans/agents what each
 * reference is authoritative for.
 */

export type ReferenceRole = 'character' | 'product' | 'location' | 'style' | 'motion'

export interface ProjectReferenceCard {
  id: string
  role: ReferenceRole
  name: string
  relativePath: string
  note?: string
  createdAt: string
  /** Optional stable subject key shared with .shot.json plans. */
  subjectKey?: string
}

export const REFERENCE_ROLE_HELP: Record<ReferenceRole, string> = {
  character: 'Identity, face/body continuity, wardrobe and character-specific appearance.',
  product: 'Product identity, proportions, packaging and material details.',
  location: 'Environment identity, architecture, dressing and spatial appearance.',
  style: 'Lighting look, palette, texture, photographic/render language.',
  motion: 'Movement, camera trajectory, timing and blocking only — not identity or look.'
}

export function validateReferenceCard(value: unknown): ProjectReferenceCard {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Reference card must be an object.')
  const raw = value as Record<string, unknown>
  const roles: ReferenceRole[] = ['character', 'product', 'location', 'style', 'motion']
  if (typeof raw.id !== 'string' || !raw.id) throw new Error('Reference card id is required.')
  if (!roles.includes(raw.role as ReferenceRole)) throw new Error('Unknown reference role.')
  if (typeof raw.name !== 'string' || !raw.name) throw new Error('Reference card name is required.')
  if (typeof raw.relativePath !== 'string' || !raw.relativePath.startsWith('refs/')) {
    throw new Error('Reference path must live under refs/.')
  }
  return value as ProjectReferenceCard
}
