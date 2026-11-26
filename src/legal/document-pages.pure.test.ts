import { expect, test } from 'vitest'
import {
  DRAFT_NOTICE,
  JAPANESE_ONLY_NOTICE,
  legalTextPage,
  pageTitle,
} from './document-pages'
import { sampleText, sampleTransmission } from './test-texts'

const URL_OF = new URL('https://slide.example/terms')
const render = (
  text: Parameters<typeof legalTextPage>[0],
  lang: 'ja' | 'en' = 'ja',
) => String(legalTextPage(text, lang, URL_OF))

const body = (page: string) =>
  /<div class="legal"[\s\S]*<\/main>/u.exec(page)?.[0] ?? ''

/** The markup with the layout whitespace of the templates folded away. */
const squash = (markup: string) =>
  markup.replace(/\s+/gu, ' ').replace(/ ?([<>]) ?/gu, '$1')

test('F34-AC7: Given a draft, When it is drawn, Then the title carries (下書き) and the notice is the one decided, in a bordered note under the title', () => {
  const page = render(sampleText('(施行日)'))
  expect(pageTitle(sampleText('(施行日)'))).toBe('見本(下書き)')
  expect(page).toContain('<title lang="ja">見本(下書き) - ')
  expect(page).toContain('<h1>見本(下書き)</h1>')
  expect(DRAFT_NOTICE).toBe(
    'この文面は下書きです。正式な内容は、施行日を入れて公開します。',
  )
  expect(squash(page)).toContain(
    `</h1><p class="legal-note" role="note">${DRAFT_NOTICE}</p>`,
  )
  expect(page).toMatch(/\.legal-note\s*\{[^}]*border: 1px solid/u)
  expect(page).not.toMatch(/\.legal-note\s*\{[^}]*background/u)
})

test('F34-AC10: Given a text with a date, When it is drawn, Then there is no (下書き) and no notice', () => {
  const page = render(sampleText('2026-12-01'))
  expect(page).toContain('<title lang="ja">見本 - ')
  expect(page).toContain('<h1>見本</h1>')
  expect(page).not.toContain('(下書き)')
  expect(page).not.toContain('下書きです')
  expect(page).not.toContain('legal-note" role')
})

test('F34-AC15: Given an English screen, When a text is drawn, Then the text stays Japanese and the English line comes first', () => {
  const page = render(sampleText('(施行日)'), 'en')
  expect(JAPANESE_ONLY_NOTICE).toBe('This page is available in Japanese only.')
  expect(page).toContain('<html lang="en">')
  expect(page).toContain('<div class="legal" lang="ja">')
  expect(squash(page)).toContain(
    `${DRAFT_NOTICE}</p><p class="legal-note" role="note" lang="en">${JAPANESE_ONLY_NOTICE}</p>`,
  )
  expect(page).toContain('<h1>見本(下書き)</h1>')
})

test('F34-AC15: Given an English screen and a text with a date, When it is drawn, Then only the English line is under the title', () => {
  const page = render(sampleText('2026-12-01'), 'en')
  expect(page).toContain(JAPANESE_ONLY_NOTICE)
  expect(page).not.toContain(DRAFT_NOTICE)
})

test('F34-AC16: Given a Japanese screen, When a text is drawn, Then the English line is not there', () => {
  expect(render(sampleText('(施行日)'), 'ja')).not.toContain(
    JAPANESE_ONLY_NOTICE,
  )
  expect(render(sampleText('2026-12-01'), 'ja')).not.toContain(
    JAPANESE_ONLY_NOTICE,
  )
})

test('F34-AC4: Given articles, When they are drawn, Then each heading is an h2 with an id the URL can reach', () => {
  const page = render(sampleText('(施行日)'))
  expect(page).toContain('<h2 id="article-1">第 1 条(適用)</h2>')
  expect(page).toContain('<h2 id="article-2">第 2 条(送信)</h2>')
  expect(page).toContain('<h2 id="article-3">第 3 条(無号)</h2>')
})

