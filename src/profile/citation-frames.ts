import { html } from 'hono/html'
import type { Handle } from '../share/handle'
import { citationsPath, type CitationList } from '../share/path'
import type { Lang } from '../site/i18n'
import { messages } from '../site/i18n'
import { profileStat } from './stats-frame'

/**
 * The places of a profile's citation numbers and tabs. They are frames of
 * their own, so that the head and the tabs list them without knowing what
 * they hold. Their order is set by stats-frame.ts and by `profileTabs` in
 * pages.ts.
 */
const text = messages({
  ja: { citing: '引用した', cited: '引用された' },
  en: { citing: 'Citing', cited: 'Cited' },
})

/** The name of a citation list, for its number, its tab and its page's title. */
export const citationListName = (list: CitationList, lang: Lang) =>
  text[lang][list]

const stat =
  (list: CitationList) => (handle: Handle, count: number, lang: Lang) =>
    profileStat(citationsPath(handle, list), count, text[lang][list])

/** The "citing" number of the head. */
export const citingStat = stat('citing')

/** The "cited" number of the head. */
export const citedStat = stat('cited')

const tab =
  (list: CitationList) =>
  (handle: Handle, count: number, current: boolean, lang: Lang) =>
    html`<a
      href="${citationsPath(handle, list)}"
      ${current ? html`aria-current="page"` : ''}
      >${text[lang][list]} <span class="count">${count}</span></a
    >`

/** The "citing" tab. */
export const citingTab = tab('citing')

/** The "cited" tab. */
export const citedTab = tab('cited')
