import { describe, expect, test } from 'vitest'
import { linkCheckPrompt } from './link-check'

describe.each([
  {
    lang: 'ja',
    title: 'このリンクを開きますか',
    open: '開く',
    cancel: 'キャンセル',
  },
  { lang: 'en', title: 'Open this link?', open: 'Open', cancel: 'Cancel' },
] as const)('the link check in $lang', ({ lang, title, open, cancel }) => {
  const markup = String(linkCheckPrompt(lang))
  const paragraphs = [...markup.matchAll(/<p\b[^>]*>/g)].map(([tag]) => tag)

  test('F27-AC53: Given the check, When it is written, Then it holds the title, the place for the whole address, Open and Cancel', () => {
    expect(markup).toContain(`<h2 id="link-check-title">${title}</h2>`)
    expect(markup).toContain('id="link-check-url" data-link-check-url')
    expect(markup).toContain(`data-link-check-open>${open}</a>`)
    expect(markup).toContain(`${cancel}\n`)
  })

  test('F27-AC53: Given the check, When it is written, Then no sentence stands beside the address and the dialog is described by the address alone', () => {
    expect(paragraphs).toEqual([
      '<p class="link-check-url" id="link-check-url" data-link-check-url>',
    ])
    expect(markup).toContain('aria-describedby="link-check-url"')
    expect(markup).not.toContain('link-check-body')
  })
})
