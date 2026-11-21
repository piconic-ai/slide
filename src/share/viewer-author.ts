import { html } from 'hono/html'
import { faceImage } from '../profile/face'
import { followLink, type ViewerAuthorState } from '../follows/pages'
import type { Lang } from '../site/i18n'
import { loginPrompt } from '../site/login-prompt'

/** Who made the slides, as the viewer shows them under the title. */
export type ViewerAuthorView = Readonly<{
  handle: string
  /** The name they chose; before they chose one, the handle stands in. */
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
          view.avatarUrl ? faceImage(view.avatarUrl) : ''
        }</span
      >
      <span>${view.name ?? `@${view.handle}`}</span>
    </a>
    ${followLink(view.controls, view.handle, view.slide, lang)}
    ${view.controls === 'signed-out' ? loginPrompt('follow', view.slide, lang) : ''}
  </p>`
