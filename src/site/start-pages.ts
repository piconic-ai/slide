import { html } from 'hono/html'
import { messages, type Lang } from './i18n'

const text = messages({
  ja: {
    title: 'はじめる',
    lead: 'slide は GitHub アカウントで使います。はじめての方も、すでに使っている方も、同じボタンから進めます。',
    action: 'GitHub で登録・ログイン',
    nextHeading: 'このあとの流れ',
    steps: [
      'GitHub の画面で、本人であることを確かめます。',
      'デッキの管理画面に移ります。',
      'リポジトリを連携し、GitHub Actions から最初のデッキを push します。',
    ],
  },
  en: {
    title: 'Get started',
    lead: 'You use slide with your GitHub account. New here or coming back, the same button takes you in.',
    action: 'Sign up or sign in with GitHub',
    nextHeading: 'What happens next',
    steps: [
      'GitHub confirms that it is you.',
      'You land on the page that manages your decks.',
      'Connect a repository, then push your first deck from GitHub Actions.',
    ],
  },
})

export const startTitle = (lang: Lang) => text[lang].title

/** The one way in: new and returning authors both sign in with GitHub. */
export const startBody = (lang: Lang) => {
  const t = text[lang]
  return html`<h1>${t.title}</h1>
    <p>${t.lead}</p>
    <p><a class="cta" href="/auth/github">${t.action}</a></p>
    <h2>${t.nextHeading}</h2>
    <ol>
      ${t.steps.map((step) => html`<li>${step}</li>`)}
    </ol>`
}
