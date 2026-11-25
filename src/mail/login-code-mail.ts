import { CODE_SECONDS } from '../auth/login-policy'
import { messages, type Lang } from '../site/i18n'
import { SENDER_NAME, type Mail } from './mail'

const CODE_MINUTES = CODE_SECONDS / 60

const text = messages({
  ja: {
    subject: (code: string) => `${SENDER_NAME} のログインコード: ${code}`,
    body: (code: string) =>
      `${SENDER_NAME} のログインコードは ${code} です。\n有効期限は ${CODE_MINUTES} 分です。心当たりがない場合は、このメールを無視してください。\n`,
  },
  en: {
    subject: (code: string) => `Your ${SENDER_NAME} sign-in code: ${code}`,
    body: (code: string) =>
      `Your ${SENDER_NAME} sign-in code is ${code}.\nIt expires in ${CODE_MINUTES} minutes. If you did not ask for it, ignore this email.\n`,
  },
})

/**
 * The login-code mail: the code and the service's name, and nothing that
 * tracks the reader (no link, no image).
 */
export function loginCodeMail(to: string, code: string, lang: Lang): Mail {
  const t = text[lang]
  return { to, subject: t.subject(code), text: t.body(code) }
}
