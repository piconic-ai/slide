import { html } from 'hono/html'
import { messages, type Lang } from '../site/i18n'

const text = messages({
  ja: {
    title: 'この URL の集まりは、まだありません',
    how: 'スライドの関連リンクにこの URL を足すと、同じ URL を持つスライドが、このページに集まります。',
    top: 'トップページへ',
  },
  en: {
    title: 'Nothing is gathered at this URL yet',
    how: 'Add this URL to the related links of your slides, and the slides that share it gather on this page.',
    top: 'Go to the top page',
  },
})

/** The title of the page of an address no slides are gathered at. */
export const linkMissingTitle = (lang: Lang) => text[lang].title

/** A long address wraps instead of widening the page. */
export const linkMissingStyle = html`<style>
  .link-missing-address {
    overflow-wrap: anywhere;
  }
</style>`

/**
 * The page of an address no slides are gathered at (F45-AC40): the same for
 * an address no one wrote and for one a single author wrote. The address is
 * shown as text and never as a link (F45-AC29): anyone can write any address
 * after `/link/`, and the service does not lead readers there.
 */
export function linkMissingBody(address: string, lang: Lang) {
  const t = text[lang]
  return html`<div class="color-block color-block-ecru error-block">
    <h1>${t.title}</h1>
    <p class="link-missing-address">${address}</p>
    <p>${t.how}</p>
    <p><a class="button-primary" href="/">${t.top}</a></p>
  </div>`
}
