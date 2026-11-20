import { html } from 'hono/html'
import { messages, type Lang } from '../site/i18n'

const text = messages({
  ja: {
    title: 'プレビュー',
    heading: 'この版のプレビュー',
    onlyYou:
      'この版は、あなただけが見られます。開いて、表示を確かめてください。',
    open: 'プレビューを開く',
    manage: (link: unknown) =>
      html`公開するには、${link}を開いて「公開する」を押してください。`,
    manageLink: 'このスライドの管理ページ',
  },
  en: {
    title: 'Preview',
    heading: 'Preview of this version',
    onlyYou: 'Only you can see this version. Open it and check how it looks.',
    open: 'Open the preview',
    manage: (link: unknown) =>
      html`To publish it, open ${link} and press “Publish”.`,
    manageLink: 'this slide’s manage page',
  },
})

export const previewTitle = (lang: Lang) => text[lang].title

/**
 * The page a link to the author-only preview opens: one button, which
 * sends the form the manage page sends. Opening the page starts nothing.
 */
export const previewBody = (slug: string, uploadId: string, lang: Lang) => {
  const t = text[lang]
  return html`<h1>${t.heading}</h1>
    <p>${t.onlyYou}</p>
    <form
      method="post"
      action="/slides/${slug}/deployments/${uploadId}/preview"
    >
      <button class="button-primary">${t.open}</button>
    </form>
    <p>${t.manage(html`<a href="/slides/${slug}">${t.manageLink}</a>`)}</p>`
}
