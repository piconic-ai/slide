import { expect, test } from 'vitest'
import { postPrefixes, postUrl } from './share-links'
import type { Lang } from '../site/i18n'
import { viewerActions, type ViewerActionsView } from './viewer-actions'

const SHARE = 'https://slide.example/@owner/talk'
const view = (over: Partial<ViewerActionsView> = {}): ViewerActionsView => ({
  handle: 'owner',
  title: 'Good talk',
  slide: '/@owner/talk',
  shareUrl: SHARE,
  embedCode: null,
  controls: 'none',
  editPath: null,
  ...over,
})

/** The share menu's markup, without the rest of the actions. */
const shareMenu = (over: Partial<ViewerActionsView> = {}, lang: Lang = 'ja') =>
  /<details class="action-menu share-menu" data-menu>([\s\S]*?)<\/details>/.exec(
    String(viewerActions(view(over), lang)),
  )?.[1] ?? ''

/** The opening tag of the one element that has the attribute. */
function tagWith(menu: string, attribute: string) {
  const tags = menu.match(/<[a-z]+\b[^>]*>/g) ?? []
  const found = tags.filter((tag) => tag.includes(attribute))
  expect(found).toHaveLength(1)
  return found[0] ?? ''
}

/** An attribute's value as a browser reads it. */
const valueOf = (tag: string, name: string) =>
  (new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1] ?? '')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&')

test('F03-AC13: Given the viewer of slides, When the share menu is drawn, Then “copy link” copies the field holding the URL of the slides, which is shown', () => {
  const menu = shareMenu()
  const field = tagWith(menu, 'id="share-url"')
  expect(valueOf(field, 'value')).toBe(SHARE)
  expect(field).not.toMatch(/\shidden\b/)
  expect(menu).toMatch(
    /<button type="button" data-copy="share-url"[^>]*>\s*<span class="copy-label"[\s\S]*?<span class="copy-idle">URL をコピー<\/span\s*><span class="copy-done">コピーしました<\/span>/,
  )
})

test('F03-AC15: Given slides that have told no page yet, When the share menu is drawn, Then copying the page’s URL and its field are hidden', () => {
  const menu = shareMenu()
  const button = tagWith(menu, 'data-share-page')
  expect(valueOf(button, 'data-copy')).toBe('share-page-url')
  expect(button).toMatch(/\shidden\b/)
  expect(menu).toContain(
    '<span class="copy-idle">いま見ているページの URL をコピー</span',
  )
  const field = tagWith(menu, 'id="share-page-url"')
  expect(field).toMatch(/\shidden\b/)
  // Until a page is told, the page's URL is the URL of the slides.
  expect(valueOf(field, 'value')).toBe(SHARE)
})

test.each([
  ['a plain title', 'Good talk'],
  ['a title with quotes and markup', `"><script>alert('1')</script> & more`],
])(
  'F03-AC16: Given %s, When the share menu is drawn, Then the two post links open the compose screens in a new tab with the title and the URL of the slides',
  (_, title) => {
    const menu = shareMenu({ title })
    expect(menu).not.toContain('<script')
    const prefixes = postPrefixes(title)
    const links = menu.match(/<a\b[^>]*data-share-post[^>]*>/g) ?? []
    expect(links).toHaveLength(2)
    for (const [index, prefix] of [prefixes.x, prefixes.bluesky].entries()) {
      const link = links[index] ?? ''
      expect(valueOf(link, 'href')).toBe(postUrl(prefix, SHARE))
      // The script appends the page's URL to this.
      expect(valueOf(link, 'data-share-post')).toBe(prefix)
      expect(valueOf(link, 'target')).toBe('_blank')
      expect(valueOf(link, 'rel')).toBe('noopener noreferrer')
    }
    expect(menu).toMatch(/>X に投稿<\/a\s*>/)
    expect(menu).toMatch(/>Bluesky に投稿<\/a\s*>/)
  },
)

