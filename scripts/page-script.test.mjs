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
  ['neither', '<h1>title</h1>', `<h1>title</h1>${TAG}`],
  ['nothing', '', TAG],
  [
    'a UTF-8 charset and Japanese text',
    '<head><meta charset="UTF-8"><title>発表</title></head>',
    `<head><meta charset="UTF-8"><title>発表</title>${TAG}</head>`,
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
    Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('<p>a</p>')]),
  )
  assert.deepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf])
  assert.equal(bytes.subarray(3).toString(), `<p>a</p>${TAG}`)
})

test.each([
  ['a stylesheet', 'site.css', Buffer.from('</head>')],
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
