import { html } from 'hono/html'
import type { Handle } from '../share/handle'
import { profilePath } from '../share/path'
import type { CommunityColor } from '../site/cover-pattern'
import { messages, type Lang } from '../site/i18n'
import { communityStyle } from './community-style'
import { logoOf } from './logo'
import { NEW_COMMUNITY_LANDING } from './new-landing'

const text = messages({
  ja: {
    title: 'コミュニティの管理',
    createTitle: '勉強会やカンファレンスのページを作る',
    create: 'コミュニティを作る',
    createNote: '紐づけ用リンクに合うイベントの発表が、自動で集まります。',
    list: 'コミュニティの一覧',
    edit: '編集する',
    editNamed: (name: string) => `${name} を編集する`,
  },
  en: {
    title: 'Your communities',
    createTitle: 'Make a page for a meetup or a conference',
    create: 'Create a community',
    createNote:
      'Talks at events that match its links gather there by themselves.',
    list: 'List of your communities',
    edit: 'Edit',
    editNamed: (name: string) => `Edit ${name}`,
  },
})

/** A community the person runs, as its row shows it. */
export type ManagedCommunity = Readonly<{
  id: number
  handle: Handle
  name: string
  color: CommunityColor
  logoAt: number | null
}>

/** The page title of the communities a person runs, for renderPage. */
export const communityManageTitle = (lang: Lang) => text[lang].title

// The rows take the slide list's (.deck-row) with a logo for the cover and
// no tag; the frame to make one is the size of the slide list's drop zone.
const style = html`<style>
  .community-create {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
    box-sizing: border-box;
    margin: 40px 0 0;
    padding: 24px 16px;
    border: 1px solid var(--border);
    border-radius: var(--radius-block);
    text-align: center;
  }
  .community-create p {
    max-width: 40em;
    margin: 0;
  }
  .community-row.deck-row {
    grid-template-columns: 48px minmax(0, 1fr) auto;
  }
  .community-row .deck-row-cover {
    line-height: 0;
  }
  .community-row .card-meta {
    overflow-wrap: anywhere;
  }
</style>`

/** Where a community is made from the list (F30-AC60). */
const createFrame = (lang: Lang) => {
  const t = text[lang]
  return html`<section class="community-create">
    <p class="drop-title">${t.createTitle}</p>
    <a class="button-secondary" href="${NEW_COMMUNITY_LANDING}">${t.create}</a>
    <p class="drop-note">${t.createNote}</p>
  </section>`
}

const communityRow = (community: ManagedCommunity, lang: Lang) => {
  const t = text[lang]
  const page = profilePath(community.handle)
  return html`<li class="deck-row community-row">
    <a class="deck-row-cover" href="${page}" tabindex="-1" aria-hidden="true"
      >${logoOf(community, 48)}</a
    >
    <div class="deck-row-text">
      <p class="deck-row-name"><a href="${page}">${community.name}</a></p>
      <p class="card-meta">@${community.handle}</p>
    </div>
    <a
      class="deck-row-edit"
      href="${page}/edit"
      aria-label="${t.editNamed(community.name)}"
      >${t.edit}</a
    >
  </li>`
}

/**
 * The communities a person runs, laid out as the list of their slides: the
 * heading, the way to make one, then one row per community with its logo,
 * name, handle and the way to edit it (F30-AC60). With none yet, the way to
 * make one is all there is (F30-AC61).
 */
export function communityManageBody(
  managed: readonly ManagedCommunity[],
  lang: Lang,
) {
  const t = text[lang]
  return html`${communityStyle}${style}
    <h1>${t.title}</h1>
    ${createFrame(lang)}
    ${
      managed.length
        ? html`<ul class="deck-rows" aria-label="${t.list}">
            ${managed.map((community) => communityRow(community, lang))}
          </ul>`
        : ''
    }`
}
