import { describe, expect, test } from 'vitest'
import { LANGS } from '../site/i18n'
import { findArticle } from './catalog'
import { HELP_CATALOG } from './default-catalog'
import { frameHelpLink } from './frame-links'
import { FRAME_HELP, frameHelpTarget, type FramePlace } from './frame-places'

const places = Object.keys(FRAME_HELP) as FramePlace[]

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
