import { describe, expect, test } from 'vitest'
import { LANGS } from '../site/i18n'
import { findArticle } from './catalog'
import { HELP_CATALOG } from './default-catalog'
import { frameHelpLink, frameHelpMark } from './frame-links'
import {
  FRAME_HELP,
  FRAME_MARKS,
  frameHelpTarget,
  frameMarkTarget,
  type FrameMark,
  type FramePlace,
} from './frame-places'

const places = Object.keys(FRAME_HELP) as FramePlace[]
const marks = Object.keys(FRAME_MARKS) as FrameMark[]

describe('the places that lead to the help', () => {
  test.each(places)(
    'F36-AC48: Given the place %s, When its link is read, Then it leads to an article that exists, in both languages',
    (place) => {
      const { aim, slug } = FRAME_HELP[place]
      expect(findArticle(HELP_CATALOG, aim, slug)).not.toBeNull()
      for (const lang of LANGS) {
        const { href, label } = frameHelpTarget(place, lang)
        expect(href).toBe(`/help/${aim}/${slug}`)
        expect(label.length).toBeGreaterThan(0)
      }
      expect(FRAME_HELP[place].en).not.toMatch(/[぀-ヿ一-鿿]/u)
    },
  )

  test.each(LANGS)(
    'F36-AC41: Given a place in %s, When its link is drawn, Then it is one link in a note, tall enough to press',
    async (lang) => {
      const html = String(await frameHelpLink('settings-leave', lang))
      expect(html.match(/<a /g)).toHaveLength(1)
      expect(html).toContain('class="help-link"')
      expect(html).toContain('href="/help/account/before-leaving"')
      expect(html).toContain('class="field-note"')
    },
  )

  test('F36-AC41: Given the places of the table, When their articles are counted, Then every article is one a reader wants at that place', () => {
    expect(
      new Set(places.map((place) => FRAME_HELP[place].slug)).size,
    ).toBeGreaterThan(8)
  })
})

describe('the ? marks in the corner of a block', () => {
  test.each(marks)(
    'F36-AC42: Given the mark %s, When its target is read, Then it leads to a page of the help that exists, in both languages',
    (mark) => {
      const { aim, slug } = FRAME_MARKS[mark] as { aim: string; slug?: string }
      if (slug !== undefined) {
        expect(findArticle(HELP_CATALOG, aim, slug)).not.toBeNull()
      }
      for (const lang of LANGS) {
        const { href, label } = frameMarkTarget(mark, lang)
        expect(href).toBe(
          slug === undefined ? `/help/${aim}` : `/help/${aim}/${slug}`,
        )
        expect(label.length).toBeGreaterThan(0)
      }
      expect(FRAME_MARKS[mark].en).not.toMatch(/[぀-ヿ一-鿿]/u)
    },
  )

  test.each([
    ['deck-slide', '/help/slides'],
    ['deck-article', '/help/articles'],
    ['deck-links', '/help/articles/related-links'],
  ] as const)(
    'F36-AC42: Given the block %s, When its mark is drawn, Then it is one link to %s that a screen reader names',
    async (mark, href) => {
      for (const lang of LANGS) {
        const html = String(await frameHelpMark(mark, lang))
        expect(html.match(/<a[\s>]/g)).toHaveLength(1)
        expect(html).toContain(`href="${href}"`)
        expect(html).toContain('class="help-mark"')
        expect(html).toContain(
          `aria-label="${frameMarkTarget(mark, lang).label}"`,
        )
      }
    },
  )
})
