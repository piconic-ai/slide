import type { Lang } from '../site/i18n'

// One service-wide day for now: readers abroad see the Tokyo date too, until
// a reader's own time zone is worth the client-side formatting it needs.
const timeZone = 'Asia/Tokyo'

/**
 * A day as each screen language writes it: 2026年11月19日, Nov 19, 2026.
 * Every date a page shows goes through here, so none appears as ISO 8601.
 */
export const dayFormats: Readonly<Record<Lang, Intl.DateTimeFormat>> = {
  ja: new Intl.DateTimeFormat('ja-JP', { timeZone, dateStyle: 'long' }),
  en: new Intl.DateTimeFormat('en-US', { timeZone, dateStyle: 'medium' }),
}

/** A day and the time of day, for the moment a limit lifts. */
export const dayTimeFormats: Readonly<Record<Lang, Intl.DateTimeFormat>> = {
  ja: new Intl.DateTimeFormat('ja-JP', {
    timeZone,
    dateStyle: 'long',
    timeStyle: 'short',
  }),
  en: new Intl.DateTimeFormat('en-US', {
    timeZone,
    dateStyle: 'medium',
    timeStyle: 'short',
  }),
}
