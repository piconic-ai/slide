import { z } from 'zod'
import { deckRowSchema } from '../db/schema'

/**
 * What anonymous readers can open. Only `public` grants delivery; a paused
 * deck remembers the deployment that an explicit resume brings back.
 */
export type Publication =
  | Readonly<{ kind: 'draft' }>
  | Readonly<{ kind: 'public'; deploymentId: string }>
  | Readonly<{ kind: 'paused'; resumeTo: string | null }>

export type DeckPublication = Readonly<{
  publication: Publication
  /** Advanced by every publication change; author requests must match it. */
  revision: number
}>

/** The stored publication columns of a deck row. */
export const deckPublicationRowSchema = deckRowSchema
  .pick({
    paused_at: true,
    public_deployment_id: true,
    resume_deployment_id: true,
    revision: true,
  })
  .extend({ revision: z.number().int().nonnegative() })
  .refine(
    (row) =>
      row.paused_at === null
        ? row.resume_deployment_id === null
        : row.public_deployment_id === null,
    { message: 'Paused decks cannot be public' },
  )

export type DeckPublicationRow = z.input<typeof deckPublicationRowSchema>

function publicationOf(
  row: z.output<typeof deckPublicationRowSchema>,
): Publication {
  if (row.paused_at !== null)
    return { kind: 'paused', resumeTo: row.resume_deployment_id }
  if (row.public_deployment_id !== null)
    return { kind: 'public', deploymentId: row.public_deployment_id }
  return { kind: 'draft' }
}

/** Parses stored columns into the domain state, rejecting contradictions. */
export function parseDeckPublication(input: unknown): DeckPublication {
  const row = deckPublicationRowSchema.parse(input)
  return { publication: publicationOf(row), revision: row.revision }
}

/** The column values that store a publication, using `pausedAt` if paused. */
export function publicationColumns<T>(publication: Publication, pausedAt: T) {
  switch (publication.kind) {
    case 'draft':
      return {
        paused_at: null,
        public_deployment_id: null,
        resume_deployment_id: null,
      }
    case 'public':
      return {
        paused_at: null,
        public_deployment_id: publication.deploymentId,
        resume_deployment_id: null,
      }
    case 'paused':
      return {
        paused_at: pausedAt,
        public_deployment_id: null,
        resume_deployment_id: publication.resumeTo,
      }
  }
}
