import { html } from 'hono/html'
import type { Handle } from '../share/handle'
import { profilePath } from '../share/path'
import { messages, type Lang } from '../site/i18n'

const text = messages({
  ja: {
    follow: 'フォロー',
    following: 'フォロー中',
    unfollowShort: '解除する',
    confirm: (handle: Handle) => `@${handle} さんをフォローしますか？`,
    effect: (handle: Handle) =>
      `@${handle} さんが新しいスライドを公開すると、お知らせに届きます。相手には、あなたがフォローしたことが伝わります。フォローは、設定で解除できます。`,
    submit: 'フォローする',
    confirmRelease: (handle: Handle) =>
      `@${handle} さんのフォローを解除しますか？`,
    releaseTitle: 'フォローの解除',
    releaseEffect: (handle: Handle) =>
      `解除すると、@${handle} さんが新しいスライドを公開しても、お知らせは届かなくなります。`,
    release: 'フォローを解除する',
    muted: (handle: Handle) =>
      `@${handle} さんをフォローするには、先に設定でミュートを解除してください。`,
    settings: 'ミュートの設定を開く',
    signIn: 'フォローするには、ログインが必要です。',
    back: '戻る',
  },
  en: {
    follow: 'Follow',
    following: 'Following',
    unfollowShort: 'Unfollow',
    confirm: (handle: Handle) => `Follow @${handle}?`,
    effect: (handle: Handle) =>
      `You’ll receive a notification when @${handle} publishes new slides. They’ll be notified that you followed them. You can unfollow them in settings.`,
    submit: 'Follow',
    confirmRelease: (handle: Handle) => `Unfollow @${handle}?`,
    releaseTitle: 'Unfollow',
    releaseEffect: (handle: Handle) =>
      `If you unfollow @${handle}, you’ll stop receiving notifications when they publish new slides.`,
    release: 'Unfollow',
    muted: (handle: Handle) =>
      `To follow @${handle}, unmute them in settings first.`,
    settings: 'Open mute settings',
    signIn: 'Sign in to follow this author.',
    back: 'Go back',
  },
})

export type FollowState = 'none' | 'can-follow' | 'following'

export type ViewerAuthorState = FollowState | 'muted'

export const followTitle = (lang: Lang, following = false) =>
  following ? text[lang].releaseTitle : text[lang].follow

export function followLink(
  state: ViewerAuthorState,
  handle: string,
  slide: string,
  lang: Lang,
) {
  if (state === 'none') return ''
  const query = new URLSearchParams({ handle, slide })
  const t = text[lang]
  const following = state === 'following'
  const action = following ? t.release : t.follow
  return html`<a
    ${state === 'muted' ? 'hidden' : ''}
    data-slide-return
    href="/follows/new?${query.toString()}"
    data-follow-handle="${handle}"
    data-following="${String(following)}"
    data-follow-label="${t.follow}"
    data-following-label="${t.following}"
    data-release-label="${t.release}"
    title="${action}"
    aria-label="${action}"
    >${following ? t.following : t.follow}</a
  >`
}

export function profileFollowForm(
  state: FollowState,
  handle: Handle,
  lang: Lang,
) {
  if (state === 'none') return ''
  const t = text[lang]
  const slide = html`<input
    type="hidden"
    name="slide"
    value="${profilePath(handle)}"
  />`
  if (state === 'following')
    return html`<form method="post" action="/follows/${handle}/release">
      ${slide}
      <button
        type="submit"
        class="button-secondary following"
        aria-label="${t.release}"
        title="${t.release}"
      >
        <span class="state">${t.following}</span
        ><span class="act">${t.unfollowShort}</span>
      </button>
    </form>`
  return html`<form method="post" action="/follows">
    <input type="hidden" name="handle" value="${handle}" />
    ${slide}
    <button class="button-secondary" type="submit">${t.follow}</button>
  </form>`
}

export function followFormBody(
  handle: Handle,
  slide: string,
  following: boolean,
  lang: Lang,
) {
  const t = text[lang]
  const action = following ? `/follows/${handle}/release` : '/follows'
  return html`<div class="narrow">
    <h1>${following ? t.confirmRelease(handle) : t.confirm(handle)}</h1>
    <p>${following ? t.releaseEffect(handle) : t.effect(handle)}</p>
    <form method="post" action="${action}">
      ${following ? '' : html`<input type="hidden" name="handle" value="${handle}" />`}
      <input type="hidden" name="slide" value="${slide}" />
      <button class="button-primary" type="submit">
        ${following ? t.release : t.submit}
      </button>
    </form>
    <p><a class="button-secondary" href="${slide}">${t.back}</a></p>
  </div>`
}

export function mutedFollowBody(handle: Handle, slide: string, lang: Lang) {
  const t = text[lang]
  return html`<div class="narrow">
    <h1>${t.follow}</h1>
    <p>${t.muted(handle)}</p>
    <p><a class="button-primary" href="/settings#mutes">${t.settings}</a></p>
    <p><a class="button-secondary" href="${slide}">${t.back}</a></p>
  </div>`
}

export function followSignInBody(
  slide: string,
  signInLink: string,
  lang: Lang,
) {
  const t = text[lang]
  return html`<div class="narrow">
    <h1>${t.follow}</h1>
    <p>${t.signIn}</p>
    <p>
      <a
        class="button-primary"
        href="/auth/github?to=${encodeURIComponent(slide)}"
        >${signInLink}</a
      >
    </p>
    <p><a class="button-secondary" href="${slide}">${t.back}</a></p>
  </div>`
}
