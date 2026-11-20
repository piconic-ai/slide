import assert from 'node:assert/strict'
import { test } from 'vitest'
import {
  loadsPageScript,
  PAGE_SCRIPT_SRC,
  parsePageScript,
  withPageScript,
} from './page-script.mjs'

const TAG = `<script src="${PAGE_SCRIPT_SRC}"></script>`
const sent = (path, text) =>
  Buffer.from(withPageScript(path, Buffer.from(text))).toString('utf8')

test.each([
  [
    'a head',
    '<!doctype html><head><title>t</title></head><body>b</body>',
    `<!doctype html><head><title>t</title>${TAG}</head><body>b</body>`,
  ],
  [
    'a head closed in capitals',
    '<HTML><HEAD></HEAD ><BODY></BODY></HTML>',
    `<HTML><HEAD>${TAG}</HEAD ><BODY></BODY></HTML>`,
  ],
  ['only a body', '<body><p>b</p></body>', `<body><p>b</p>${TAG}</body>`],
  [
    'optional closing tags left out',
    '<!DOCTYPE html><title>t</title><p>b',
    `<!DOCTYPE html><title>t</title><p>b${TAG}`,
  ],
  [
    'a script whose string spells </head>',
    '<head><script>const t = "<head></head>"</script></head><body></body>',
    `<head><script>const t = "<head></head>"</script>${TAG}</head><body></body>`,
  ],
  [
    'a comment that spells </head>',
    '<!-- </head> --><head></head>',
    `<!-- </head> --><head>${TAG}</head>`,
  ],
  [
    'a template and a noscript that spell </head>',
    '<head><template></head></template><noscript></head></noscript></head>',
    `<head><template></head></template><noscript></head></noscript>${TAG}</head>`,
  ],
  [
    'no </head> and a textarea that spells </body>',
    '<html><textarea></body></textarea><p>b</p></body>',
    `<html><textarea></body></textarea><p>b</p>${TAG}</body>`,
  ],
  [
    'no </head> and a frame whose srcdoc spells </body>',
    '<html><iframe srcdoc="<body>x</body>"></iframe></body>',
    `<html><iframe srcdoc="<body>x</body>"></iframe>${TAG}</body>`,
  ],
  [
    'an attribute that spells </head>',
    '<html data-x="</head>"><head></head>',
    `<html data-x="</head>"><head>${TAG}</head>`,
  ],
  [
    'a template whose script spells </template></head>',
    '<!doctype html><head><template><script>const sample = "</template></head>";</script></template></head><body>slide</body>',
    `<!doctype html><head><template><script>const sample = "</template></head>";</script></template>${TAG}</head><body>slide</body>`,
  ],
  [
    'templates inside one another',
    '<head><template><template></head></template></head></template></head>',
    `<head><template><template></head></template></head></template>${TAG}</head>`,
  ],
  [
    'the script only in a comment',
    '<!doctype html><head><!-- <script src="/_preview/pages.js"></script> --></head>',
    `<!doctype html><head><!-- <script src="/_preview/pages.js"></script> -->${TAG}</head>`,
  ],
  [
    'the script only in a template',
    '<head><template><script src="/_preview/pages.js"></script></template></head>',
    `<head><template><script src="/_preview/pages.js"></script></template>${TAG}</head>`,
  ],
  [
    'the script only spelled in another script and in an attribute',
    `<head><script>const s = '<script src="/_preview/pages.js">'</script><meta name="x" content='<script src="/_preview/pages.js">'></head>`,
    `<head><script>const s = '<script src="/_preview/pages.js">'</script><meta name="x" content='<script src="/_preview/pages.js">'>${TAG}</head>`,
  ],
  [
    'UTF-8 declared the old way, in quotes',
    `<head><meta http-equiv="Content-Type" content='text/html; charset="utf-8"'></head>`,
    `<head><meta http-equiv="Content-Type" content='text/html; charset="utf-8"'>${TAG}</head>`,
  ],
  [
    'another charset declared over plain ASCII',
    '<head><meta charset="Shift_JIS"></head><body>slide</body>',
    `<head><meta charset="Shift_JIS">${TAG}</head><body>slide</body>`,
  ],
  [
    'a mention of the script in its text',
    '<head></head><body><code>/_preview/pages.js</code></body>',
    `<head>${TAG}</head><body><code>/_preview/pages.js</code></body>`,
  ],
  [
    'a UTF-8 charset and Japanese text',
    '<head><meta charset="UTF-8"><title>発表</title></head>',
    `<head><meta charset="UTF-8"><title>発表</title>${TAG}</head>`,
  ],
  [
    'UTF-8 declared the old way',
    '<head><meta http-equiv="Content-Type" content="text/html; charset=utf8"></head>',
    `<head><meta http-equiv="Content-Type" content="text/html; charset=utf8">${TAG}</head>`,
  ],
])(
  'Given an HTML file with %s, When it is prepared, Then the script tag is added once where it runs first',
  (_, html, expected) => {
    assert.equal(sent('index.html', html), expected)
    assert.equal(sent('index.html', expected), expected)
  },
)

test('Given an HTML file with a byte order mark, When it is prepared, Then the mark stays first', () => {
  const bytes = withPageScript(
    'a.htm',
    Buffer.concat([
      Buffer.from([0xef, 0xbb, 0xbf]),
      Buffer.from('<!doctype html><p>a</p>'),
    ]),
  )
  assert.deepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf])
  assert.equal(
    Buffer.from(bytes.subarray(3)).toString(),
    `<!doctype html><p>a</p>${TAG}`,
  )
})

