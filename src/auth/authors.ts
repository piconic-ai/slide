/** GitHub user IDs of the people the operator registered as authors. */
export type Authors = ReadonlySet<string>

const NOBODY: Authors = new Set()
const GITHUB_ID = /^[1-9]\d*$/

/**
 * Parses the `AUTHOR_GITHUB_IDS` setting: GitHub user IDs separated by
 * commas, as in `"722500,1234"`. A setting that is missing, empty, holds
 * anything but an ID, or names an ID twice is a mistake, and a mistaken
 * setting admits nobody rather than some of the people it names.
 */
export function parseAuthors(value: unknown): Authors {
  if (typeof value !== 'string') return NOBODY
  const ids = value.split(',')
  const authors = new Set(ids)
  return authors.size === ids.length && ids.every((id) => GITHUB_ID.test(id))
    ? authors
    : NOBODY
}

export const isAuthor = (authors: Authors, githubId: string): boolean =>
  authors.has(githubId)
