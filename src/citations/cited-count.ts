import { messages, type Lang } from '../site/i18n'

const text = messages({
  ja: { cited: (count: number) => `引用された ${count} 件` },
  en: { cited: (count: number) => `Cited by ${count}` },
})

/**
 * What a deck's card says of how many decks cite it, or null for a deck
 * nobody cites: a card of such a deck says nothing about citations.
 */
export const citedCountText = (count: number, lang: Lang): string | null =>
  count > 0 ? text[lang].cited(count) : null

/** The key a deck's count is kept under, as `readCitedCounts` names it. */
export const citedKey = (handle: string, slug: string) => `${handle}/${slug}`
