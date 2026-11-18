import { html } from 'hono/html'
import type { Handle } from '../share/handle'
import { messages, type Lang } from '../site/i18n'

const text = messages({
  ja: {
    follow: 'フォロー',
    following: 'フォロー中',
    confirm: (handle: Handle) => `@${handle} さんをフォローしますか？`,
    effect: (handle: Handle) =>
      `@${handle} さんが新しいスライドを公開すると、お知らせに届きます。相手には、あなたがフォローしたことが伝わります。フォローは、設定で解除できます。`,
    submit: 'フォローする',
    confirmRelease: (handle: Handle) =>
      `@${handle} さんのフォローを解除しますか？`,
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
    confirm: (handle: Handle) => `Follow @${handle}?`,
    effect: (handle: Handle) =>
      `You’ll receive a notification when @${handle} publishes new slides. They’ll be notified that you followed them. You can unfollow them in settings.`,
    submit: 'Follow',
    confirmRelease: (handle: Handle) => `Unfollow @${handle}?`,
    release: 'Unfollow',
    muted: (handle: Handle) =>
      `To follow @${handle}, unmute them in settings first.`,
    settings: 'Open mute settings',
    signIn: 'Sign in to follow this author.',
    back: 'Go back',
  },
})

export type FollowState = 'none' | 'can-follow' | 'following'

export const followTitle = (lang: Lang) => text[lang].follow

export function followLink(
  state: FollowState,
  handle: string,
  slide: string,
  lang: Lang,
) {
  if (state === 'none') return ''
  const query = new URLSearchParams({ handle, slide })
  const label = state === 'following' ? text[lang].following : text[lang].follow
  return html`<a data-slide-return href="/follows/new?${query.toString()}"
    >${label}</a
  >`
}

export function followFormBody(
  handle: Handle,
  slide: string,
  following: boolean,
  lang: Lang,
) {
  const t = text[lang]
  const action = following ? `/follows/${handle}/release` : '/follows'
  return html`<h1>
      ${following ? t.confirmRelease(handle) : t.confirm(handle)}
    </h1>
    ${following ? '' : html`<p>${t.effect(handle)}</p>`}
    <form method="post" action="${action}">
      ${following ? '' : html`<input type="hidden" name="handle" value="${handle}" />`}
      <input type="hidden" name="slide" value="${slide}" />
      <button type="submit">${following ? t.release : t.submit}</button>
    </form>
    <p><a href="${slide}">${t.back}</a></p>`
}

export function mutedFollowBody(handle: Handle, slide: string, lang: Lang) {
  const t = text[lang]
  return html`<h1>${t.follow}</h1>
    <p>${t.muted(handle)}</p>
    <p><a href="/settings#mutes">${t.settings}</a></p>
    <p><a href="${slide}">${t.back}</a></p>`
}

export function followSignInBody(
  slide: string,
  signInLink: string,
  lang: Lang,
) {
  const t = text[lang]
  return html`<h1>${t.follow}</h1>
    <p>${t.signIn}</p>
    <p>
      <a href="/auth/github?to=${encodeURIComponent(slide)}">${signInLink}</a>
    </p>
    <p><a href="${slide}">${t.back}</a></p>`
}
