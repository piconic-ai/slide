import { html } from 'hono/html'
import type { ViewerAuthorState } from '../follows/pages'
import { AVATAR_ORIGIN } from '../profile/github-profile'
import { messages, type Lang } from '../site/i18n'
import { SERVICE_NAME } from '../site/service'
import { pageShell, PLAIN_PAGE_POLICY } from '../site/shell'
import { viewerActions } from './viewer-actions'
import { viewerAuthor } from './viewer-author'
import { viewerCitations } from './viewer-citations'
import { viewerStyle } from './viewer-style'

const text = messages({
  ja: {
    unavailableTitle: '資料は公開されていません',
    unavailableHeading: 'この資料は公開されていません',
    unavailableHint:
      'URL が正しいか、作者が公開を停止していないかを確認してください。',
    profileMissingTitle: 'ページが見つかりません',
    profileMissingHeading: 'このページは見つかりません',
    profileMissingHint: 'URL が正しいかを確認してください。',
  },
  en: {
    unavailableTitle: 'Slides not available',
    unavailableHeading: 'These slides are not available',
    unavailableHint:
      'Check that the URL is correct, or the author may have stopped sharing them.',
    profileMissingTitle: 'Page not found',
    profileMissingHeading: 'This page was not found',
    profileMissingHint: 'Check that the URL is correct.',
  },
})

/**
 * The viewer runs only service markup and its own script. Author files load
 * in the iframe from the deployment's origin. The frame may also load the
 * service's own page that hands a followed share link to the viewer; see
 * followedLinkPage. Images are the service's own and the pictures of the
 * author and of the signed-in reader, which GitHub serves.
 */
export const viewerPolicy = (contentOrigin: string) =>
  [
    "default-src 'none'",
    `frame-src ${contentOrigin} 'self'`,
    "script-src 'self'",
    "connect-src 'self'",
    "style-src 'unsafe-inline'",
    `img-src 'self' ${AVATAR_ORIGIN}`,
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join('; ')

/** Shown alike for missing, draft and paused decks. */
export const UNAVAILABLE_POLICY = PLAIN_PAGE_POLICY

/** Only the viewer may frame the page that hands it a followed link. */
export const followedLinkPolicy = (nonce: string) =>
  `default-src 'none'; script-src 'nonce-${nonce}'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'`

/**
 * Answers a share URL requested inside a frame. A deck cannot move the
 * viewer: its frame is sandboxed without top navigation. When a reader
 * follows a deck's link to another deck, the frame loads this page instead,
 * and its script asks the viewer to open the path. The viewer accepts the
 * request only from this origin and only for a share path, so a deck can
 * send readers to other decks here and nowhere else.
 */
export const followedLinkPage = (nonce: string) =>
  html`<!doctype html>
    <meta charset="utf-8" />
    <title>${SERVICE_NAME}</title>
    <script nonce="${nonce}">
      if (parent !== window)
        parent.postMessage(
          { type: 'slide:open', path: location.pathname },
          location.origin,
        )
    </script>`

/**
 * What a service shows when the share URL is posted there: the deck's own
 * title, description and cover image, as its author gave them in the deck.
 */
const linkPreview = (
  name: string,
  view: Readonly<{
    description: string | null
    shareUrl: string
    imageUrl: string
  }>,
) =>
  html`<meta property="og:type" content="article" />
    <meta property="og:site_name" content="${SERVICE_NAME}" />
    <meta property="og:title" content="${name}" />
    <meta property="og:url" content="${view.shareUrl}" />
    <meta property="og:image" content="${view.imageUrl}" />
    <meta name="twitter:card" content="summary_large_image" />
    ${
      view.description
        ? html`<meta name="description" content="${view.description}" />
            <meta property="og:description" content="${view.description}" />`
        : ''
    }`

/**
 * The trusted viewer of a public deck. The deck runs in a cross-origin
 * iframe sandboxed without top navigation, popups, downloads, or forms.
 * Under it, in order: the title, the author with the way to follow them,
 * the actions, the description, and the citations.
 */
export function viewerPage(
  view: {
    handle: string
    slug: string
    title: string | null
    description: string | null
    /** The deck's cover image, for services that preview the share URL. */
    imageUrl: string
    shareUrl: string
    contentUrl: string
    controls: ViewerAuthorState
    author: Readonly<{ name: string | null; avatarUrl: string | null }>
  },
  lang: Lang,
  url: URL,
) {
  const name = view.title ?? view.slug
  const slide = new URL(view.shareUrl).pathname
  const { handle, controls, shareUrl } = view
  return pageShell({
    lang,
    title: `${name} - @${handle}`,
    url,
    mainClass: 'viewer',
    head: html`${linkPreview(name, view)} ${viewerStyle}`,
    body: html`<div class="stage">
        <iframe
          id="deck"
          data-deck
          data-share="/@${handle}/${view.slug}"
          src="${view.contentUrl}"
          title="${name}"
          sandbox="allow-scripts allow-same-origin"
          allow="fullscreen"
          referrerpolicy="no-referrer"
          data-autofocus
        ></iframe>
      </div>
      <div class="viewer-head">
        <div class="viewer-title">
          <h1>${name}</h1>
          ${viewerAuthor({ ...view.author, handle, slide, controls }, lang)}
        </div>
        ${viewerActions({ handle, slide, shareUrl, controls }, lang)}
      </div>
      ${
        view.description
          ? html`<p class="viewer-description">${view.description}</p>`
          : ''
      }
      ${viewerCitations()}`,
  })
}

/** Which kind of share path could not be shown. */
export type UnavailableKind = 'deck' | 'profile'

/**
 * The page for a share path readers cannot open. A deck's page does not say
 * why, and a profile's page reads the same for a handle nobody holds and
 * for an account an operator suspended.
 */
export const unavailablePage = (
  lang: Lang,
  url: URL,
  kind: UnavailableKind = 'deck',
) => {
  const all = text[lang]
  const t =
    kind === 'profile'
      ? {
          unavailableTitle: all.profileMissingTitle,
          unavailableHeading: all.profileMissingHeading,
          unavailableHint: all.profileMissingHint,
        }
      : all
  return pageShell({
    lang,
    title: t.unavailableTitle,
    url,
    width: 'narrow',
    body: html`<h1>${t.unavailableHeading}</h1>
      <p>${t.unavailableHint}</p>`,
  })
}
