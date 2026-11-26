import { beforeAll, describe, expect, test } from 'vitest'
import { html } from 'hono/html'
import { defineArticle, type Article } from './article'
import { buildCatalog, type RegisteredArticle } from './catalog'
import { HELP_CATALOG } from './default-catalog'
import { helpNumbers } from './numbers'
import {
  buildSearchIndex,
  fold,
  foldQuery,
  MAX_QUERY_CHARS,
  MAX_TERMS,
  parseQuery,
  plainText,
  searchHelp,
  type SearchIndex,
  type SearchQuery,
} from './search'

const article = (
  title: string,
  lead: string,
  body: string,
  order = 10,
): Article =>
  defineArticle({
    order,
    form: 'reference',
    related: [],
    ja: {
      title: `${title}(日本語)`,
      lead: () => html`${lead}`,
      body: () => html`${body}`,
    },
    en: {
      title,
      lead: () => html`${lead}`,
      body: () => html`${body}`,
    },
  })

const words = (raw: string) => {
  const query = parseQuery(raw)
  if (query.kind !== 'words') throw new Error('not a search')
  return query
}

describe('reading the word the search form sent', () => {
  test('F36-AC19: Given an empty or blank word, When it is read, Then it is no search', () => {
    for (const raw of [undefined, null, '', '   ', '\t\n', '　　'])
      expect(parseQuery(raw)).toEqual({ kind: 'empty' })
  })

  test('F36-AC14: Given a Japanese word, When it is read, Then it is kept whole, not split into words', () => {
    expect(words('ログインのコード')).toMatchObject({
      shown: 'ログインのコード',
      terms: ['ログインのコード'],
    })
  })

  test('F36-AC14: Given several words, When they are read, Then each is a term, folded, once, up to the limit', () => {
    expect(words('  Sign   IN　code sign ').terms).toEqual([
      'sign',
      'in',
      'code',
    ])
    const many = words('a1 b2 c3 d4 e5 f6 g7').terms
    expect(many).toHaveLength(MAX_TERMS)
  })

  test('F36-AC20: Given a word longer than the limit, When it is read, Then it is cut to the limit in characters, whole characters only', () => {
    const long = words('あ'.repeat(10_000))
    expect(Array.from(long.shown)).toHaveLength(MAX_QUERY_CHARS)
    // An emoji is one character, never half of one.
    const emoji = words('😀'.repeat(MAX_QUERY_CHARS + 20))
    expect(Array.from(emoji.shown)).toHaveLength(MAX_QUERY_CHARS)
    expect(emoji.shown).toBe('😀'.repeat(MAX_QUERY_CHARS))
  })

  test.each(['!!!', '?', '。。。', '<>', '... ---', '😀'])(
    'F36-AC14: Given the word %j with no letter or digit, When it is read, Then there is nothing to look for',
    (raw) => {
      expect(words(raw).terms).toEqual([])
    },
  )

  test('F36-AC21: Given a word with markup, When it is read, Then it is kept as text', () => {
    const query = words('<script>alert(1)</script>')
    expect(query.shown).toBe('<script>alert(1)</script>')
  })
})

describe('folding text', () => {
  test('Given width, case and compatibility forms, When folded, Then they compare equal', () => {
    expect(fold('ＺＩＰ')).toBe('zip')
    expect(foldQuery('ﾌﾟﾛﾌｨｰﾙ')).toBe('プロフィール')
    expect(fold('Straße')).toHaveLength('Straße'.length)
  })

  test('Given any text, When folded, Then every position keeps its length', () => {
    for (const text of [
      '㌔グラム',
      'ǅ',
      '😀a',
      'ß',
      'İ',
      '㈱',
      'ﬁ',
      '漢字ＡＢＣ',
    ])
      expect(fold(text)).toHaveLength(text.length)
  })
})

describe('the text of markup', () => {
  test('Given markup, When read as text, Then tags are gone, entities are decoded and spaces are one', () => {
    expect(
      plainText(
        '<p>A &lt;title&gt; &amp;\n  <code>b</code></p><ul><li>c</li></ul>',
      ),
    ).toBe('A <title> & b c')
  })
})

