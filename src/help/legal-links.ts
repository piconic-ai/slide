import { articleId, isDraft, type Article } from '../legal/document'
import { LEGAL_TEXT_PATHS, LEGAL_TEXTS } from '../legal/documents'

/**
 * The articles of the terms and the privacy policy that the help points at.
 * The help names an article by its title and reaches it by its `id`, never by
 * its number: the numbers may move when the texts are amended (D-132). The
 * titles are the texts' own words, so a changed title is found by a test and
 * not by a reader.
 */
export const TERMS_PROHIBITED = '禁止事項'
export const TERMS_HIDING = '非表示と利用の停止'
export const TERMS_LEAVING = '退会'
export const TERMS_TAKING_OUT = 'コンテンツの取り出し'
export const PRIVACY_KEEPING = '保存の期間'
export const PRIVACY_REQUESTS = '開示、訂正、削除などの請求'

type Which = 'terms' | 'privacy'

const articlesOf = (which: Which): readonly Article[] => {
  const text = LEGAL_TEXTS[which]
  return text.form === 'articles' ? text.articles : []
}

/** The article of a text with this title, or null when it has none. */
export const legalArticle = (which: Which, title: string): Article | null =>
  articlesOf(which).find((article) => article.title === title) ?? null

/**
 * Where an article is read: the text's page and the article's `id`. A title
 * the text does not have gives the text's page alone, so that a link is never
 * dead; a test finds such a title.
 */
export const legalHref = (which: Which, title: string): string => {
  const article = legalArticle(which, title)
  const path = LEGAL_TEXT_PATHS[which]
  return article === null ? path : `${path}#${articleId(article)}`
}

/** The items (号) of an article that lists them, in the text's words. */
export const legalItems = (which: Which, title: string): readonly string[] => {
  const body = legalArticle(which, title)?.body
  return body?.kind === 'plain' ? body.items : []
}

/** The sentences of an article that come before its items, as written. */
export const legalParagraphs = (
  which: Which,
  title: string,
): readonly string[] => {
  const body = legalArticle(which, title)?.body
  return body?.kind === 'plain' ? body.paragraphs : []
}

/**
 * The items of the terms' article on prohibited acts, in the same order, in
 * English. The terms are in Japanese only, so the English help carries the
 * list; a test finds the day the terms have a different number of items.
 */
export const PROHIBITED_ITEMS_EN = [
  'Breaking the law or public order and morals, or being involved in a crime',
  'Infringing the copyright, trademark, privacy, reputation or any other right or interest of someone else',
  'Discrimination, harassment, threats and stalking',
  'Publishing sexual or violent content, or other content that makes others uncomfortable',
  'Impersonating someone, or falsely claiming a relationship with a person or an organization',
  'Sending a program that harms a user’s device or information, or collecting a user’s information without telling them',
  'Posts made only to advertise or solicit, spam, or any other use that does not fit the purpose of the service',
  'Collecting the service’s information in bulk by automatic means without the operator’s permission',
  'Getting around the limits or the protections of the service, putting excessive load on it, or otherwise getting in the way of its operation',
  'Helping anyone do any of the above',
  'Anything else the operator judges inappropriate in line with the items above',
] as const

/** Whether the text is still shown as a draft; the help says so while it is. */
export const legalIsDraft = (which: Which): boolean =>
  isDraft(LEGAL_TEXTS[which])
