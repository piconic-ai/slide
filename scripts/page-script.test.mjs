import assert from 'node:assert/strict'
import { test } from 'vitest'
import {
  PAGE_SCRIPT_SRC,
  parsePageScript,
  withPageScript,
} from './page-script.mjs'

const TAG = `<script src="${PAGE_SCRIPT_SRC}"></script>`
const sent = (path, text) =>
  withPageScript(path, Buffer.from(text)).toString('utf8')

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
    'another charset only in a comment and in its text',
    '<head><!-- <meta charset="Shift_JIS"> --><meta name="description" content="about charset=latin1"></head><body>charset=euc-jp</body>',
    `<head><!-- <meta charset="Shift_JIS"> --><meta name="description" content="about charset=latin1">${TAG}</head><body>charset=euc-jp</body>`,
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
  assert.equal(bytes.subarray(3).toString(), `<!doctype html><p>a</p>${TAG}`)
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
    'HTML that declares another charset',
    'legacy.html',
    Buffer.from('<head><meta charset="Shift_JIS"></head>'),
  ],
  [
    'HTML that declares another charset after other attributes',
    'late.html',
    Buffer.from('<head><meta data-x="1" CHARSET = sjis></head>'),
  ],
  [
    'HTML that declares it the old way',
    'old.html',
    Buffer.from(
      '<head><meta http-equiv="Content-Type" content="text/html; charset=euc-jp"></head>',
    ),
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
