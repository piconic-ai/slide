import type { HtmlEscapedString } from 'hono/utils/html'
import type { Lang } from '../site/i18n'
import type { HelpNumbers } from './numbers'

export type Html = HtmlEscapedString | Promise<HtmlEscapedString>

/**
 * A part of an article, written as markup. It takes the numbers the code
 * enforces, so that a limit is quoted from the code and never typed twice.
 */
export type ArticleContent = (numbers: HelpNumbers) => Html

/** One language's text of an article. */
export type ArticleText = Readonly<{
  /** What the reader wants to do, in the screen's own words (D-49). */
  title: string
  /**
   * The first sentence: the answer. Lists and search results show it, so it
   * stands without the body.
   */
  lead: ArticleContent
  /**
   * What follows the lead: numbered steps, then why it may not work and what
   * to do. Sub-headings are `<h2>`; the page's `<h1>` is the title.
   */
  body: ArticleContent
}>

/**
 * How an article answers. A `howto` has numbered steps (`<ol>`). A
 * `reference` answers with a list or a rule, as limits and conditions do.
 */
export type ArticleForm = 'howto' | 'reference'

/**
 * One article, in the file `src/help/articles/<aim>/<slug>.ts` that default
 * exports it. The aim and the slug are the file's directory and name, so the
 * article's URL is `/help/<aim>/<slug>` and no table names it.
 */
export type Article = Readonly<{
  /** Lists the articles of an aim in this order; ties go by slug. */
  order: number
  form: ArticleForm
  /** Up to three other articles, as `<aim>/<slug>`. */
  related: readonly string[]
  /**
   * `invitation` for an article that is about signing up by invitation: it
   * is left out of the help, its page included, while sign-up is open
   * (F42-AC5).
   */
  onlyWhile?: 'invitation'
}> &
  Readonly<Record<Lang, ArticleText>>

/** Gives a file's article its type; nothing else. */
export const defineArticle = (article: Article): Article => article
