import { html } from 'hono/html'
import { safetyHelp } from '../safety/pages'
import { messages, type Lang } from './i18n'
import { pageShell, PLAIN_PAGE_POLICY } from './shell'

/** The help page carries only service markup and the shared frame. */
export const HELP_PAGE_POLICY = PLAIN_PAGE_POLICY

export const HELP_PATH = '/help'

const text = messages({
  ja: { title: 'ヘルプ' },
  en: { title: 'Help' },
})

/**
 * What holds for every slide, so that a slide page only has to show what is
 * particular to it.
 */
export const helpPage = (lang: Lang, url: URL) => {
  const t = text[lang]
  return pageShell({
    lang,
    title: t.title,
    url,
    width: 'reading',
    body: html`<h1>${t.title}</h1>
      ${safetyHelp(lang)}`,
  })
}