test.each([
  ['a stylesheet', 'site.css', Buffer.from('</head>')],
  [
    'a piece of HTML a slide inserts',
    'parts/card.html',
    Buffer.from('<h1>title</h1>'),
  ],
  ['an empty file', 'empty.html', Buffer.from('')],
  [
    'HTML that already loads the script',
    'index.html',
    Buffer.from(
      "<head><script defer src='/_preview/pages.js'></script></head>",
    ),
  ],
  [
    'UTF-16 without a byte order mark',
    'wide.html',
    Buffer.from('<html></html>', 'utf16le'),
  ],
  ['a script named like a page', 'js/page.html.js', Buffer.from('</head>')],
  [
    'HTML that is not UTF-8',
    'sjis.html',
    Buffer.from([0x3c, 0x70, 0x3e, 0x82, 0xa0]),
  ],
  [
    'ISO-2022-JP, whose characters use ASCII bytes',
    'jis.html',
    Buffer.from([
      ...Buffer.from('<head>'),
      0x1b,
      0x24,
      0x42,
      0x3c,
      0x2f,
      0x1b,
      0x28,
      0x42,
      ...Buffer.from('</head>'),
    ]),
  ],
])(
  'Given %s, When it is prepared, Then its bytes are sent as built',
  (_, path, bytes) => {
    assert.equal(withPageScript(path, bytes), bytes)
  },
)

test('Given the setting, When it is parsed, Then only false turns the script off and other words are refused', () => {
  assert.equal(parsePageScript(undefined), true)
  assert.equal(parsePageScript(''), true)
  assert.equal(parsePageScript('true'), true)
  assert.equal(parsePageScript('false'), false)
  assert.throws(() => parsePageScript('no'), /SLIDE_PAGE_SCRIPT/)
})

test.each([
  ['in its head', `<!doctype html><head>${TAG}</head><body></body>`],
  ['at the end of a body with no head', `<body><p>b</p>${TAG}</body>`],
  [
    'with other attributes and a query',
    "<head><SCRIPT defer SRC='/_preview/pages.js?v=1'></SCRIPT></head>",
  ],
  ['after a long head', `<head><style>${'a{}'.repeat(40000)}</style>${TAG}`],
])(
  'Given a document that loads the page script %s, When asked, Then it loads it',
  (_case, html) => {
    assert.equal(loadsPageScript(html), true)
  },
)

test.each([
  ['nothing', ''],
  ['no script', '<!doctype html><title>t</title><p>b'],
  ['another script', '<script src="/app.js"></script>'],
  ['the tag in a comment', `<head><!-- ${TAG} --></head>`],
  ['the tag in a script string', `<script>const s = '${TAG}'</script>`],
  ['the tag in a template', `<template>${TAG}</template>`],
  ['the tag in a textarea', `<textarea>${TAG}</textarea>`],
  ['the path as text', '<p>/_preview/pages.js</p>'],
  [
    'the path on another element',
    '<link rel="preload" href="/_preview/pages.js">',
  ],
  ['the path elsewhere', '<script src="https://x.example/_preview/pages.js">'],
])(
  'Given a document with %s, When asked, Then it does not load the page script',
  (_case, html) => {
    assert.equal(loadsPageScript(html), false)
  },
)

// What the scan made of tags left open before it was made linear; kept so.
test.each([
  ['an open tag swallows the script tag', `<a ${TAG}`, false],
  ['open tags swallow the script tag', `${'<a '.repeat(3)}${TAG}`, false],
  ['an open quote leaves the tag unread', `<a "${TAG}`, true],
  ['an open quote of each kind', `<a '${TAG}<b ">`, true],
  ['a quoted > does not close the tag', `<p title=">"${TAG}`, false],
  ['quotes that close around both tags', `<a "<b '${TAG}"${TAG}`, false],
])(
  'Given markup where %s, When asked, Then the answer is what the uploader has always given',
  (_case, html, loads) => {
    assert.equal(loadsPageScript(html), loads)
  },
)

const LARGEST_FILE = 5 * 1024 * 1024
const filled = (unit) =>
  `<!doctype html><html><head></head><body>${unit.repeat(Math.ceil(LARGEST_FILE / unit.length))}`

// The service reads a received index.html of up to 5MB with this scan. Left
// quadratic, 60KB of unclosed tags took seconds and 5MB would never end.
test.each([
  ['tags that never close', '<a '],
  ['tags that open a quote and never close', '<a "'],
  ['tags that open quotes of both kinds', `<a "<b '<c `],
  ['comments that never close', '<!--'],
  ['scripts that never close', '<script>'],
  ['script end tags that never close', '<script></script   '],
  ['templates that never close', '<template>'],
  ['script tags with unclosed attribute values', `<script src=x a=" b=' `],
  ['bare less-than signs', '<'],
])(
  'Given the largest file full of %s, When asked whether it loads the page script, Then the answer comes in time linear in its size',
  (_case, unit) => {
    const html = filled(unit)
    const started = performance.now()

    const loads = loadsPageScript(html)

    assert.equal(loads, false)
    assert.ok(performance.now() - started < 30000)
  },
  60000,
)

test('Given the largest file full of unclosed tags that ends by loading the page script, When asked, Then it is still read to its end', () => {
  assert.equal(loadsPageScript(`${filled('<a ">" ')}>${TAG}`), true)
})
