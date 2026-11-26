import { expect, test } from 'vitest'
import { blockFormBody } from '../blocks/pages'
import {
  emptyNewCommunityForm,
  newCommunityBody,
} from '../communities/new-page'
import type { Handle } from '../share/handle'
import { pageStyle } from '../site/page-style'
import { findArticle } from './catalog'
import { HELP_CATALOG } from './default-catalog'
import { helpArticleLink } from './links'

const squash = (text: string) => text.replace(/\s+/g, '')

test('F36-AC26: Given a link to an article, When it is made, Then it points at the article’s URL and has room to press', () => {
  expect(String(helpArticleLink('safety', 'block-user', 'x'))).toBe(
    '<a class="help-link" href="/help/safety/block-user">x</a>',
  )
})

test.each(['ja', 'en'] as const)(
  'F36-AC46: Given the page that asks before blocking in %s, When it is drawn, Then it links to the help’s article on blocking, which is there',
  async (lang) => {
    const page = String(
      await blockFormBody(
        { handle: 'bob' as Handle, name: 'Bob', avatarUrl: null },
        '/@bob',
        lang,
      ),
    )
    expect(page).toContain('class="help-link" href="/help/safety/block-user"')
    expect(findArticle(HELP_CATALOG, 'safety', 'block-user')).not.toBeNull()
  },
)

test.each(['ja', 'en'] as const)(
  'F36-AC43: Given the page that makes a community in %s, When it is drawn, Then it links to the help’s article on making one, which is there',
  async (lang) => {
    const page = String(await newCommunityBody(emptyNewCommunityForm(''), lang))
    expect(page).toContain(
      'class="help-link" href="/help/community/create-community"',
    )
    expect(
      findArticle(HELP_CATALOG, 'community', 'create-community'),
    ).not.toBeNull()
  },
)

test('F36-AC41: Given the shared page style, When a link to the help stands alone, Then it is at least 44px tall to press', async () => {
  const style = squash(String(await pageStyle))
  expect(style).toMatch(/\.help-link\{[^}]*min-height:44px/)
})
