/**
 * One value of a query, with a space spelled `%20`. The services that take
 * a post read both spellings, but `+` is the one a parser may leave as it
 * is. URLSearchParams spells a literal `+` as `%2B`, so every `+` it writes
 * is a space.
 */
const queryValue = (value: string) =>
  new URLSearchParams({ v: value }).toString().slice(2).replaceAll('+', '%20')

/**
 * The address of each service's screen for writing a post, up to where the
 * URL being shared goes. The viewer's script appends the URL of the page
 * the reader is looking at, spelled with encodeURIComponent.
 */
export const postPrefixes = (title: string) =>
  ({
    x: `https://x.com/intent/post?text=${queryValue(title)}&url=`,
    // Bluesky takes one text; the URL follows the title after a space.
    bluesky: `https://bsky.app/intent/compose?text=${queryValue(`${title} `)}`,
  }) as const

/** The whole address: the screen opens with the title and this URL. */
export const postUrl = (prefix: string, url: string) => prefix + queryValue(url)
