import type { Publication } from '../publication/state'

/** A received (`ready`) version of a deck. */
export type ReadyVersion = Readonly<{ id: string; readyAt: number }>

/**
 * What the owner's viewer of a deck shows.
 * - `readers`: the version readers see; the ordinary viewer answers.
 * - `draft` and `paused`: nothing is public, so the owner sees a received
 *   version that readers cannot.
 * - `newer`: a version other than the public one, asked for by its ID.
 */
export type OwnerView =
  | Readonly<{ kind: 'readers' }>
  | Readonly<{ kind: 'draft' | 'paused' | 'newer'; deploymentId: string }>

/**
 * Chooses the version the owner's viewer shows. `versions` are the deck's
 * received versions; `requested` is the version the address asks for, if
 * any. A version that is not one of them is not asked for at all. Null when
 * there is nothing to show.
 */
export function chooseOwnerView(
  publication: Publication,
  versions: readonly ReadyVersion[],
  requested: string | null,
): OwnerView | null {
  const known = versions.find((version) => version.id === requested)
  if (publication.kind === 'public')
    return known && known.id !== publication.deploymentId
      ? { kind: 'newer', deploymentId: known.id }
      : { kind: 'readers' }
  const newest = [...versions].sort((a, b) => b.readyAt - a.readyAt)[0]
  const shown = known ?? newest
  return shown ? { kind: publication.kind, deploymentId: shown.id } : null
}
