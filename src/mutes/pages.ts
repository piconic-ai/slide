import { html } from 'hono/html'
import { accountTitles } from '../decks/pages'
import type { Handle } from '../share/handle'
import { messages, type Lang } from '../site/i18n'

const text = messages({
  ja: {
    title: 'この作者をミュート',
    heading: (handle: Handle) => `@${handle} をミュートしますか？`,
    effect:
      'この作者のスライドが、あなたに表示される一覧から外れます。URL から直接開けば、読めます。ミュートは、設定で解除できます。',
    signIn: 'ミュートするには、ログインが必要です。',
    back: 'スライドに戻る',
  },
  en: {
    title: 'Mute this author',
    heading: (handle: Handle) => `Mute @${handle}?`,
    effect:
      'This author’s slides will disappear from your lists, but you can still open them by URL and release the mute in settings.',
    signIn: 'Sign in to mute this author.',
    back: 'Back to the slides',
  },
})

export const muteTitle = (lang: Lang) => text[lang].title

export function muteFormBody(handle: Handle, slide: string, lang: Lang) {
  const t = text[lang]
  return html`<h1>${t.heading(handle)}</h1>
    <p>${t.effect}</p>
    <form method="post" action="/mutes">
      <input type="hidden" name="handle" value="${handle}" />
      <input type="hidden" name="slide" value="${slide}" />
      <button type="submit">${t.title}</button>
    </form>
    <p><a href="${slide}">${t.back}</a></p>`
}

export function muteSignInBody(slide: string, lang: Lang) {
  const t = text[lang]
  return html`<h1>${t.title}</h1>
    <p>${t.signIn}</p>
    <p>
      <a href="/auth/github?to=${encodeURIComponent(slide)}"
        >${accountTitles(lang).signInLink}</a
      >
    </p>
    <p><a href="${slide}">${t.back}</a></p>`
}
