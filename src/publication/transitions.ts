import {
  compareCiRuns,
  type CiRun,
  type DeckPublication,
  type Publication,
  type PublicationMode,
} from './state'

/** Owner-only viewing sessions that a transition must revoke. */
export type Revocation =
  | Readonly<{ kind: 'none' }>
  | Readonly<{ kind: 'deployment'; deploymentId: string }>
  | Readonly<{ kind: 'deck' }>

export type AuthorCommand =
  /** Publishes, updates to, or rolls back to a ready deployment. */
  | Readonly<{ kind: 'publish'; deploymentId: string }>
  | Readonly<{ kind: 'pause' }>
  | Readonly<{ kind: 'resume' }>
  | Readonly<{ kind: 'set_mode'; mode: PublicationMode }>

export type Transition = Readonly<{
  next: DeckPublication
  revoke: Revocation
}>

export type AuthorDecision =
  | Readonly<{ kind: 'apply'; transition: Transition }>
  | Readonly<{ kind: 'unchanged' }>
  | Readonly<{ kind: 'conflict'; current: DeckPublication }>
  | Readonly<{ kind: 'not_paused' }>

const none: Revocation = { kind: 'none' }

function samePublication(a: Publication, b: Publication): boolean {
  if (a.kind === 'public' && b.kind === 'public')
    return a.deploymentId === b.deploymentId
  if (a.kind === 'paused' && b.kind === 'paused')
    return a.resumeTo === b.resumeTo
  return a.kind === b.kind
}

function authorTarget(
  deck: DeckPublication,
  command: AuthorCommand,
): { publication: Publication; mode: PublicationMode; revoke: Revocation } {
  const { publication, mode } = deck
  switch (command.kind) {
    case 'publish':
      // Publishing ends owner-only viewing of that deployment; the public
      // route replaces it.
      return {
        publication: { kind: 'public', deploymentId: command.deploymentId },
        mode,
        revoke: { kind: 'deployment', deploymentId: command.deploymentId },
      }
    case 'pause':
      return {
        publication:
          publication.kind === 'paused'
            ? publication
            : {
                kind: 'paused',
                resumeTo:
                  publication.kind === 'public'
                    ? publication.deploymentId
                    : null,
              },
        mode,
        revoke: { kind: 'deck' },
      }
    case 'resume':
      if (publication.kind !== 'paused' || publication.resumeTo === null)
        return {
          publication:
            publication.kind === 'paused' ? { kind: 'draft' } : publication,
          mode,
          revoke: none,
        }
      // The owner may have reopened the deployment while paused; public
      // delivery replaces that session as it does on publish.
      return {
        publication: { kind: 'public', deploymentId: publication.resumeTo },
        mode,
        revoke: { kind: 'deployment', deploymentId: publication.resumeTo },
      }
    case 'set_mode':
      return { publication, mode: command.mode, revoke: none }
  }
}

/**
 * Decides an author operation made against `expectedRevision`. Any change
 * since then is a conflict, so a request built on an older view never
 * overrides a newer pause or publication. A pause only ever stops delivery,
 * so it applies to the current state instead: a publication that landed
 * while the author was deciding to stop is stopped too.
 */
export function decideAuthor(
  deck: DeckPublication,
  command: AuthorCommand,
  expectedRevision: number,
): AuthorDecision {
  if (command.kind !== 'pause' && deck.revision !== expectedRevision)
    return { kind: 'conflict', current: deck }
  if (command.kind === 'resume' && deck.publication.kind !== 'paused')
    return { kind: 'not_paused' }
  const target = authorTarget(deck, command)
  if (
    target.mode === deck.mode &&
    samePublication(target.publication, deck.publication)
  )
    return { kind: 'unchanged' }
  const revision = deck.revision + 1
  return {
    kind: 'apply',
    transition: {
      next: {
        ...deck,
        mode: target.mode,
        publication: target.publication,
        revision,
        authorRevision: revision,
      },
      revoke: target.revoke,
    },
  }
}

/** A ready deployment whose workflow asked to change publication. */
export type CiPublication = Readonly<{
  deploymentId: string
  /** The deck revision when the upload started; null before F02. */
  startRevision: number | null
  intent: 'published' | 'unpublished' | null
  run: CiRun
}>

export type CiSkipReason =
  | 'manual_mode'
  | 'no_intent'
  | 'paused'
  | 'stale_revision'
  | 'older_run'
  | 'recorded_run'

export type CiDecision =
  | Readonly<{ kind: 'apply'; transition: Transition }>
  | Readonly<{ kind: 'skip'; reason: CiSkipReason }>

function ciSkipReason(
  deck: DeckPublication,
  ci: CiPublication,
): CiSkipReason | null {
  if (deck.mode !== 'repository') return 'manual_mode'
  if (ci.intent === null) return 'no_intent'
  // A pause outranks automatic publication until the author resumes.
  if (deck.publication.kind === 'paused') return 'paused'
  // Any author operation after the upload started outranks this run,
  // including a pause that was later resumed.
  // A start revision ahead of the deck cannot come from a real start.
  if (
    ci.startRevision === null ||
    ci.startRevision < deck.authorRevision ||
    ci.startRevision > deck.revision
  )
    return 'stale_revision'
  const order = deck.lastCiRun ? compareCiRuns(ci.run, deck.lastCiRun) : 1
  if (order < 0) return 'older_run'
  // The recorded run already decided publication. Another upload of the same
  // attempt cannot change it, whatever deployment it carries.
  if (order === 0) return 'recorded_run'
  return null
}

/**
 * Decides whether a finished CI run changes publication in repository mode.
 * A skipped deployment stays a draft the author can still publish by hand.
 */
export function decideCi(deck: DeckPublication, ci: CiPublication): CiDecision {
  const reason = ciSkipReason(deck, ci)
  if (reason) return { kind: 'skip', reason }
  const publication: Publication =
    ci.intent === 'published'
      ? { kind: 'public', deploymentId: ci.deploymentId }
      : { kind: 'draft' }
  // A newer run with the current result is still recorded, so an older run
  // finishing later cannot override it.
  const same = samePublication(publication, deck.publication)
  return {
    kind: 'apply',
    transition: {
      next: {
        ...deck,
        publication,
        revision: deck.revision + 1,
        lastCiRun: ci.run,
      },
      revoke:
        publication.kind === 'public' && !same
          ? { kind: 'deployment', deploymentId: ci.deploymentId }
          : none,
    },
  }
}
