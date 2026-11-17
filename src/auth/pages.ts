import { html } from 'hono/html'
import { siteFooter } from '../site/footer'
import { messages, type Lang } from '../site/i18n'
import { SERVICE_NAME } from '../site/service'

const text = messages({
  ja: {
    title: '招待制です',
    message:
      'いまは、運営が招待した人だけが、作者としてログインできます。この GitHub アカウントは、登録されていません。',
    readers: '公開されているスライドは、ログインしなくても読めます。',
    top: 'トップページへ',
    contact: 'お問い合わせ',
  },
  en: {
    title: 'Invitation only',
    message:
      'For now, only people the operator has invited can sign in as authors. This GitHub account is not registered.',
    readers: 'Published slides can be read without signing in.',
    top: 'Go to the top page',
    contact: 'Contact',
  },
})

/** Where a sign-in by someone who is not a registered author ends. */
export const INVITATION_ONLY_PATH = '/auth/invitation-only'

/** `url` is this page; the language switcher reopens it. */
export const invitationOnlyPage = (lang: Lang, url: URL) => {
  const t = text[lang]
  return html`<!doctype html>
    <html lang="${lang}">
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <meta name="robots" content="noindex" />
      <title>${t.title} - ${SERVICE_NAME}</title>
      <style>
        body {
          font: 16px system-ui;
          max-width: 640px;
          margin: 12vh auto;
          padding: 0 16px;
          color: #152439;
          background: #f4f6fa;
        }
      </style>
      <h1>${t.title}</h1>
      <p>${t.message}</p>
      <p>${t.readers}</p>
      <p><a href="/">${t.top}</a> · <a href="/contact">${t.contact}</a></p>
      ${siteFooter(lang, url)}
    </html>`
}