test('F03-AC18: Given the share menu, When it is drawn, Then both copy buttons name what to show once copied and the status line a screen reader reads', () => {
  const menu = shareMenu()
  const buttons = menu.match(/<button\b[^>]*data-copy=[^>]*>/g) ?? []
  expect(buttons).toHaveLength(2)
  for (const button of buttons) {
    expect(valueOf(button, 'data-copied')).toBe('コピーしました')
    expect(valueOf(button, 'data-copy-status')).toBe('share-status')
  }
  expect(menu).toContain(
    '<p class="share-status" id="share-status" role="status"></p>',
  )
})

test('F03-AC19: Given the share menu, When it is drawn, Then sharing with another app is hidden until the script finds the browser can, and carries the title', () => {
  const button = tagWith(
    shareMenu({ title: 'A "quoted" talk' }),
    'data-share-native',
  )
  expect(button).toMatch(/\shidden\b/)
  expect(valueOf(button, 'data-share-title')).toBe('A "quoted" talk')
})

test('F03-AC13, F03-AC16, F03-AC19: Given the English viewer, When the share menu is drawn, Then every item is worded in English', () => {
  const menu = shareMenu({}, 'en')
  for (const words of [
    'Copy link',
    'Copy link to this page',
    'Post to X',
    'Post to Bluesky',
    'Share with another app',
    'data-copied="Copied"',
  ])
    expect(menu).toContain(words)
  expect(menu).not.toMatch(/[ぁ-んァ-ヶ一-龠]/)
})

test('F03-AC17: Given slides that are not public, When the share menu is drawn, Then copying the embed code is not offered; for public slides it is, after the posts', () => {
  const without = shareMenu({ embedCode: null })
  expect(without).not.toContain('embed-code')
  expect(without).not.toContain('埋め込みコードをコピー')

  const code =
    '<iframe src="https://slide.example/embed/@owner/talk" title="A &quot;b&quot;"></iframe>'
  const menu = shareMenu({ embedCode: code })
  const field = tagWith(menu, 'id="embed-code"')
  expect(valueOf(field, 'value')).toBe(code)
  expect(field).toMatch(/\shidden\b/)
  // The code is text in the menu, never markup of it.
  expect(menu).not.toContain('<iframe')
  const button = tagWith(menu, 'data-copy="embed-code"')
  expect(valueOf(button, 'data-copy-status')).toBe('share-status')
  const order = [
    'Bluesky に投稿',
    '埋め込みコードをコピー',
    'ほかのアプリで共有',
  ].map((words) => menu.indexOf(words))
  expect(order).toEqual([...order].sort((a, b) => a - b))
  expect(shareMenu({ embedCode: code }, 'en')).toContain('Copy embed code')
})

const actionsOf = (over: Partial<ViewerActionsView> = {}, lang: Lang = 'ja') =>
  String(viewerActions(view(over), lang))

test('F03-AC29: Given the author’s own page for the slides, When the actions are drawn, Then “edit” leads them, before full screen and share', () => {
  const actions = actionsOf({ editPath: '/my/slides/talk' })
  const edit = actions.indexOf('>編集する</a')
  expect(edit).toBeGreaterThan(-1)
  expect(edit).toBeLessThan(actions.indexOf('data-fullscreen'))
  expect(edit).toBeLessThan(actions.indexOf('共有</summary>'))
})

test('F03-AC30: Given the author’s page for the slides, When “edit” is drawn, Then it is a link to that page, in either language', () => {
  expect(actionsOf({ editPath: '/my/slides/talk' })).toMatch(
    /<a class="button-secondary" href="\/my\/slides\/talk"\s*>編集する<\/a/,
  )
  expect(actionsOf({ editPath: '/my/slides/talk' }, 'en')).toMatch(
    /href="\/my\/slides\/talk"\s*>Edit<\/a/,
  )
})

test.each(['none', 'can-follow', 'following', 'muted'] as const)(
  'F03-AC31 F03-AC32 F03-AC34: Given no page of the author’s (%s), When the actions are drawn, Then there is no “edit” and the actions are full screen, share and the rest',
  (controls) => {
    const actions = actionsOf({ controls, editPath: null })
    expect(actions).not.toContain('編集する')
    expect(actions.match(/<button\b[^>]*data-fullscreen="deck"/g)).toHaveLength(
      1,
    )
    expect(actions.match(/<summary\b/g)).toHaveLength(2)
  },
)
