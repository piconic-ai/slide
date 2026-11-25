import { html } from 'hono/html'
import type { Handle } from '../share/handle'
import { profilePath } from '../share/path'
import { messages, type Lang } from '../site/i18n'
import { loginPromptTrigger, type LoginPromptKind } from '../site/login-prompt'

const text = messages({
  ja: {
    follow: 'フォロー',
    following: 'フォロー中',
    unfollowShort: '解除する',
    confirm: (handle: Handle) => `@${handle} さんをフォローしますか？`,
    effect: (handle: Handle) =>
      `@${handle} さんが新しいスライドを公開すると、お知らせに届きます。相手には、あなたがフォローしたことが伝わります。フォローは、自分のプロフィールの「フォロー中」で解除できます。`,
    submit: 'フォローする',
    confirmRelease: (handle: Handle) =>
      `@${handle} さんのフォローを解除しますか？`,
    releaseTitle: 'フォローの解除',
    releaseEffect: (handle: Handle) =>
      `解除すると、@${handle} さんが新しいスライドを公開しても、お知らせは届かなくなります。`,
    release: 'フォローを解除する',
    followOf: (handle: Handle) => `@${handle} さんをフォローする`,
    releaseOf: (handle: Handle) => `@${handle} さんのフォローを解除する`,
    muted: (handle: Handle) =>
      `@${handle} さんをフォローするには、先に設定でミュートを解除してください。`,
    settings: 'ミュートの設定を開く',
    signIn: 'フォローするには、ログインが必要です。',
    refused: 'この人はフォローできません。',
    back: '戻る',
  },
  en: {
    follow: 'Follow',
    following: 'Following',
    unfollowShort: 'Unfollow',
    confirm: (handle: Handle) => `Follow @${handle}?`,
    effect: (handle: Handle) =>
      `You’ll receive a notification when @${handle} publishes new slides. They’ll be notified that you followed them. You can unfollow them under Following on your profile.`,
    submit: 'Follow',
    confirmRelease: (handle: Handle) => `Unfollow @${handle}?`,
    releaseTitle: 'Unfollow',
    releaseEffect: (handle: Handle) =>
      `If you unfollow @${handle}, you’ll stop receiving notifications when they publish new slides.`,
    release: 'Unfollow',
    followOf: (handle: Handle) => `Follow @${handle}`,
    releaseOf: (handle: Handle) => `Unfollow @${handle}`,
    muted: (handle: Handle) =>
      `To follow @${handle}, unmute them in settings first.`,
    settings: 'Open mute settings',
    signIn: 'Sign in to follow this author.',
    refused: 'You can’t follow this person.',
    back: 'Go back',
  },
})

/**
 * What a reader can do about an author: nothing, follow once signed in (the
 * reader is not), follow, or unfollow.
 */
export type FollowState = 'none' | 'signed-out' | 'can-follow' | 'following'

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
  if (state === 'signed-out')
    return html`<a
      data-slide-return
      ${loginPromptTrigger('follow')}
      href="/follows/new?${query.toString()}"
      title="${t.follow}"
      aria-label="${t.follow}"
      >${t.follow}</a
    >`
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

/** A form a follow button sends: where, and the hidden fields it carries. */
export type FollowFormTarget = Readonly<{
  action: string
  fields: Readonly<Record<string, string>>
}>

/**
 * What a follow button follows, a person or a community: where each press
 * goes, the names of its buttons, and which sign-in prompt asks a reader who
 * is not signed in. `tone: 'ink'` draws "follow" as the ink pill.
 */
export type FollowTarget = Readonly<{
  /** Where the sign-in link leads where no script opens the prompt. */
  signIn: string
  follow: FollowFormTarget
  release: FollowFormTarget
  followName: string
  releaseName: string
  prompt: LoginPromptKind
  tone?: 'quiet' | 'ink'
}>

const hiddenFields = (fields: Readonly<Record<string, string>>) =>
  Object.entries(fields).map(
    ([name, value]) =>
      html`<input type="hidden" name="${name}" value="${value}" />`,
  )

/**
 * The button that follows or unfollows at once, without a page between,
 * whatever it follows. A reader who is not signed in gets a link that opens
 * the sign-in prompt of `target.prompt`.
 */
export function followButton(
  state: FollowState,
  target: FollowTarget,
  lang: Lang,
) {
  if (state === 'none') return ''
  const t = text[lang]
  const tone = target.tone === 'ink' ? 'button-primary' : 'button-secondary'
  if (state === 'signed-out')
    return html`<span class="follow-form"
      ><a
        class="${tone}"
        ${loginPromptTrigger(target.prompt)}
        href="${target.signIn}"
        aria-label="${target.followName}"
        >${t.follow}</a
      ></span
    >`
  if (state === 'following')
    return html`<form
      class="follow-form"
      method="post"
      action="${target.release.action}"
    >
      ${hiddenFields(target.release.fields)}
      <button
        type="submit"
        class="button-secondary following"
        aria-label="${target.releaseName}"
        title="${t.release}"
      >
        <span class="state">${t.following}</span
        ><span class="act">${t.unfollowShort}</span>
      </button>
    </form>`
  const { action, fields } = target.follow
  return html`<form class="follow-form" method="post" action="${action}">
    ${hiddenFields(fields)}
    <button class="${tone}" type="submit" aria-label="${target.followName}">
      ${t.follow}
    </button>
  </form>`
}

/**
 * The button that follows or unfollows a person at once. `back` is the page
 * it sits on, where the reader returns: a profile, or one of a profile's
 * lists of people. In a list every row has a button, so `named` puts the
 * person in each button's name.
 */
export function followForm(
  state: FollowState,
  handle: Handle,
  back: string,
  lang: Lang,
  named = false,
) {
  const t = text[lang]
  return followButton(
    state,
    {
      signIn: `/follows/new?${new URLSearchParams({ handle, slide: back }).toString()}`,
      follow: { action: '/follows', fields: { handle, slide: back } },
      release: {
        action: `/follows/${handle}/release`,
        fields: { slide: back },
      },
      followName: named ? t.followOf(handle) : t.follow,
      releaseName: named ? t.releaseOf(handle) : t.release,
      prompt: 'follow',
    },
    lang,
  )
}

/**
 * The follow button of a profile whose author does not take this reader's
 * follow: pressed, it does nothing, and the line under it says only that.
 */
export function refusedFollowForm(lang: Lang) {
  const t = text[lang]
  return html`<div class="follow-refused">
    <button
      class="button-secondary"
      type="button"
      disabled
      aria-describedby="follow-refused"
    >
      ${t.follow}
    </button>
    <p class="field-note" id="follow-refused">${t.refused}</p>
  </div>`
}

/** The page /follows/new shows a reader whose follow would not be kept. */
export function refusedFollowBody(slide: string, lang: Lang) {
  const t = text[lang]
  return html`<div class="narrow">
    <h1>${t.follow}</h1>
    <p>${t.refused}</p>
    <p><a class="button-secondary" href="${slide}">${t.back}</a></p>
  </div>`
}

/** The follow button beside an author's name on their profile. */
export const profileFollowForm = (
  state: FollowState,
  handle: Handle,
  lang: Lang,
) => followForm(state, handle, profilePath(handle), lang)

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
      <a class="button-primary" href="/login?to=${encodeURIComponent(slide)}"
        >${signInLink}</a
      >
    </p>
    <p><a class="button-secondary" href="${slide}">${t.back}</a></p>
  </div>`
}
