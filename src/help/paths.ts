/** The help's entrance. The search sends its word as `?q=`. */
export const HELP_PATH = '/help'

/** The query parameter the search form sends. */
export const HELP_QUERY_PARAM = 'q'

/**
 * The page on the bot that reads Luma's feeds. Its User-Agent names this URL
 * (D-66), so it never changes and no aim may take the name `bot`.
 */
export const HELP_BOT_PATH = '/help/bot'

/** The list of one aim's articles. */
export const helpAimPath = (aim: string) => `${HELP_PATH}/${aim}`

/** One article. */
export const helpArticlePath = (aim: string, slug: string) =>
  `${HELP_PATH}/${aim}/${slug}`
