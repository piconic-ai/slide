import { html } from 'hono/html'
import { messages, type Lang } from '../site/i18n'
import { VIEWER_LAYOUTS, type ViewerLayout } from './viewer-layout'

const text = messages({
  ja: {
    menu: 'レイアウト',
    names: { stack: '縦並び', side: '横並び', wide: 'ワイド' },
    current: (name: string) => `レイアウトを選ぶ(いまは${name})`,
  },
  en: {
    menu: 'Layout',
    names: { stack: 'Stacked', side: 'Side by side', wide: 'Wide' },
    current: (name: string) => `Choose layout (now ${name})`,
  },
})

/** The icon of each layout, drawn the same in the button and in the menu. */
const icons: Readonly<Record<ViewerLayout, ReturnType<typeof html>>> = {
  stack: html`<rect x="4" y="4" width="16" height="10" rx="1.5"></rect
    ><path d="M4 19h16"></path>`,
  side: html`<rect x="3" y="4" width="12" height="16" rx="1.5"></rect
    ><rect x="18" y="4" width="3" height="16" rx="1"></rect>`,
  wide: html`<rect x="2" y="4" width="20" height="10" rx="1.5"></rect
    ><path d="M2 19h11"></path>`,
}

const icon = (layout: ViewerLayout, size: number) =>
  html`<svg
    class="layout-icon"
    data-layout-icon="${layout}"
    aria-hidden="true"
    width="${size}"
    height="${size}"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.8"
    stroke-linecap="round"
    stroke-linejoin="round"
  >
    ${icons[layout]}
  </svg>`

/**
 * The layout switcher, in the viewer's actions: a button showing the chosen
 * layout's icon, which opens a menu of the three layouts. It starts hidden,
 * as full screen does: /share.js shows it, keeps what is chosen, and opens
 * and closes the menu. Where no script runs the viewer stays a stack.
 */
export const viewerLayoutMenu = (lang: Lang, current: ViewerLayout) => {
  const t = text[lang]
  return html`<div class="layout-menu" data-layout-menu hidden>
    <button
      type="button"
      class="button-secondary layout-toggle"
      aria-haspopup="menu"
      aria-expanded="false"
      aria-label="${t.current(t.names[current])}"
      data-layout-toggle
    >
      ${VIEWER_LAYOUTS.map((layout) => icon(layout, 22))}
      <svg
        aria-hidden="true"
        width="12"
        height="12"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2.4"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <path d="M6 9l6 6 6-6"></path>
      </svg>
    </button>
    <div class="layout-items" role="menu" aria-label="${t.menu}" hidden>
      ${VIEWER_LAYOUTS.map(
        (layout) =>
          html`<button
            type="button"
            role="menuitemradio"
            tabindex="-1"
            aria-checked="${String(layout === current)}"
            data-layout-choice="${layout}"
            data-current-label="${t.current(t.names[layout])}"
          >
            ${icon(layout, 24)}
            <span class="layout-name">${t.names[layout]}</span>
            <span class="layout-mark" aria-hidden="true">✓</span>
          </button>`,
      )}
    </div>
  </div>`
}
