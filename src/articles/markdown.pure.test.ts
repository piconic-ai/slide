import { describe, expect, test } from 'vitest'
import {
  parseArticle,
  embeddedPages,
  linkedShareUrls,
  onlyAllowed,
  renderArticle,
  type Embed,
} from './markdown'

const ORIGIN = 'https://slide.example'
const view = (
  embeds: Map<string, Embed> = new Map(),
  lang: 'ja' | 'en' = 'ja',
) => ({
  origin: ORIGIN,
  embeds,
  lang,
})
/** The element tags of a piece of HTML; escaped text has none. */
const tagsOf = (html: string) => html.match(/<[^>]*>/g) ?? []
const render = (source: string) => renderArticle(source, view())

describe('F26-AC10: what an article shows', () => {
  test.each([
    ['a paragraph', 'Hello', '<p>Hello</p>'],
    ['a heading, one level down from the viewer’s h2', '# A', '<h3>A</h3>'],
    ['a second-level heading as an h4', '## A', '<h4>A</h4>'],
    ['a deep heading capped at h6', '###### A', '<h6>A</h6>'],
    ['a bullet list', '- a\n- b', '<ul>\n<li>a</li>\n<li>b</li>\n</ul>'],
    ['a numbered list', '1. a\n2. b', '<ol>'],
    ['a numbered list that starts later', '3. a\n4. b', '<ol start="3">'],
    ['a quote', '> q', '<blockquote>\n<p>q</p>\n</blockquote>'],
    ['inline code', 'use `x`', '<code>x</code>'],
    [
      'a code block, with no class from its info line',
      '```sh onmouseover=x\nls\n```',
      '<pre><code>ls\n</code></pre>',
    ],
    ['strikethrough', '~~gone~~', '<s>gone</s>'],
    ['emphasis', '*a* **b**', '<em>a</em> <strong>b</strong>'],
    [
      'a table, without alignment styles',
      '| a | b |\n|:-|-:|\n| 1 | 2 |',
      '<th>a</th>',
    ],
    [
      'a link',
      '[x](https://example.com/a)',
      '<a href="https://example.com/a" rel="noopener nofollow ugc" data-link-check aria-haspopup="dialog">x</a>',
    ],
    [
      'an autolink',
      'see https://example.com/a now',
      '<a href="https://example.com/a" rel="noopener nofollow ugc" data-link-check aria-haspopup="dialog">https://example.com/a</a>',
    ],
    [
      'an angle-bracket autolink',
      '<https://example.com/a>',
      'href="https://example.com/a"',
    ],
    [
      'a mailto link',
      '[m](mailto:a@example.com)',
      'href="mailto:a@example.com"',
    ],
    ['an http link', '[x](http://example.com)', 'href="http://example.com/"'],
  ])(
    'Given %s, When rendered, Then the matching element appears',
    (_name, source, expected) => {
      expect(render(source)).toContain(expected)
    },
  )

  test('Given a table, When rendered, Then it has no style attribute for its alignment', () => {
    const html = render('| a | b |\n|:-|-:|\n| 1 | 2 |')
    expect(html).toContain('<table>')
    expect(html).not.toMatch(/style=|align=/)
  })

  test('Given an empty text, When rendered, Then nothing is shown', () => {
    expect(render('')).toBe('')
    expect(render('  \n\n ')).toBe('')
  })
})

describe('F26-AC11: raw HTML is shown as text', () => {
  test.each([
    '<b>bold</b>',
    '<div>block</div>',
    '<p>para</p>',
    '<!-- comment -->',
    '<span style="color:red">x</span>',
  ])('Given %s, When rendered, Then the tags are escaped text', (source) => {
    const html = render(source)
    expect(html).not.toContain('<b>')
    expect(html).not.toContain('<div>')
    expect(html).not.toContain('<span style')
    expect(html).toContain('&lt;')
    expect(onlyAllowed(html)).toBe(true)
  })
})

