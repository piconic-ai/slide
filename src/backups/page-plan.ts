/** An object of the source bucket, as a listing shows it. */
export type SourceObject = Readonly<{ key: string; etag: string; size: number }>

/** What the backup knows of a key it holds. */
export type TrackedObject = Readonly<{
  key: string
  etag: string
  /** When the source was found gone, or null while it has the object. */
  goneAt: number | null
}>

/** What one page of the source asks of the backup. */
export type PagePlan = Readonly<{
  /** Objects that are new, or put again since they were copied. */
  copy: readonly SourceObject[]
  /** Copies whose source is back, with the content they were copied from. */
  revive: readonly string[]
  /** Copies whose source is no longer in the range the page covers. */
  gone: readonly string[]
}>

/**
 * Compares one page of the source with what the backup knows of the same
 * range of keys. `listed` is the page's objects that are backed up, and
 * `tracked` is every row of the backup in the range the page covers: from
 * the key after the previous page to this page's last key (to the end, for
 * the last page). Both come from the same pass over the keys in order, so a
 * tracked key the page does not list is a key the source no longer has.
 *
 * - An object the backup does not know, or knows by another etag, is copied:
 *   an etag changes when the same key is put again.
 * - An object the backup knows by the same etag is not copied again, however
 *   often it is listed (F39-AC26). If its source had been found gone, it is
 *   back, and the copy is the one kept.
 * - A copy the page does not list is gone, unless it is already known to be.
 */
export function planPage(
  listed: readonly SourceObject[],
  tracked: readonly TrackedObject[],
): PagePlan {
  const known = new Map(tracked.map((row) => [row.key, row]))
  const copy: SourceObject[] = []
  const revive: string[] = []
  for (const object of listed) {
    const row = known.get(object.key)
    if (!row || row.etag !== object.etag) copy.push(object)
    else if (row.goneAt !== null) revive.push(object.key)
  }
  const present = new Set(listed.map(({ key }) => key))
  const gone = tracked
    .filter((row) => row.goneAt === null && !present.has(row.key))
    .map(({ key }) => key)
  return { copy, revive, gone }
}
