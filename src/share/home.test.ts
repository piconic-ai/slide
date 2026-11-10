import { describe, expect, test } from 'vitest'
import { LANGS } from '../site/i18n'
import { japaneseOutside } from '../site/test-japanese'
import {
  homeCopy,
  homeFeatures,
  homeHero,
  homeOutro,
  statusBadge,
  type HomeCopy,
} from './home'

/** Markup without the line breaks the formatter puts between and in tags. */
const collapse = (markup: string) =>
  markup.replace(/\s+/g, ' ').replace(/\s*([<>])\s*/g, '$1')

const sectionsOf = (copy: HomeCopy) => [
  ...copy.readerSections,
  ...copy.learnSections,
  ...copy.creatorSections,
]

describe.each(LANGS)('the top page in %s', (lang) => {
  const copy = homeCopy[lang]
  const sections = sectionsOf(copy)

  test('Given each status, When its badge is rendered, Then it carries the label and a class per status', async () => {
    for (const status of ['done', 'wip', 'spec'] as const) {
      const badge = (await statusBadge(copy, status)).toString()
      expect(badge).toContain(`class="status status-${status}"`)
      expect(badge).toContain(copy.statusLabels[status])
    }
  })

  test('Given the sections, When rendered, Then every heading shows its title with its status badge', async () => {
    const page = (await homeFeatures(copy)).toString()
    for (const section of sections) {
      // The formatter may break the heading over lines; compare it collapsed.
      const start = page.indexOf(`<h3 id="${section.id}">`)
      const heading = collapse(
        page.slice(start, page.indexOf('</h3>', start) + 5),
      )
      expect(heading).toBe(
        `<h3 id="${section.id}">${section.title}<span class="status status-${section.status}">${copy.statusLabels[section.status]}</span></h3>`,
      )
      for (const paragraph of section.body) expect(page).toContain(paragraph)
    }
  })

  test('Given the sections, When listed, Then their IDs are unique and the shipped parts are the ones that exist today', () => {
    const ids = sections.map((section) => section.id)
    expect(new Set(ids).size).toBe(ids.length)
    const done = sections
      .filter((section) => section.status === 'done')
      .map((section) => section.id)
    // Decks run as HTML and arrive from the author's CI; both are live.
    expect(done).toEqual(['touch-demo', 'creator-tools'])
  })

  test('Given the hero, When rendered, Then it shows the one line and both ways in', async () => {
    const page = (await homeHero(copy)).toString()
    expect(page).toContain(`<h1>${copy.hero.heading}</h1>`)
    expect(page).toContain(`href="/decks">${copy.hero.start}</a>`)
    expect(page).toContain(`href="#touch">${copy.hero.tryIt}</a>`)
  })

  test('Given the hero and the feature sections, When rendered, Then their mock screens embed no author content', async () => {
    for (const part of [homeHero(copy), homeFeatures(copy)]) {
      const page = (await part).toString()
      expect(page).not.toContain('<iframe')
      expect(page).not.toContain('<script')
    }
  })
})

test('Given both languages, When their sections are compared, Then they are the same sections in the same order and state', () => {
  const outline = (copy: HomeCopy) =>
    sectionsOf(copy).map(({ id, status }) => ({ id, status }))
  expect(outline(homeCopy.en)).toEqual(outline(homeCopy.ja))
})

test('Given the English top page, When rendered, Then no Japanese is left', async () => {
  const copy = homeCopy.en
  for (const part of [homeHero(copy), homeFeatures(copy), homeOutro(copy)])
    expect(japaneseOutside((await part).toString())).toEqual([])
})