/** Hostile texts of the kinds the XSS cheat sheets list. */
const HOSTILE = [
  '<script>alert(1)</script>',
  '<SCRIPT SRC=//evil.example/x.js></SCRIPT>',
  '<img src=x onerror=alert(1)>',
  '<img src="x" onerror="alert(1)">',
  '<svg onload=alert(1)>',
  '<svg><script>alert(1)</script></svg>',
  '<iframe src="https://evil.example"></iframe>',
  '<iframe srcdoc="<script>alert(1)</script>"></iframe>',
  '<form action="https://evil.example"><input name=x><button>go</button></form>',
  '<a href="javascript:alert(1)">x</a>',
  '<a href="JaVaScRiPt:alert(1)" onclick="alert(1)">x</a>',
  '<body onload=alert(1)>',
  '<div style="background:url(javascript:alert(1))">x</div>',
  '<style>body{display:none}</style>',
  '<link rel=stylesheet href=//evil.example/x.css>',
  '<meta http-equiv="refresh" content="0;url=https://evil.example">',
  '<object data="javascript:alert(1)"></object>',
  '<embed src="javascript:alert(1)">',
  '<base href="https://evil.example/">',
  '<math><mi xlink:href="javascript:alert(1)">x</mi></math>',
  '<details open ontoggle=alert(1)>',
  '<input autofocus onfocus=alert(1)>',
  '<video><source onerror=alert(1)></video>',
  '<button formaction=javascript:alert(1)>x</button>',
  '[x](javascript:alert(1))',
  '[x](JAVASCRIPT:alert(1))',
  '[x](&#106;avascript:alert(1))',
  '[x](&#x6A;avascript:alert(1))',
  '[x](java\tscript:alert(1))',
  '[x](java&#9;script:alert(1))',
  '[x]( javascript:alert(1))',
  '[x](<javascript:alert(1)>)',
  '[x](vbscript:msgbox(1))',
  '[x](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)',
  '[x](file:///etc/passwd)',
  '[x](//evil.example/x)',
  '[x](/relative)',
  '[x](#fragment)',
  '[x][ref]\n\n[ref]: javascript:alert(1)',
  '<javascript:alert(1)>',
  '![x](javascript:alert(1))',
  '![x](https://evil.example/x.png "title")',
  '![x](x" onerror="alert(1))',
  '[x](https://example.com/" onmouseover="alert(1))',
  '[x](https://example.com/ "t\\" onmouseover=\\"alert(1)")',
  "[x](https://example.com/' onmouseover='alert(1))",
  '`</code><script>alert(1)</script>`',
  '```\n</code></pre><script>alert(1)</script>\n```',
  '```"><script>alert(1)</script>\n```',
  '| a |\n|---|\n| <script>alert(1)</script> |',
  '# <script>alert(1)</script>',
  '> <img src=x onerror=alert(1)>',
  '- <iframe src=x>',
  'x\u0000<script>alert(1)</script>',
  '&lt;script&gt;alert(1)&lt;/script&gt;',
  '&#60;script&#62;alert(1)&#60;/script&#62;',
  '<<script>alert(1)//<</script>',
  '<scr<script>ipt>alert(1)</scr</script>ipt>',
  '\\<script>alert(1)</script>',
  'www.example.com/<script>alert(1)</script>',
  'https://example.com/<script>alert(1)</script>',
  'https://example.com/"onmouseover="alert(1)',
  '[a](https://example.com/a)(javascript:alert(1))',
]

describe('F26-AC12, F26-AC13, F26-AC14: nothing hostile reaches the HTML', () => {
  test.each(HOSTILE)(
    'Given %j, When rendered, Then no script, iframe, form, handler, style or unsafe link is in the HTML',
    (source) => {
      const html = render(source)
      expect(onlyAllowed(html)).toBe(true)
      expect(html).not.toMatch(
        /<\s*(script|iframe|form|style|svg|math|object|embed|link|meta|base|body|input|button|video|source|details)\b/i,
      )
      // Text may say "onerror=", as escaped text; no element has such an attribute.
      for (const tag of tagsOf(html)) {
        expect(tag).not.toMatch(/\son[a-z]+\s*=/i)
        expect(tag).not.toMatch(/\s(style|srcdoc|formaction)\s*=/i)
      }
      for (const href of html.matchAll(/href="([^"]*)"/g))
        expect(href[1]).toMatch(/^(https?:\/\/|mailto:)/i)
      for (const tag of html.matchAll(/<a\b[^>]*>/g))
        expect(tag[0]).toContain('rel="noopener nofollow ugc"')
      expect(html).not.toContain('<img')
    },
  )

  test.each([
    '[x](javascript:alert(1))',
    '[x](JAVASCRIPT:alert(1))',
    '[x](&#106;avascript:alert(1))',
    '[x](data:text/html;base64,AAAA)',
    '[x](vbscript:x)',
    '[x](file:///etc/passwd)',
    '[x](//evil.example/x)',
    '[x](/relative)',
    '[x](ftp://example.com/x)',
  ])(
    'Given the link %s, When rendered, Then no link is made and the words stay as text',
    (source) => {
      const html = render(source)
      expect(html).not.toContain('<a')
      expect(html).toContain('x')
    },
  )

  test('Given a link title with a quote that tries to add an attribute, When rendered, Then the href stays one attribute', () => {
    const html = render('[x](https://example.com/" onmouseover="alert(1))')
    for (const tag of tagsOf(html)) expect(tag).not.toMatch(/\sonmouseover=/)
  })

  test('Given an image in the text, When rendered, Then no image is made', () => {
    expect(render('![alt](https://example.com/x.png)')).not.toContain('<img')
  })

  test('Given every link kind, When rendered, Then each link carries rel noopener nofollow ugc and no target', () => {
    const html = render(
      '[a](https://e.example/a) https://e.example/b <https://e.example/c> [m](mailto:x@e.example) [h](http://e.example)',
    )
    const tags = [...html.matchAll(/<a\b[^>]*>/g)].map((m) => m[0])
    expect(tags).toHaveLength(5)
    for (const tag of tags) {
      expect(tag).toContain('rel="noopener nofollow ugc"')
      expect(tag).not.toContain('target')
    }
  })
})

