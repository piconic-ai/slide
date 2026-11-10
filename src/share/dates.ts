import type { Lang } from '../site/i18n'

const options: Intl.DateTimeFormatOptions = {
  timeZone: 'Asia/Tokyo',
  dateStyle: 'medium',
}

/** The day a deck was published, as each screen language writes it. */
export const dayFormats: Readonly<Record<Lang, Intl.DateTimeFormat>> = {
  ja: new Intl.DateTimeFormat('ja-JP', options),
  en: new Intl.DateTimeFormat('en-US', options),
}
