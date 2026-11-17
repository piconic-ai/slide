import { html } from 'hono/html'
import { messages, type Lang } from '../site/i18n'
import { reportReasonSchema, type ParseReportResult } from './report'

type ReportFailure = Exclude<ParseReportResult, { kind: 'valid' }>['kind']

const text = messages({
  ja: {
    title: '通報する',
    reasons: {
      nuisance:
        '迷惑行為(偽のログイン画面、勝手に別のサイトへ飛ばす、宣伝だけの内容、不快な内容など)',
      rights: '権利侵害(他人の作品や資料を無断で使っている)',
      other: 'その他',
    },
    note: '説明(任意。「その他」のときは必須。500 文字まで)',
    received: '通報を受け付けました。',
    signInNeeded: '通報するには、ログインが必要です。',
    signIn: 'GitHub でログイン',
    back: 'スライドに戻る',
    errors: {
      invalid_reason: '通報の理由を選んでください。',
      invalid_note: '説明はテキストで入力してください。',
      note_too_long: '説明は500文字以内で入力してください。',
      note_required: '「その他」を選んだときは説明を入力してください。',
    },
  },
  en: {
    title: 'Report',
    reasons: {
      nuisance:
        'Abuse (a fake sign-in screen, sending you to another site, pure advertising, offensive content, and the like)',
      rights:
        "Rights infringement (someone else's work used without permission)",
      other: 'Other',
    },
    note: 'Details (optional; required for Other; up to 500 characters)',
    received: 'Your report was received.',
    signInNeeded: 'Sign in to report.',
    signIn: 'Sign in with GitHub',
    back: 'Back to the slides',
    errors: {
      invalid_reason: 'Choose a reason for your report.',
      invalid_note: 'Enter the details as text.',
      note_too_long: 'Keep the details within 500 characters.',
      note_required: 'Enter details when you choose Other.',
    },
  },
})

export const reportTitle = (lang: Lang) => text[lang].title

export const reportSignInBody = (slide: string, lang: Lang) => {
  const t = text[lang]
  return html`<h1>${t.title}</h1>
    <p>${t.signInNeeded}</p>
    <p>
      <a href="/auth/github?to=${encodeURIComponent(slide)}">${t.signIn}</a>
    </p>`
}

export const reportReceivedBody = (slide: string, lang: Lang) => {
  const t = text[lang]
  return html`<h1>${t.title}</h1>
    <p role="status">${t.received}</p>
    <p><a href="${slide}">${t.back}</a></p>`
}

export function reportFormBody(
  view: Readonly<{
    slide: string
    reason: string
    note: string
    error: ReportFailure | null
  }>,
  lang: Lang,
) {
  const t = text[lang]
  return html`<h1>${t.title}</h1>
    ${view.error ? html`<p role="alert">${t.errors[view.error]}</p>` : ''}
    <form method="post" action="/reports">
      <input type="hidden" name="slide" value="${view.slide}" />
      ${reportReasonSchema.options.map(
        (reason) =>
          html`<p>
            <label>
              <input
                type="radio"
                name="reason"
                value="${reason}"
                required
                ${view.reason === reason ? html`checked` : ''}
              />
              ${t.reasons[reason]}
            </label>
          </p>`,
      )}
      <p>
        <label>
          ${t.note}<br />
          <textarea name="note" maxlength="500" rows="5">${view.note}</textarea>
        </label>
      </p>
      <button type="submit">${t.title}</button>
    </form>`
}