describe('F26-AC12: the second lock', () => {
  test.each([
    ['a script tag', '<script>x</script>'],
    ['an iframe', '<iframe src="x"></iframe>'],
    ['an event attribute', '<a href="https://e.example" onclick="x">a</a>'],
    ['a style attribute', '<p style="x">a</p>'],
    [
      'an unlisted attribute on a listed tag',
      '<a href="https://e.example" target="_blank">a</a>',
    ],
    ['an unquoted odd attribute', '<p onclick=x>a</p>'],
    ['a stray angle bracket', '<p>a < b</p>'],
    ['a closing tag with attributes', '</p onclick="x">'],
    ['a form', '<form></form>'],
  ])('Given %s, When checked, Then it is refused', (_name, html) => {
    expect(onlyAllowed(html)).toBe(false)
  })

  test('Given a plain article, When checked, Then it is allowed', () => {
    expect(
      onlyAllowed(
        '<p>a &lt; b</p>\n<a href="https://e.example" rel="noopener nofollow ugc">a</a>',
      ),
    ).toBe(true)
  })
})

describe('F26-AC17, F26-AC19, F26-AC21, F26-AC22: which paragraphs show a page', () => {
  const ref = (page: number) => `${ORIGIN}/@kfly8/talk/${page}`

  test.each([
    ['a bare URL on its own line', ref(3)],
    ['a URL in angle brackets', `<${ref(3)}>`],
    ['a URL with spaces around it', `  ${ref(3)}  `],
    ['an upper-case handle', `${ORIGIN}/@KFLY8/talk/3`],
    ['a trailing slash', `${ref(3)}/`],
    ['a zero-padded page', `${ORIGIN}/@kfly8/talk/03`],
  ])(
    'Given %s, When the text is read, Then page 3 of the deck is shown as an image',
    (_name, source) => {
      expect(embeddedPages(source, ORIGIN)).toEqual([
        { handle: 'kfly8', slug: 'talk', page: 3 },
      ])
    },
  )

  test.each([
    ['inside a sentence', `Look at ${ref(3)} for the figure.`],
    ['before words', `${ref(3)} is the figure`],
    ['after words on the same line', `figure ${ref(3)}`],
    ['two URLs on one line', `${ref(3)} ${ref(4)}`],
    ['two lines in one paragraph', `${ref(3)}\n${ref(4)}`],
    ['a Markdown link with words', `[page three](${ref(3)})`],
    ['an http URL', `http://slide.example/@kfly8/talk/3`],
    ['another origin', 'https://other.example/@kfly8/talk/3'],
    ['a look-alike origin', 'https://slide.example.evil.example/@kfly8/talk/3'],
    ['a query', `${ref(3)}?x=1`],
    ['a fragment', `${ref(3)}#a`],
    ['a deck without a page', `${ORIGIN}/@kfly8/talk`],
    ['a profile', `${ORIGIN}/@kfly8`],
    ['page 0', `${ORIGIN}/@kfly8/talk/0`],
    ['a page past the last number', `${ORIGIN}/@kfly8/talk/10000`],
    ['a list item', `- ${ref(3)}`],
    ['a quote', `> ${ref(3)}`],
    ['code', '`' + ref(3) + '`'],
    ['a code block', '```\n' + ref(3) + '\n```'],
    ['a table cell', `| a |\n|---|\n| ${ref(3)} |`],
    ['a reserved path', `${ORIGIN}/@kfly8/following/3`],
    ['a longer path', `${ORIGIN}/@kfly8/talk/3/4`],
  ])(
    'Given %s, When the text is read, Then no page is shown as an image',
    (_name, source) => {
      expect(embeddedPages(source, ORIGIN)).toEqual([])
    },
  )

  test('Given the same page twice and another, When read, Then each page is listed once in order', () => {
    expect(
      embeddedPages(`${ref(5)}\n\ntext\n\n${ref(3)}\n\n${ref(5)}`, ORIGIN).map(
        (page) => page.page,
      ),
    ).toEqual([5, 3])
  })

  test('Given thirty different pages, When read, Then only the first twenty are listed', () => {
    const source = Array.from({ length: 30 }, (_, i) => ref(i + 1)).join('\n\n')
    expect(embeddedPages(source, ORIGIN)).toHaveLength(20)
  })

  const own: Embed = { kind: 'own', imageUrl: '/covers/d/3.jpg' }
  const other: Embed = {
    kind: 'other',
    imageUrl: '/covers/e/5.jpg',
    title: 'Talk "A" <b>',
    author: 'Ann <script>',
  }

  test('F26-AC17, F26-AC18: Given the article’s own page and its image, When rendered, Then the image is a link marked to move the slides', () => {
    const html = renderArticle(ref(3), view(new Map([['kfly8/talk/3', own]])))
    expect(html).toContain('class="article-embed-link"')
    expect(html).toContain('href="/@kfly8/talk/3"')
    expect(html).toContain('data-article-page="3"')
    expect(html).toContain('src="/covers/d/3.jpg"')
    expect(html).toContain('3 ページ · 押すとスライドがこのページに移る')
    expect(html).toContain('aria-label="スライドの 3 ページへ移る"')
    expect(html).not.toContain('<p>https')
  })

  test('F26-AC19, F26-AC20: Given another author’s page, When rendered in each language, Then the image names author, title and page and opens that page', () => {
    const embeds = new Map([['kfly8/talk/5', other]])
    const ja = renderArticle(ref(5), view(embeds, 'ja'))
    expect(ja).toContain(
      'Ann &lt;script&gt;さんの『Talk &quot;A&quot; &lt;b&gt;』5 ページ',
    )
    expect(ja).toContain('href="/@kfly8/talk/5"')
    expect(ja).not.toContain('data-article-page')
    expect(onlyAllowed(ja)).toBe(true)
    const en = renderArticle(ref(5), view(embeds, 'en'))
    expect(en).toContain(
      '“Talk &quot;A&quot; &lt;b&gt;” by Ann &lt;script&gt;, page 5',
    )
    expect(onlyAllowed(en)).toBe(true)
  })

  test('F26-AC19: Given an author with no display name, When rendered, Then the handle stands in', () => {
    const html = renderArticle(
      ref(5),
      view(new Map([['kfly8/talk/5', { ...other, author: null }]])),
    )
    expect(html).toContain('@kfly8さんの')
  })

  test('F26-AC21: Given the URL inside a sentence, When rendered with its image known, Then it stays a plain link', () => {
    const html = renderArticle(
      `See ${ref(3)} please`,
      view(new Map([['kfly8/talk/3', own]])),
    )
    expect(html).not.toContain('article-embed')
    expect(html).toContain(`<a href="${ref(3)}" rel="noopener nofollow ugc">`)
  })

  test('F26-AC22: Given a page with no image known, When rendered, Then it is a plain link and no title shows', () => {
    const html = renderArticle(ref(3), view())
    expect(html).not.toContain('article-embed')
    expect(html).toContain(`<a href="${ref(3)}"`)
  })

  test('F26-AC17: Given an embed beside other blocks, When rendered, Then the blocks around it stay', () => {
    const html = renderArticle(
      `# Title\n\n${ref(3)}\n\nafter`,
      view(new Map([['kfly8/talk/3', own]])),
    )
    expect(html.indexOf('<h3>')).toBeLessThan(html.indexOf('article-embed'))
    expect(html.indexOf('article-embed')).toBeLessThan(
      html.indexOf('<p>after</p>'),
    )
  })
})