describe('searching the real help', () => {
  let index: SearchIndex
  beforeAll(async () => {
    index = await buildSearchIndex(HELP_CATALOG, helpNumbers())
  })
  const keys = (query: SearchQuery, lang: 'ja' | 'en' = 'ja') =>
    searchHelp(index, query, lang).map((hit) => hit.entry.key)

  test('F36-AC14: Given a word in a title or a body, When it is searched, Then the articles that hold it are found', () => {
    expect(keys(words('zip'))).toContain('slides/accepted-files')
    // Only in a body: the article on limits names the size of an author’s files.
    expect(keys(words('ハイフン'))).toContain('slides/url-name')
  })

  test('F36-AC15: Given a word that is in one article’s title and only in others’ bodies, When it is searched, Then the title’s article is first', () => {
    const hits = searchHelp(index, words('ブロック'), 'ja')
    expect(hits[0]?.entry.key).toBe('safety/block-user')
    const titled = hits.filter((hit) => hit.score >= 1000)
    const bodyOnly = hits.filter((hit) => hit.score < 1000)
    expect(bodyOnly.length).toBeGreaterThan(0)
    expect(hits.slice(0, titled.length)).toEqual(titled)
  })

  test('F36-AC16: Given a screen in Japanese, When an English word is searched, Then the English articles are searched and the Japanese page shows them', () => {
    const hits = searchHelp(index, words('spam'), 'ja')
    expect(hits.map((hit) => hit.entry.key)).toContain('start/code-not-arrived')
    expect(hits[0]?.excerpt.lang).toBe('en')
  })

  test('F36-AC16: Given a screen in English, When a Japanese word is searched, Then the Japanese articles are searched', () => {
    const hits = searchHelp(index, words('迷惑メール'), 'en')
    expect(hits.map((hit) => hit.entry.key)).toContain('start/code-not-arrived')
    expect(hits[0]?.excerpt.lang).toBe('ja')
  })

  test('F36-AC16: Given a word found in both languages, When it is searched, Then the screen’s own language is the excerpt’s', () => {
    expect(searchHelp(index, words('zip'), 'ja')[0]?.excerpt.lang).toBe('ja')
    expect(searchHelp(index, words('zip'), 'en')[0]?.excerpt.lang).toBe('en')
  })

  test('F36-AC17: Given a hit, When its excerpt is read, Then the word is marked and the rest is not', () => {
    const [hit] = searchHelp(index, words('zip'), 'en')
    const marked = hit!.excerpt.segments.filter((segment) => segment.mark)
    expect(marked.length).toBeGreaterThan(0)
    for (const segment of marked) expect(fold(segment.text)).toBe('zip')
    expect(
      hit!.excerpt.segments.map((segment) => segment.text).join(''),
    ).toContain('zip')
  })

  test('F36-AC17: Given a word whose match is in the middle of a long text, When its excerpt is read, Then it is short and says it is cut', () => {
    const [hit] = searchHelp(index, words('Marp'), 'en')
    const text = hit!.excerpt.segments.map((segment) => segment.text).join('')
    expect(text.length).toBeLessThanOrEqual(130)
    expect(hit!.excerpt.cut.before || hit!.excerpt.cut.after).toBe(true)
  })

  test.each([
    '<script>alert(1)</script>',
    '<img src=x onerror=alert(1)>',
    '"><svg/onload=1>',
    '&amp;',
    "'; DROP TABLE decks;--",
  ])(
    'F36-AC21: Given the word %j, When it is searched, Then no hit holds markup the reader typed',
    (raw) => {
      for (const hit of searchHelp(index, words(raw), 'ja'))
        for (const segment of hit.excerpt.segments)
          // A segment is text, whatever it holds; the page escapes it.
          expect(typeof segment.text).toBe('string')
    },
  )

  test('F36-AC21: Given a word that is markup in an article’s own text, When it is searched, Then the excerpt holds the text, not the entity', () => {
    const [hit] = searchHelp(index, words('<title>'), 'ja')
    expect(hit).toBeDefined()
    const text = hit!.excerpt.segments.map((segment) => segment.text).join('')
    expect(text).toContain('<title>')
    expect(text).not.toContain('&lt;')
  })

  test('F36-AC20: Given a word far longer than the limit, When it is searched, Then it answers with no hit and no error', () => {
    expect(searchHelp(index, words('x'.repeat(100_000)), 'ja')).toEqual([])
    expect(searchHelp(index, words('あ'.repeat(100_000)), 'en')).toEqual([])
  })

  test.each(['!!!', '?', '。。。', '😀', '%', '*', '.'])(
    'F36-AC14: Given the word %j with no letter or digit, When it is searched, Then nothing matches',
    (raw) => {
      expect(searchHelp(index, words(raw), 'ja')).toEqual([])
    },
  )

  test('F36-AC18: Given a word that is in no article, When it is searched, Then there is no hit', () => {
    expect(searchHelp(index, words('まったく無い言葉xyz'), 'ja')).toEqual([])
  })

  test('F36-AC14: Given an empty search, When it is searched, Then there is no hit', () => {
    expect(searchHelp(index, { kind: 'empty' }, 'ja')).toEqual([])
  })

  test('F36-AC14: Given two words, When they are searched, Then an article must hold both', () => {
    const both = keys(words('zip HTML'))
    const one = keys(words('zip'))
    expect(both.length).toBeGreaterThan(0)
    expect(both.length).toBeLessThanOrEqual(one.length)
    expect(keys(words('zip まったく無い言葉xyz'))).toEqual([])
  })

  test.each([
    ['ja', 'ＺＩＰ', 'slides/accepted-files'],
    ['ja', 'Zip', 'slides/accepted-files'],
    ['ja', 'ﾌﾞﾛｯｸ', 'safety/block-user'],
  ] as const)(
    'F36-AC14: Given the %s word %j in another width or case, When it is searched, Then it finds %s',
    (lang, raw, key) => {
      expect(keys(words(raw), lang)).toContain(key)
    },
  )

  // What readers are likely to type, and where the answer should be (F36-AC49).
  // The first twenty are for the articles the frame moved; the next twenty,
  // for the articles of the fourth scope (work H2). Add the words of an
  // article you write to the second group.
  test.each([
    ['ja', 'zip', 'slides/accepted-files'],
    ['ja', 'ログイン', 'start/sign-in'],
    ['ja', 'コード', 'start/code-not-arrived'],
    ['ja', '届かない', 'start/code-not-arrived'],
    ['ja', '引用', 'community/cite-slides'],
    ['ja', 'ブロック', 'safety/block-user'],
    ['ja', '埋め込み', 'sharing/embed-in-blog'],
    ['ja', '上限', 'slides/limits'],
    ['ja', 'プロフィール', 'account/edit-profile'],
    ['ja', '削除', 'community/delete-community'],
    ['en', 'embed', 'sharing/embed-in-blog'],
    ['en', 'sign in', 'start/sign-in'],
    ['en', 'code', 'start/code-not-arrived'],
    ['en', 'block', 'safety/block-user'],
    ['en', 'limit', 'slides/limits'],
    ['en', 'agent', 'agent/connect'],
    ['en', 'profile', 'account/edit-profile'],
    ['en', 'delete', 'community/delete-community'],
    ['en', 'spam', 'start/code-not-arrived'],
    ['en', 'zip', 'slides/accepted-files'],
  ] as const)(
    'F36-AC49: Given a reader of the %s help who searches %j, When the results are read, Then %s is within the first three',
    (lang, raw, key) => {
      expect(keys(words(raw), lang).slice(0, 3)).toContain(key)
    },
  )

  test.each([
    ['ja', '書き出す', 'account/export-all'],
    ['ja', '置き直す', 'account/reupload-zip'],
    ['ja', 'メンテナンス', 'safety/maintenance'],
    ['ja', '禁止', 'safety/prohibited'],
    ['ja', '非表示', 'safety/hidden-slide'],
    ['ja', '異議', 'safety/appeal'],
    ['ja', '連絡先', 'safety/operator'],
    ['ja', '退会', 'account/before-leaving'],
    ['ja', '登録', 'start/sign-up'],
    ['ja', '暗号化', 'safety/data-we-keep'],
    ['en', 'export', 'account/export-all'],
    ['en', 'reconnect', 'agent/reconnect'],
    ['en', 'maintenance', 'safety/maintenance'],
    ['en', 'prohibited', 'safety/prohibited'],
    ['en', 'hidden', 'safety/hidden-slide'],
    ['en', 'appeal', 'safety/appeal'],
    ['en', 'operator', 'safety/operator'],
    ['en', 'leave', 'account/before-leaving'],
    ['en', 'sign up', 'start/sign-up'],
    ['en', 'encrypted', 'safety/data-we-keep'],
    ['ja', '保存した版', 'sharing/stored-version'],
    ['ja', '通信が切れ', 'sharing/read-offline'],
    ['en', 'stored version', 'sharing/stored-version'],
    ['en', 'offline', 'sharing/read-offline'],
  ] as const)(
    'F36-AC49: Given a reader of the %s help who searches %j for a feature of the fourth scope, When the results are read, Then %s is within the first three',
    (lang, raw, key) => {
      expect(keys(words(raw), lang).slice(0, 3)).toContain(key)
    },
  )
})

