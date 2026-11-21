import { html, raw } from 'hono/html'
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
    reasonLegend: '通報の理由',
    slideTitle: '通報するスライド',
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
    reasonLegend: 'Reason for the report',
    slideTitle: 'The slides being reported',
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

/** The opening tag stays one string so a formatter cannot insert a newline into the value. */
const noteInput = (value: string) => {
  const open = [
    '<textarea class="text-input" name="note"',
    ' maxlength="500" rows="5">',
  ].join('')
  return html`${raw(open)}${value}</textarea>`
}

export const reportSignInBody = (slide: string, lang: Lang) => {
  const t = text[lang]
  return html`<div class="narrow">
    <h1>${t.title}</h1>
    <p>${t.signInNeeded}</p>
    <p>
      <a
        class="button-primary"
        href="/auth/github?to=${encodeURIComponent(slide)}"
        >${t.signIn}</a
      >
    </p>
  </div>`
}

export const reportReceivedBody = (slide: string, lang: Lang) => {
  const t = text[lang]
  return html`<div class="narrow">
    <h1>${t.title}</h1>
    <p class="notice-success" role="status">${t.received}</p>
    <p><a class="button-secondary" href="${slide}">${t.back}</a></p>
  </div>`
}

export function reportFormBody(
  view: Readonly<{
    slide: string
    /** The embed page of the slides, which the report frames. */
    embed: string
    reason: string
    note: string
    error: ReportFailure | null
  }>,
  lang: Lang,
) {
  const t = text[lang]
  return html`<div class="narrow">
    <h1>${t.title}</h1>
    ${
      view.error
        ? html`<p class="notice-danger" role="alert">
            ${t.errors[view.error]}
          </p>`
        : ''
    }
    <div class="report-slide">
      <iframe
        src="${view.embed}"
        title="${t.slideTitle}: ${view.slide}"
        loading="lazy"
      ></iframe>
    </div>
    <form method="post" action="/reports">
      <input type="hidden" name="slide" value="${view.slide}" />
      <fieldset class="choices">
        <legend>${t.reasonLegend}</legend>
        ${reportReasonSchema.options.map(
          (reason) =>
            html`<label class="choice">
              <input
                type="radio"
                name="reason"
                value="${reason}"
                required
                ${view.reason === reason ? html`checked` : ''}
              />
              <span>${t.reasons[reason]}</span>
            </label>`,
        )}
      </fieldset>
      <p>
        <label class="field-label">
          ${t.note}<br />
          ${noteInput(view.note)}
        </label>
      </p>
      <button class="button-primary" type="submit">${t.title}</button>
    </form>
  </div>`
}
