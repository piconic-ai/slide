import { html } from 'hono/html'
import type { ViewerAuthorState } from '../follows/pages'
import { messages, type Lang } from '../site/i18n'
import { SERVICE_NAME } from '../site/service'
import { pageShell, PLAIN_PAGE_POLICY } from '../site/shell'
import { embedCodeOf } from '../embed/code'
import { oembedLink } from '../embed/pages'
import { viewerActions } from './viewer-actions'
import { viewerAuthor } from './viewer-author'
import { viewerArticleFrame } from './viewer-article-frame'
import type { StoredLink } from '../links/store'
import { viewerLinksFrame } from './viewer-links-frame'
import { viewerCitations, type ViewerCitations } from './viewer-citations'
import { viewerStyle } from './viewer-style'

const text = messages({
  ja: {
    previewDraft: 'まだ公開していません。いまはあなただけが見ています。',
    previewPaused: '公開を止めています。いま読者には見えません。',
    previewNewer: 'いま見ているのは、まだ公開していない新しい版です。',
    publishDraft: '公開する',
    publishPaused: 'もう一度公開する',
    publishNewer: 'この版を公開する',
    previewUnavailable:
      'このブラウザでは、ここで確かめられません。公開すると、読者と同じように見られます。',
    previewExpired:
      '確認の有効期限が切れました。ページを読み込み直してください。',
    unavailableTitle: '資料は公開されていません',
    unavailableHeading: 'この資料は公開されていません',
    unavailableHint:
      'URL が正しいか、作者が公開を停止していないかを確認してください。',
    profileMissingTitle: 'ページが見つかりません',
    profileMissingHeading: 'このページは見つかりません',
    profileMissingHint: 'URL が正しいかを確認してください。',
  },
  en: {
    previewDraft: 'Not public yet. Only you can see this now.',
    previewPaused: 'Publishing is paused. Readers cannot see this now.',
    previewNewer: 'You are looking at a new version that is not public yet.',
    publishDraft: 'Publish',
    publishPaused: 'Publish again',
    publishNewer: 'Publish this version',
    previewUnavailable:
      'This browser cannot show it here. Once published, it opens as readers see it.',
    previewExpired: 'The time to check this has run out. Reload the page.',
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
 * followedLinkPage. Images are the service's own, the pictures of the
 * author and of the signed-in reader, which GitHub serves, and the covers of
 * the decks on either side of a citation. A deck may name one of its own
 * files as its cover, and the cards change when the reader mutes an author,
 * so any deployment origin may give an image. No cited deck is framed.
 */
export const viewerPolicy = (
  contentOrigin: string,
  contentBase: URL,
  /** Owner-only slides open by a form to their origin; nothing else does. */
  launching = false,
) =>
  [
    "default-src 'none'",
    `frame-src ${contentOrigin} 'self'`,
    "script-src 'self'",
    "connect-src 'self'",
    "style-src 'unsafe-inline'",
    `img-src 'self' ${contentBase.protocol}//*.${contentBase.host}`,
    "base-uri 'none'",
    // Owner-only slides open by a form to their origin (the launch), and the
    // notice above them publishes by a form to this origin.
    `form-action ${launching ? `${contentOrigin} 'self'` : "'none'"}`,
    "frame-ancestors 'none'",
  ].join('; ')

/** What the author is told above slides readers cannot see. */
export type PreviewNotice = Readonly<{
  kind: 'draft' | 'paused' | 'newer'
  /** The publication form, the same as the deck page's: publishes the version shown. */
  publish: Readonly<{
    action: string
    deploymentId: string
    revision: number
  }>
}>

function previewNotice(notice: PreviewNotice, lang: Lang) {
  const t = text[lang]
  const message = {
    draft: t.previewDraft,
    paused: t.previewPaused,
    newer: t.previewNewer,
  }[notice.kind]
  const label = {
    draft: t.publishDraft,
    paused: t.publishPaused,
    newer: t.publishNewer,
  }[notice.kind]
  const { publish } = notice
  return html`<div class="viewer-notice" role="status">
      <p>${message}</p>
      <form method="post" action="${publish.action}">
        <input type="hidden" name="action" value="publish" />
        <input
          type="hidden"
          name="deploymentId"
          value="${publish.deploymentId}"
        />
        <input
          type="hidden"
          name="expectedRevision"
          value="${publish.revision}"
        />
        <input type="hidden" name="next" value="viewer" />
        <button class="button-primary" type="submit" data-once>${label}</button>
      </form>
    </div>
    <div
      class="viewer-notice viewer-notice-quiet"
      data-preview-unavailable
      hidden
    >
      <p data-reason="unsupported" hidden>${t.previewUnavailable}</p>
      <p data-reason="expired" hidden>${t.previewExpired}</p>
    </div>`
}

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
 * title and description, as its author gave them in the deck, and an image:
 * its cover, or the page the URL names.
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
    /** The cover, or the page the URL names, for services that preview it. */
    imageUrl: string
    shareUrl: string
    contentUrl: string
    /**
     * Set for slides only their author may open: the frame starts empty and
     * a form posts the one-time token to the slides' own origin, so the
     * token is in no URL. `contentUrl` then names where the slides are.
     */
    launch: Readonly<{ action: string; token: string }> | null
    /** The notice above slides only their author sees; null otherwise. */
    preview: PreviewNotice | null
    controls: ViewerAuthorState
    /** The author's own page for these slides, for the author alone. */
    editPath: string | null
    author: Readonly<{ name: string | null; avatarUrl: string | null }>
    citations: ViewerCitations
    /** The deck's related links, in the order they were added. */
    links: readonly StoredLink[]
  },
  lang: Lang,
  url: URL,
) {
  const name = view.title ?? view.slug
  const slide = new URL(view.shareUrl).pathname
  const { handle, controls, shareUrl, editPath } = view
  // The slides as a whole: what is copied and posted until a page is told,
  // and what another site embeds.
  const deckUrl = new URL(`/@${handle}/${view.slug}`, shareUrl).href
  const { launch } = view
  return pageShell({
    lang,
    title: `${name} - @${handle}`,
    url,
    pageClass: 'viewer',
    head: html`${linkPreview(name, view)} ${oembedLink(deckUrl, name)}`,
    style: viewerStyle,
    body: html`${view.preview ? previewNotice(view.preview, lang) : ''}
      <div class="stage">
        <iframe
          id="deck"
          data-deck
          data-share="/@${handle}/${view.slug}"
          ${
            launch
              ? html`name="deck-frame"
                data-origin="${new URL(view.contentUrl).origin}"`
              : html`src="${view.contentUrl}"`
          }
          title="${name}"
          sandbox="allow-scripts allow-same-origin"
          allow="fullscreen"
          referrerpolicy="no-referrer"
          data-autofocus
        ></iframe>
        ${
          launch
            ? html`<form
                method="post"
                action="${launch.action}"
                target="deck-frame"
                rel="noreferrer"
                data-launch
                hidden
              >
                <input type="hidden" name="token" value="${launch.token}" />
              </form>`
            : ''
        }
      </div>
      <div class="viewer-head">
        <div class="viewer-title">
          <h1>${name}</h1>
          ${viewerAuthor({ ...view.author, handle, slide, controls }, lang)}
        </div>
        ${viewerActions(
          {
            handle,
            title: name,
            slide,
            shareUrl: deckUrl,
            // Every viewer is of public slides, which may be embedded.
            embedCode: embedCodeOf(deckUrl, name),
            controls,
            preview: launch !== null,
            editPath,
          },
          lang,
        )}
      </div>
      ${
        view.description
          ? html`<p class="viewer-description">${view.description}</p>`
          : ''
      }
      ${viewerLinksFrame(view.links, lang)} ${viewerArticleFrame()}
      ${viewerCitations(view.citations, lang)}`,
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
