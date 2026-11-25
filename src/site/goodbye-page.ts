import { SERVICE_NAME } from './service'
import { html } from 'hono/html'
import { messages, type Lang } from './i18n'
import { pageShell, PLAIN_PAGE_POLICY } from './shell'

/** Where leaving the service ends (F28-AC77). A page of service markup only. */
export const GOODBYE_PATH = '/goodbye'
export const GOODBYE_PAGE_POLICY = PLAIN_PAGE_POLICY

const text = messages({
  ja: {
    title: '退会しました',
    thanks: 'ご利用ありがとうございました。退会の手続きが完了しました。',
    top: 'トップへ戻る',
  },
  en: {
    title: 'Your account is deleted',
    thanks: `Thank you for using ${SERVICE_NAME}. Your account is closed.`,
    top: 'Back to the top page',
  },
})

/** The page after leaving: that it is done, and a way back to the top. */
export const goodbyePage = (lang: Lang, url: URL) => {
  const t = text[lang]
  return pageShell({
    lang,
    title: t.title,
    url,
    width: 'narrow',
    head: html`<meta name="robots" content="noindex" />`,
    body: html`<h1>${t.title}</h1>
      <p>${t.thanks}</p>
      <p><a class="button-primary" href="/">${t.top}</a></p>`,
  })
}
