import { html } from 'hono/html'
import { messages, type Lang } from './i18n'

/** The actions that ask a reader who is not signed in to sign in first. */
export type LoginPromptKind = 'follow' | 'mute' | 'report'

const text = messages({
  ja: {
    follow: {
      title: 'フォローするには、ログインしてください',
      body: 'ログインすると、フォローした人が新しいスライドを公開したときに、ヘッダーのベルのお知らせで受け取れます。トップにも「フォロー中の人の新着」が並びます。',
    },
    mute: {
      title: 'ミュートするには、ログインしてください',
      body: 'ログインすると、この作者のスライドを、あなたに表示される一覧から外せます。ほかの読者の画面は変わりません。',
    },
    report: {
      title: '通報するには、ログインしてください',
      body: 'ログインすると、読者をだます内容や迷惑なスライドを、運営に通報できます。通報した人がだれかは、運営の一覧にも出ません。',
    },
    continue: 'ログインして続ける',
    close: '閉じる',
  },
  en: {
    follow: {
      title: 'Sign in to follow',
      body: 'Once you sign in, you get a notification when someone you follow publishes new slides, and their latest appear on your top page.',
    },
    mute: {
      title: 'Sign in to mute',
      body: 'Once you sign in, you can take this author’s slides off your lists. Other readers see no change.',
    },
    report: {
      title: 'Sign in to report',
      body: 'Once you sign in, you can report slides that deceive readers or are abusive. Who reported is not shown, even in the operators’ list.',
    },
    continue: 'Sign in to continue',
    close: 'Close',
  },
})

/**
 * The attributes that make a link or a button open the prompt of `kind`.
 * /share.js listens for them; without scripts the link it sits on is
 * followed, to the page that asks for the sign-in.
 */
export const loginPromptTrigger = (kind: LoginPromptKind) =>
  html`data-login-prompt="${kind}" aria-haspopup="dialog"`

/**
 * What the prompt of `kind` says and where it leads, kept inert in the page
 * until /share.js opens a copy of it. `to` is the share path the reader
 * returns to after signing in; /login accepts nothing else.
 */
export const loginPrompt = (kind: LoginPromptKind, to: string, lang: Lang) => {
  const t = text[lang]
  const id = `login-prompt-${kind}`
  return html`<template data-login-prompt-for="${kind}">
    <div
      class="login-prompt"
      role="dialog"
      aria-modal="true"
      aria-labelledby="${id}-title"
    >
      <div class="login-prompt-panel">
        <h2 id="${id}-title">${t[kind].title}</h2>
        <p>${t[kind].body}</p>
        <div class="login-prompt-actions">
          <a class="button-primary" href="/login?to=${encodeURIComponent(to)}"
            >${t.continue}</a
          >
          <button
            type="button"
            class="button-secondary"
            data-login-prompt-close
          >
            ${t.close}
          </button>
        </div>
      </div>
    </div>
  </template>`
}