describe('F24-AC19, F24-AC21: the share URLs an article links to', () => {
  test('Given links in a sentence, a page image paragraph and a bare deck URL, When read, Then each is listed once with its page', () => {
    const text = [
      `See [the talk](${ORIGIN}/@a/talk/6) and ${ORIGIN}/@a/talk/6 again.`,
      `${ORIGIN}/@b/deck/2`,
      `<${ORIGIN}/@c/other>`,
    ].join('\n\n')
    expect(linkedShareUrls(text, ORIGIN)).toEqual([
      { handle: 'a', slug: 'talk', page: 6 },
      { handle: 'b', slug: 'deck', page: 2 },
      { handle: 'c', slug: 'other', page: 0 },
    ])
  })

  test.each([
    ['code', '`' + ORIGIN + '/@a/talk/6`'],
    ['a code block', '```\n' + ORIGIN + '/@a/talk/6\n```'],
    ['another origin', 'https://other.example/@a/talk/6'],
    ['an http URL', 'http://slide.example/@a/talk/6'],
    ['a profile', ORIGIN + '/@a'],
    ['plain words', 'the talk is at @a/talk/6'],
    ['a javascript link', '[x](javascript:alert(1))'],
  ])('Given %s, When read, Then no citation is found', (_name, source) => {
    expect(linkedShareUrls(source, ORIGIN)).toEqual([])
  })

  test('Given a URL with a query, a trailing slash and capitals, When read, Then it is the deck’s one name', () => {
    expect(
      linkedShareUrls(`${ORIGIN}/@A/Talk/6/?x=1`, ORIGIN).map((c) => c.handle),
    ).toEqual(['a'])
  })
})

