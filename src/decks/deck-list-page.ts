import { html } from 'hono/html'
import { coverUrl } from '../share/cover'
import { dayFormats } from '../share/dates'
import { deckCover } from '../site/deck-card'
import { dropZoneBody } from '../site/drop-zone-body'
import { messages, type Lang } from '../site/i18n'
import { ownDeckName, type OwnDeck } from './own-decks'

const text = messages({
  ja: {
    title: 'スライドの管理',
    dropTitle: 'スライドをドロップして追加',
    dropNote: 'HTML、zip に対応。',
    list: 'スライドの一覧',
    updated: '更新',
    public: '公開中',
    authorOnly: '作者のみ',
    manage: '管理する',
    manageNamed: (name: string) => `${name} を管理する`,
  },
  en: {
    title: 'Your slides',
    dropTitle: 'Drop slides to add them',
    dropNote: 'HTML and zip files work.',
    list: 'List of your slides',
    updated: 'Updated',
    public: 'Public',
    authorOnly: 'Only you',
    manage: 'Manage',
    manageNamed: (name: string) => `Manage ${name}`,
  },
})

/** The page title of the list of slides, for renderPage. */
export const deckListTitle = (lang: Lang) => text[lang].title

/**
 * Where slides are dropped to add them from the list. The button starts
 * disabled and /drop.js enables it; the script takes the file, shows the
 * progress and opens the new slide's page.
 */
export const deckListDropFrame = (lang: Lang) => {
  const t = text[lang]
  return html`<section class="drop-zone" data-drop-zone="new">
    ${dropZoneBody(lang, { title: t.dropTitle, note: t.dropNote })}
  </section>`
}

/** The tag saying whether readers can open a slide now. */
export const visibilityChip = (isPublic: boolean, lang: Lang) =>
  isPublic
    ? html`<span class="status-chip status-public">${text[lang].public}</span>`
    : html`<span class="status-chip status-draft"
        >${text[lang].authorOnly}</span
      >`

const deckRow = (deck: OwnDeck, lang: Lang, contentBase: URL | null) => {
  const t = text[lang]
  const name = ownDeckName(deck)
  const updated = new Date(deck.updatedAt * 1000)
  const cover =
    deck.shown && contentBase
      ? coverUrl(contentBase, deck.shown.deploymentId, deck.shown.coverPath)
      : null
  return html`<li class="deck-row">
    ${deckCover(name, cover)}
    <div class="deck-row-text">
      <p class="deck-row-name">${name}</p>
      <p class="card-meta">
        ${t.updated}
        <time datetime="${updated.toISOString()}"
          >${dayFormats[lang].format(updated)}</time
        >
      </p>
    </div>
    ${visibilityChip(deck.isPublic, lang)}
    <a
      class="deck-row-manage"
      href="/slides/${deck.slug}"
      aria-label="${t.manageNamed(name)}"
      >${t.manage}</a
    >
  </li>`
}

/**
 * The list of the author's own slides: the heading, the place to drop more,
 * then one row per slide with its cover, name, the day it last changed,
 * whether readers can open it, and the way to its own page. With no slide
 * yet, the place to drop one is all there is.
 */
export function deckListBody(
  decks: readonly OwnDeck[],
  lang: Lang,
  contentBase: URL | null,
) {
  const t = text[lang]
  return html`<h1>${t.title}</h1>
    ${deckListDropFrame(lang)}
    ${
      decks.length
        ? html`<ul class="deck-rows" aria-label="${t.list}">
            ${decks.map((deck) => deckRow(deck, lang, contentBase))}
          </ul>`
        : ''
    }`
}
