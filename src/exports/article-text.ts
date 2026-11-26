// The article as the Markdown file a person takes (D-33). Pure.

/** What the article store holds of one article. */
export type ArticleTexts = Readonly<{
  body: string
  /** The edit of a published article that readers do not see yet. */
  draftBody: string | null
}>

/**
 * The text the author last wrote: an unpublished edit when there is one,
 * else the saved body. Embedded slides stay as written, by their share URL.
 * Nothing is added, so the file is the article and only the article.
 */
export const articleMarkdown = (article: ArticleTexts): string =>
  article.draftBody ?? article.body
