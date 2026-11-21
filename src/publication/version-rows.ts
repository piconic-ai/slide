import type { Publication } from './state'
import type { PointedVersion } from './store'

/**
 * What a row of versions says about its version. At most two rows show: the
 * version the publication points at, and a newer one it does not.
 */
export type VersionRowKind =
  /** The version readers can open now. */
  | 'visible'
  /** The version readers will see once published; nothing is public yet. */
  | 'unpublished'
  /** The version readers could open until publishing was stopped. */
  | 'stopped'
  /** A version received after the one readers see, not yet published. */
  | 'newer'

/** What the button that publishes the row's version does. */
export type VersionRowAction = 'none' | 'publish' | 'resume'

export type VersionRow = Readonly<{
  kind: VersionRowKind
  version: PointedVersion
  action: VersionRowAction
}>

/**
 * Whether a version was received after another: later, or in the same second
 * and put in later, the order the newest version is picked in.
 */
const isAfter = (version: PointedVersion, other: PointedVersion) =>
  version.readyAt !== other.readyAt
    ? version.readyAt > other.readyAt
    : version.order > other.order

/**
 * The rows of the "new version" frame, from the publication and the two
 * versions the page knows: the one the publication points at (public, or
 * restored by publishing again) and the newest received one.
 *
 * - Public, with nothing newer: one row, the version readers see.
 * - Public, with a newer version: that row, then the newer version with the
 *   button that swaps it in.
 * - Not published: the newest received version, with the button that
 *   publishes it.
 * - Stopped: the version readers lost, with the button that publishes again,
 *   then the newer version, if any.
 */
export function versionRows(
  publication: Publication,
  pointed: PointedVersion | null,
  latest: PointedVersion | null,
): readonly VersionRow[] {
  const newer = (than: PointedVersion): readonly VersionRow[] =>
    latest && isAfter(latest, than)
      ? [{ kind: 'newer', version: latest, action: 'publish' }]
      : []
  switch (publication.kind) {
    case 'public':
      return pointed
        ? [
            { kind: 'visible', version: pointed, action: 'none' },
            ...newer(pointed),
          ]
        : []
    case 'paused':
      if (pointed)
        return [
          { kind: 'stopped', version: pointed, action: 'resume' },
          ...newer(pointed),
        ]
      return latest
        ? [{ kind: 'stopped', version: latest, action: 'publish' }]
        : []
    case 'draft':
      return latest
        ? [{ kind: 'unpublished', version: latest, action: 'publish' }]
        : []
  }
}
