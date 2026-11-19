import { html } from 'hono/html'
import { siteFooter } from '../site/footer'
import { messages, type Lang } from '../site/i18n'
import { SERVICE_NAME } from '../site/service'
import { designTokensCssRaw } from '../site/design-tokens'

/** Why a sign-in that GitHub accepted still gave no session. */
export const signInRefusals = ['uninvited', 'handle_taken'] as const
export type SignInRefusal = (typeof signInRefusals)[number]

type RefusalText = Readonly<{ title: string; message: string; next: string }>

const text = messages<{
  pages: Readonly<Record<SignInRefusal, RefusalText>>
  top: string
  contact: string
}>({
  ja: {
    pages: {
      uninvited: {
        title: '招待制です',
        message:
          'いまは、運営が招待した人だけが、作者としてログインできます。この GitHub アカウントは、登録されていません。',
        next: '公開されているスライドは、ログインしなくても読めます。',
      },
      handle_taken: {
        title: 'ログインできませんでした',
        message:
          'あなたの GitHub のユーザー名と同じ名前を、ほかの人が共有 URL(/@名前)に使っています。このままでは、あなたのスライドに共有 URL を作れないため、ログインを止めました。',
        next: 'お手数ですが、お問い合わせから、GitHub のユーザー名を添えてご連絡ください。運営が確かめて、使えるようにします。',
      },
    },
    top: 'トップページへ',
    contact: 'お問い合わせ',
  },
  en: {
    pages: {
      uninvited: {
        title: 'Invitation only',
        message:
          'For now, only people the operator has invited can sign in as authors. This GitHub account is not registered.',
        next: 'Published slides can be read without signing in.',
      },
      handle_taken: {
        title: 'We could not sign you in',
        message:
          'Someone else already uses your GitHub username as the name in their share URLs (/@name). Your slides could not get a share URL like this, so the sign-in was stopped.',
        next: 'Please contact us with your GitHub username. The operator will check and make it work.',
      },
    },
    top: 'Go to the top page',
    contact: 'Contact',
  },
})

const paths: Readonly<Record<SignInRefusal, string>> = {
  uninvited: '/auth/invitation-only',
  handle_taken: '/auth/handle-taken',
}

/** Where a refused sign-in ends. */
export const refusalPath = (reason: SignInRefusal) => paths[reason]

/** `url` is this page; the language switcher reopens it. */
export const refusalPage = (reason: SignInRefusal, lang: Lang, url: URL) => {
  const t = text[lang]
  const { title, message, next } = t.pages[reason]
  return html`<!doctype html>
    <html lang="${lang}">
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <meta name="robots" content="noindex" />
      <title>${title} - ${SERVICE_NAME}</title>
      <style>
        ${designTokensCssRaw} body {
          font: 16px/1.8 var(--font-sans);
          max-width: 640px;
          margin: 12vh auto;
          padding: 0 16px;
          color: var(--foreground);
          background: var(--background);
        }
        h1 {
          font-size: 32px;
          font-weight: 700;
          line-height: 1.35;
        }
        p {
          max-width: 40em;
        }
        a {
          color: var(--foreground);
        }
      </style>
      <h1>${title}</h1>
      <p>${message}</p>
      <p>${next}</p>
      <p><a href="/">${t.top}</a> · <a href="/contact">${t.contact}</a></p>
      ${siteFooter(lang, url)}
    </html>`
}
