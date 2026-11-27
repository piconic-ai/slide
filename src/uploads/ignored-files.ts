/**
 * Settings that static hosts read from the top of a build: `_redirects` and
 * `_headers`. This service does not act on them (it looks a file up by its
 * path and serves it), so they are not part of the slide: a build that has
 * them is taken as if it had not (F22-AC48). Only the exact names at the
 * top count; the same name in a folder, or in other letters, is another
 * file and is judged like any other.
 */
const HOSTING_CONFIG = new Set(['_redirects', '_headers'])

/** Whether the path, relative to the top of the slide, is one of them. */
export const isHostingConfigFile = (path: string): boolean =>
  HOSTING_CONFIG.has(path)

/**
 * The files without the hosting settings. Every sender does this once,
 * after the top of the slide is known and before anything is counted,
 * checked or sent, so those files are never part of a version.
 */
export const withoutHostingConfig = <T extends Readonly<{ path: string }>>(
  files: readonly T[],
): T[] => files.filter(({ path }) => !isHostingConfigFile(path))
