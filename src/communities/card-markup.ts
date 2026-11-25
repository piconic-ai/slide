import { html } from 'hono/html'
import type { CommunityCard } from './community-card'

const cover = (card: CommunityCard) =>
  card.cover.kind === 'image'
    ? html`<img src="${card.cover.url}" alt="" referrerpolicy="no-referrer" />`
    : card.cover.squares.map((square) => html`<span class="${square}"></span>`)

const logo = (card: CommunityCard) =>
  card.logo.kind === 'image'
    ? html`<img
        class="community-card-logo"
        src="${card.logo.url}"
        alt=""
        width="48"
        height="48"
      />`
    : html`<span
        class="community-card-logo ${card.logo.className}"
        aria-hidden="true"
        >${card.logo.letter}</span
      >`

/**
 * One community as a list shows it (F30-AC44): its cover, its logo and name,
 * and its description cut at two lines, the whole a link to its page. The
 * cover and the logo are decoration beside the name, so they are hidden
 * from screen readers. The top page's section draws the same markup
 * (components/NewCommunities.tsx).
 */
export const communityCard = (card: CommunityCard) =>
  html`<li class="community-card">
    <a href="${card.href}">
      <span
        class="community-card-cover community-card-cover-${card.cover.kind}"
        aria-hidden="true"
        >${cover(card)}</span
      >
      <span class="community-card-head"
        >${logo(card)}<span class="community-card-name"
          >${card.name}</span
        ></span
      >
      <span class="community-card-description">${card.description}</span>
    </a>
  </li>`
