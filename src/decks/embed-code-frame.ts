import { html } from 'hono/html'
import { messages, type Lang } from '../site/i18n'

const text = messages({
  ja: { heading: '埋め込みコード' },
  en: { heading: 'Embed code' },
})

/**
 * Where the code to embed the slides in another site goes. For now only the
 * frame is kept; the embed feature fills it with the code and its copy
 * button, or a line saying it works once the slides are public.
 */
export const embedCodeFrame = (lang: Lang) =>
  html`<section class="panel" data-deck-frame="embed-code">
    <h2>${text[lang].heading}</h2>
  </section>`
