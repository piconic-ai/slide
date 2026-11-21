import { articleFrameBody } from '../articles/edit-page'
import type { StoredArticle } from '../articles/store'
import type { Lang } from '../site/i18n'

/** What the page of one slide knows of its article. */
export type ArticleSummary = Readonly<{
  article: StoredArticle
  /** The body's length in characters. */
  length: number
}>

/**
 * Where the editing page of one slide shows its article: the state, when it
 * was saved, how long it is, and the way to edit it. The words and markup
 * are the article work's (`src/articles/edit-page.ts`).
 */
export const articleFrame = (
  slug: string,
  summary: ArticleSummary | null,
  lang: Lang,
) =>
  articleFrameBody(slug, summary?.article ?? null, summary?.length ?? 0, lang)
