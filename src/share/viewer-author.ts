import { html } from 'hono/html'
import { followLink, type ViewerAuthorState } from '../follows/pages'
import type { Lang } from '../site/i18n'

/** Who made the slides, as the viewer shows them under the title. */
export type ViewerAuthorView = Readonly<{
  handle: string
  /** Their name on GitHub; before the first sync, the handle stands in. */
  name: string | null
  avatarUrl: string | null
  /** The share path the follow link returns to. */
  slide: string
  controls: ViewerAuthorState
}>

/**
 * The author's row: their picture, or their initial where they have none,
 * their name as a link to their profile, and the way to follow them.
 */
export const viewerAuthor = (view: ViewerAuthorView, lang: Lang) =>
  html`<p class="viewer-author">
    <a class="author-link" href="/@${view.handle}">
      <span class="author-face" aria-hidden="true"
        >${view.handle.slice(0, 1)}${
          view.avatarUrl
            ? html`<img
                data-cover
                src="${view.avatarUrl}"
                alt=""
                referrerpolicy="no-referrer"
              />`
            : ''
        }</span
      >
      <span>${view.name ?? `@${view.handle}`}</span>
    </a>
    ${followLink(view.controls, view.handle, view.slide, lang)}
  </p>`