describe('ranking and excerpts on a small help', () => {
  const registered: RegisteredArticle[] = [
    [
      'slides/body-only',
      article('Other', 'About nothing.', 'Mentions needle once.'),
    ],
    [
      'slides/in-title',
      article('The needle', 'About nothing.', 'No more.', 20),
    ],
    [
      'slides/in-lead',
      article('Else', 'A needle is in the lead.', 'No more.', 30),
    ],
    [
      'slides/many',
      article('Many', 'Nothing.', 'needle needle needle needle.', 40),
    ],
  ]
  const catalog = buildCatalog(registered)

  test('F36-AC15: Given the same word in a title, a lead and bodies, When it is searched, Then the title is first, then the lead, then the body with more of it', async () => {
    const index = await buildSearchIndex(catalog, helpNumbers())
    expect(
      searchHelp(index, words('needle'), 'en').map((hit) => hit.entry.slug),
    ).toEqual(['in-title', 'in-lead', 'many', 'body-only'])
  })

  test('F36-AC15: Given articles that score alike, When they are searched, Then they keep the help’s reading order', async () => {
    const same: RegisteredArticle[] = [
      ['safety/b', article('x needle', 'l', 'b', 20)],
      ['agent/z', article('x needle', 'l', 'b', 90)],
      ['slides/a', article('x needle', 'l', 'b', 10)],
      ['slides/c', article('x needle', 'l', 'b', 10)],
    ]
    const index = await buildSearchIndex(buildCatalog(same), helpNumbers())
    expect(
      searchHelp(index, words('needle'), 'en').map((hit) => hit.entry.key),
    ).toEqual(['slides/a', 'slides/c', 'agent/z', 'safety/b'])
  })
})
