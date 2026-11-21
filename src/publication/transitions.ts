import type { DeckPublication, Publication } from './state'

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
): { publication: Publication; revoke: Revocation } {
  const { publication } = deck
  switch (command.kind) {
    case 'publish':
      // Publishing ends owner-only viewing of that deployment; the public
      // route replaces it.
      return {
        publication: { kind: 'public', deploymentId: command.deploymentId },
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
        revoke: { kind: 'deck' },
      }
    case 'resume':
      if (publication.kind !== 'paused' || publication.resumeTo === null)
        return {
          publication:
            publication.kind === 'paused' ? { kind: 'draft' } : publication,
          revoke: none,
        }
      // The owner may have reopened the deployment while paused; public
      // delivery replaces that session as it does on publish.
      return {
        publication: { kind: 'public', deploymentId: publication.resumeTo },
        revoke: { kind: 'deployment', deploymentId: publication.resumeTo },
      }
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
  if (samePublication(target.publication, deck.publication))
    return { kind: 'unchanged' }
  return {
    kind: 'apply',
    transition: {
      next: { publication: target.publication, revision: deck.revision + 1 },
      revoke: target.revoke,
    },
  }
}