test('F34-AC5: Given clauses and items, When they are drawn, Then they are nested ordered lists the browser numbers', () => {
  const page = squash(body(render(sampleText('(施行日)'))))
  expect(page).toContain(
    '<ol><li>第一項</li><li>第二項。次のとおり。<ol><li>甲</li><li>乙</li></ol></li></ol>',
  )
  // A sentence followed by items: paragraphs, then one list.
  expect(page).toContain(
    '<p>二つ目の段落</p><ol><li>号一</li><li>号二</li></ol>',
  )
  // An article of one sentence has no list at all.
  expect(page).toContain('<h2 id="article-3">第 3 条(無号)</h2><p>ただの文</p>')
  // The numbers are the browser's: none is written, and no CSS makes them.
  expect(page).not.toMatch(/counter|list-style/u)
})

test('F34-AC17: Given a phrase that links to a page, When it is drawn, Then only that phrase is a link, and the other words are not', () => {
  const page = body(render(sampleText('(施行日)')))
  expect(page).toContain(
    '<a href="/privacy/external">「外部への送信」</a>を見る。',
  )
  expect(page.match(/<a /gu)).toHaveLength(1)
})

test('Given text with markup characters, When it is drawn, Then they are escaped', () => {
  const page = body(render(sampleText('(施行日)')))
  expect(page).toContain('前文 &lt;b&gt;と&lt;/b&gt; &amp; 引用')
  expect(page).not.toContain('<b>と</b>')
})

test('F34-AC6: Given a text, When it is drawn, Then the supplement and its history are at the end', () => {
  const page = squash(body(render(sampleText('(施行日)'))))
  expect(page).toContain(
    '<h2 id="supplement">附則</h2><ul><li>(施行日): 制定</li></ul></section></div>',
  )
  const dated = squash(
    body(
      render(
        sampleText('2026-12-01', {
          history: [
            { date: '2026-12-01', summary: '制定' },
            { date: '2027-04-01', summary: '第 2 条を改める' },
          ],
        }),
      ),
    ),
  )
  expect(dated).toContain(
    '<ul><li>2026-12-01: 制定</li><li>2027-04-01: 第 2 条を改める</li></ul>',
  )
})

test('Given a text, When it is drawn, Then the text is in a column at most 40em wide', () => {
  const page = render(sampleText('(施行日)'))
  expect(page).toMatch(/\.legal-note\s*\{[^}]*max-width: 40em/u)
  expect(page).toMatch(/max-width: 40em/u)
})

test('F34-AC3: Given the table of destinations, When it is drawn, Then each row has its four cells, the policy link and the heading labels the narrow screen uses', () => {
  const page = squash(body(render(sampleTransmission('(施行日)'))))
  expect(page).toContain('<p>説明の文。</p>')
  expect(page).toContain(
    '<th scope="col">送り先</th><th scope="col">送る情報</th><th scope="col">目的</th><th scope="col">ポリシー</th>',
  )
  expect(page).toContain(
    '<td><span class="cell-label">送り先</span>A 社 &lt;script&gt;</td>',
  )
  expect(page).toContain(
    '<td><span class="cell-label">ポリシー</span><a href="https://a.example/policy?x=1&amp;y=2" rel="noopener noreferrer">ポリシー A</a></td>',
  )
  expect(page.match(/<tr>/gu)).toHaveLength(3)
  // Every cell of a row repeats its heading, so a stacked row reads alone.
  expect(page.match(/class="cell-label"/gu)).toHaveLength(8)
})

test.each([
  ['ja', 'プライバシーポリシーへ戻る'],
  ['en', 'Back to the Privacy Policy'],
] as const)(
  'F34-AC18: Given the table page in %s, When it is drawn, Then a link goes back to the privacy policy, after the table and before the supplement',
  (lang, label) => {
    const page = squash(body(render(sampleTransmission('(施行日)'), lang)))
    expect(page).toContain(`<a class="back-link" href="/privacy">${label}</a>`)
    expect(page.indexOf('</table>')).toBeLessThan(page.indexOf('back-link'))
    expect(page.indexOf('back-link')).toBeLessThan(
      page.indexOf('id="supplement"'),
    )
  },
)

test('F34-AC7, F34-AC10: Given the table page, When its date is a blank or a date, Then it is a draft or it is not', () => {
  expect(render(sampleTransmission('(施行日)'))).toContain(DRAFT_NOTICE)
  expect(render(sampleTransmission('2026-12-01'))).not.toContain(DRAFT_NOTICE)
})
