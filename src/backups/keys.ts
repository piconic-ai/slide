/**
 * What the bucket holds that is not copied (docs/dev/backup.md). Everything
 * else is, so that a prefix added later is covered without a change here.
 *
 * - `gravatar/`: a cache of a picture another service holds; it is fetched
 *   again when it is missing.
 * - `exports/`: the locks that keep one export at a time, which last minutes.
 */
const LEFT_OUT = ['gravatar/', 'exports/'] as const

/** Whether the backup copies the object under this key. */
export const isBackedUp = (key: string): boolean =>
  !LEFT_OUT.some((prefix) => key.startsWith(prefix))