describe('a text parsed once is read by every function', () => {
  const text = `${ORIGIN}/@a/talk/3\n\nand [x](${ORIGIN}/@b/deck)`
  const own: Embed = { kind: 'own', imageUrl: '/c.jpg' }
  const embeds = new Map([['a/talk/3', own]])

  test('Given the parsed text, When pages, links and HTML are read from it, Then each equals what the text gives, and drawing it twice gives the same HTML', () => {
    const parsed = parseArticle(text)
    expect(embeddedPages(parsed, ORIGIN)).toEqual(embeddedPages(text, ORIGIN))
    expect(linkedShareUrls(parsed, ORIGIN)).toEqual(
      linkedShareUrls(text, ORIGIN),
    )
    const first = renderArticle(parsed, view(embeds))
    expect(first).toContain('article-embed')
    expect(renderArticle(parsed, view(embeds))).toBe(first)
    // Drawing it with no image known afterwards still shows the plain link.
    expect(renderArticle(parsed, view())).not.toContain('article-embed')
    expect(first).toBe(renderArticle(text, view(embeds)))
  })
})

/** Every href of the links an article shows, as written in the HTML. */
const hrefsOf = (source: string) =>
  [...render(source).matchAll(/<a\b[^>]*\shref="([^"]*)"/g)].map((m) => m[1])

describe('F26-AC99: an address with a user name or password is text', () => {
  test.each([
    ['a Markdown link', '[公式](https://slide.community@evil.example/)'],
    ['an angle-bracket link', '<https://slide.community@evil.example/>'],
    ['a bare link', 'see https://slide.community@evil.example/ now'],
    ['a reference link', '[公式][r]\n\n[r]: https://user:pass@evil.example/'],
    ['a password alone', '[x](https://:pass@evil.example/)'],
    ['an http link', '[x](http://user@evil.example/a)'],
  ])(
    'Given %s, When rendered, Then no link is made and the words stay as text',
    (_name, source) => {
      const html = render(source)
      expect(html).not.toContain('<a')
      expect(onlyAllowed(html)).toBe(true)
    },
  )

  test('Given a backslash before the @, When rendered, Then no link leads to the host after the @, and what is linked leads where it reads', () => {
    const html = render('[x](https://slide.community\\@evil.example/)')
    expect(html).not.toMatch(/href="[^"]*evil/u)
    const linked = hrefsOf('[x](https://slide.community\\@evil.example/)')
    expect(linked.map((href) => new URL(href!).host)).toEqual([
      'slide.community',
    ])
  })

  test('Given the link of the spec, When rendered, Then its words and its address are shown as they were written', () => {
    expect(render('[公式](https://slide.community@evil.example/)')).toBe(
      '<p>[公式](https://slide.community@evil.example/)</p>\n',
    )
  })

  test('Given an @ in the path, the query or a mailto address, When rendered, Then it stays a link', () => {
    expect(
      hrefsOf(
        '[a](https://example.com/@kfly8) [b](https://example.com/a?to=x@y.example) [m](mailto:a@example.com)',
      ),
    ).toEqual([
      'https://example.com/@kfly8',
      'https://example.com/a?to=x@y.example',
      'mailto:a@example.com',
    ])
  })
})

