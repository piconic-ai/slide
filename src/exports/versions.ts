// Which versions of a slide are exported (D-31). Pure.
import type { Publication } from '../publication/state'
import type { PointedVersion } from '../publication/store'
import { versionRows } from '../publication/version-rows'

/** What a person may take of one version: the one readers see, or a newer one. */
export type ExportRole = 'published' | 'prepared'

export type ExportVersions = Readonly<{
  /**
   * The version the publication points at: public, or the one publishing
   * again would bring back. It is what "the published version" means on the
   * slide's page, and what readers see while it is public.
   */
  published: PointedVersion | null
  /**
   * A version received after the published one, which readers do not see;
   * or, for a slide never published, the newest one received. Past versions
   * the service keeps are never offered.
   */
  prepared: PointedVersion | null
}>

/**
 * The versions of a slide to export, from the same rows the slide's page
 * shows its versions with (`versionRows`), so the two never disagree about
 * which version is which.
 */
export function exportVersions(
  publication: Publication,
  pointed: PointedVersion | null,
  latest: PointedVersion | null,
): ExportVersions {
  let published: PointedVersion | null = null
  let prepared: PointedVersion | null = null
  for (const row of versionRows(publication, pointed, latest)) {
    if (row.kind === 'visible' || row.action === 'resume')
      published = row.version
    else prepared = row.version
  }
  return { published, prepared }
}

/** The version a role names, or null when the slide has none in that role. */
export const versionOfRole = (
  versions: ExportVersions,
  role: ExportRole,
): PointedVersion | null => versions[role]
