// What a person reads when an export is refused. The refusals of a link they
// pressed show a page (a download that failed would only say "failed").
import { html } from 'hono/html'
import { messages, type Lang } from '../site/i18n'
import { frameHelpLink } from '../help/frame-links'

export type ExportRefusal = 'busy' | 'too_large' | 'unavailable'

const text = messages({
  ja: {
    busy: {
      title: '書き出しが終わるのを待っています',
      note: 'このアカウントで、別の zip を書き出している最中です。終わってから、もう一度お試しください。',
    },
    too_large: {
      title: 'この版は、書き出せる大きさを超えています',
      note: 'ファイルの数か大きさが、一度に書き出せる上限を超えています。お問い合わせください。',
    },
    unavailable: {
      title: '書き出せませんでした',
      note: '保存したファイルの一部を読めませんでした。時間をおいて、もう一度お試しください。続くときは、お問い合わせください。',
    },
    back: '戻る',
  },
  en: {
    busy: {
      title: 'Waiting for another export to finish',
      note: 'A zip is being made for this account already. Try again when it has finished.',
    },
    too_large: {
      title: 'This version is too large to export',
      note: 'It has more files, or more bytes, than one export can hold. Please contact us.',
    },
    unavailable: {
      title: 'Could not export',
      note: 'Some of the stored files could not be read. Try again in a while; if it keeps happening, please contact us.',
    },
    back: 'Back',
  },
})

export const exportRefusalTitle = (lang: Lang, refusal: ExportRefusal) =>
  text[lang][refusal].title

/** The page of a refusal; `back` is where the link at its foot leads. */
export const exportRefusalBody = (
  lang: Lang,
  refusal: ExportRefusal,
  back: string,
) =>
  html`<h1>${text[lang][refusal].title}</h1>
    <p>${text[lang][refusal].note}</p>
    ${frameHelpLink('export-refused', lang)}
    <p><a href="${back}">${text[lang].back}</a></p>`