describe('F26-AC100: a link out of the service leads to the sanitized address', () => {
  test('Given links with tracking parts, Luma’s tk and Medium’s source, When rendered, Then they are left out of the href and the other parts stay', () => {
    expect(
      hrefsOf(
        [
          '[a](https://example.com/a/?utm_source=x&b=1&fbclid=y#Top)',
          'https://lu.ma/abc?tk=secret&x=1',
          '<https://kfly8.medium.com/post?source=rss>',
          '[c](https://example.com/c?source=x&tk=y)',
        ].join('\n\n'),
      ),
    ).toEqual([
      'https://example.com/a/?b=1#Top',
      'https://lu.ma/abc?x=1',
      'https://kfly8.medium.com/post',
      'https://example.com/c?source=x&amp;tk=y',
    ])
  })

  test('Given an http: link, When rendered, Then it is sanitized as an https: one', () => {
    expect(hrefsOf('[x](http://Example.COM?utm_source=x)')).toEqual([
      'http://example.com/',
    ])
  })

  test('Given invisible and direction characters in a link, When rendered, Then the href holds them in their % form only', () => {
    const html = render(
      '[x](https://example.com/a‮b?x=​y#c⁦d) https://example.com/e‮f',
    )
    expect(hrefsOf('[x](https://example.com/a‮b?x=​y#c⁦d)')).toEqual([
      'https://example.com/a%E2%80%AEb?x=%E2%80%8By#c%E2%81%A6d',
    ])
    for (const href of html.matchAll(/href="([^"]*)"/g))
      expect(href[1]).toMatch(/^[\x21-\x7e]+$/u)
  })

  test('Given a direction character in a host, When rendered, Then the href names the host in its ASCII form', () => {
    const [href] = hrefsOf('[x](https://exa‮mple.com/)')
    expect(href).toMatch(/^https:\/\/xn--[a-z0-9-]+\.com\/$/u)
  })

  test('F26-AC98: Given share URLs of the service, When rendered, Then their hrefs stay as written', () => {
    expect(
      hrefsOf(
        `[p](${ORIGIN}/@kfly8/talk/3?utm_source=x) see ${ORIGIN}/@kfly8/talk now`,
      ),
    ).toEqual([`${ORIGIN}/@kfly8/talk/3?utm_source=x`, `${ORIGIN}/@kfly8/talk`])
  })

  test('Given a mailto link, When rendered, Then its href stays as written', () => {
    expect(hrefsOf('[m](mailto:a@example.com?subject=utm_source)')).toEqual([
      'mailto:a@example.com?subject=utm_source',
    ])
  })
})

describe('F26-AC97, F26-AC98: which links are checked before they are followed', () => {
  /** The opening tags of the links, by their href. */
  const tagsByHref = (source: string, embeds = new Map<string, Embed>()) =>
    Object.fromEntries(
      [...renderArticle(source, view(embeds)).matchAll(/<a\b[^>]*>/g)].map(
        (m) => [/href="([^"]*)"/.exec(m[0])![1], m[0]],
      ),
    )

  test('F26-AC97: Given https:, http: and mailto: links out of the service, When rendered, Then each is marked to be checked', () => {
    const tags = tagsByHref(
      '[a](https://e.example/a) https://e.example/b [h](http://e.example/c) [m](mailto:x@e.example)',
    )
    expect(Object.keys(tags)).toEqual([
      'https://e.example/a',
      'https://e.example/b',
      'http://e.example/c',
      'mailto:x@e.example',
    ])
    for (const tag of Object.values(tags)) {
      expect(tag).toContain(' data-link-check')
      expect(tag).toContain('aria-haspopup="dialog"')
    }
    expect(onlyAllowed(renderArticle('[a](https://e.example/a)', view()))).toBe(
      true,
    )
  })

  test('F26-AC98: Given share URLs of the service in a sentence and as a page image, When rendered, Then none is marked', () => {
    const html = renderArticle(
      `[p](${ORIGIN}/@kfly8/talk/3) ${ORIGIN}/@kfly8/talk\n\n${ORIGIN}/@kfly8/talk/2`,
      view(new Map([['kfly8/talk/2', { kind: 'own', imageUrl: '/x.png' }]])),
    )
    expect(html).toContain('article-embed-link')
    expect(html).not.toContain('data-link-check')
    expect(html).not.toContain('aria-haspopup')
  })
})
