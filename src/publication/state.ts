import { z } from 'zod'

export type PublicationMode = 'manual' | 'repository'

/**
 * What anonymous readers can open. Only `public` grants delivery; a paused
 * deck remembers the deployment that an explicit resume brings back.
 */
export type Publication =
  | Readonly<{ kind: 'draft' }>
  | Readonly<{ kind: 'public'; deploymentId: string }>
  | Readonly<{ kind: 'paused'; resumeTo: string | null }>

/** A GitHub Actions run, ordered by run ID and then attempt. */
export type CiRun = Readonly<{ runId: number; attempt: number }>

export type DeckPublication = Readonly<{
  mode: PublicationMode
  publication: Publication
  /** Advanced by every publication change; author requests must match it. */
  revision: number
  /** The revision of the last author operation. */
  authorRevision: number
  /** The CI run that last changed publication in repository mode. */
  lastCiRun: CiRun | null
}>

const revisionSchema = z.number().int().nonnegative()

/** The stored publication columns of a deck row. */
export const deckPublicationRowSchema = z
  .object({
    publication_mode: z.enum(['manual', 'repository']),
    paused_at: z.number().int().nullable(),
    public_deployment_id: z.string().nullable(),
    resume_deployment_id: z.string().nullable(),
    revision: revisionSchema,
    author_revision: revisionSchema,
    ci_run_id: z.number().int().nonnegative().nullable(),
    ci_run_attempt: z.number().int().positive().nullable(),
  })
  .refine((row) => row.author_revision <= row.revision, {
    message: 'Author revision is ahead of the deck revision',
  })
  .refine((row) => (row.ci_run_id === null) === (row.ci_run_attempt === null), {
    message: 'CI run ID and attempt must be stored together',
  })
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
  return {
    mode: row.publication_mode,
    publication: publicationOf(row),
    revision: row.revision,
    authorRevision: row.author_revision,
    lastCiRun:
      row.ci_run_id === null || row.ci_run_attempt === null
        ? null
        : { runId: row.ci_run_id, attempt: row.ci_run_attempt },
  }
}

/** The column values that store a publication paused at `now` if paused. */
export function publicationColumns(publication: Publication, now: number) {
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
        paused_at: now,
        public_deployment_id: null,
        resume_deployment_id: publication.resumeTo,
      }
  }
}

export function samePublication(a: Publication, b: Publication): boolean {
  if (a.kind === 'public' && b.kind === 'public')
    return a.deploymentId === b.deploymentId
  if (a.kind === 'paused' && b.kind === 'paused')
    return a.resumeTo === b.resumeTo
  return a.kind === b.kind
}

/** Compares runs; a negative result means `a` ran before `b`. */
export function compareCiRuns(a: CiRun, b: CiRun): number {
  return a.runId - b.runId || a.attempt - b.attempt
}
