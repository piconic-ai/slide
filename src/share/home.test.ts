import { expect, test } from 'vitest'
import {
  creatorSections,
  homeFeatures,
  homeHero,
  learnSections,
  readerSections,
  STATUS_LABELS,
  statusBadge,
} from './home'

const sections = [...readerSections, ...learnSections, ...creatorSections]

test('Given each status, When its badge is rendered, Then it carries the Japanese label and a class per status', async () => {
  for (const status of ['done', 'wip', 'spec'] as const) {
    const badge = (await statusBadge(status)).toString()
    expect(badge).toContain(`class="status status-${status}"`)
    expect(badge).toContain(STATUS_LABELS[status])
  }
})

test('Given the top page sections, When rendered, Then every heading shows its title with its status badge', async () => {
  const page = (await homeFeatures).toString()
  for (const section of sections) {
    // The formatter may break the heading over lines; compare it collapsed.
    const start = page.indexOf(`<h3 id="${section.id}">`)
    const heading = page
      .slice(start, page.indexOf('</h3>', start) + 5)
      .replace(/\s+/g, ' ')
      .replace(/> | </g, (gap) => gap.trim())
    expect(heading).toBe(
      `<h3 id="${section.id}">${section.title}<span class="status status-${section.status}">${STATUS_LABELS[section.status]}</span></h3>`,
    )
    for (const paragraph of section.body) expect(page).toContain(paragraph)
  }
})

test('Given the top page sections, When listed, Then their IDs are unique and the shipped parts are the ones that exist today', () => {
  const ids = sections.map((section) => section.id)
  expect(new Set(ids).size).toBe(ids.length)
  const done = sections
    .filter((section) => section.status === 'done')
    .map((section) => section.id)
  // Decks run as HTML and arrive from the author's CI; both are live.
  expect(done).toEqual(['touch-demo', 'creator-tools'])
})

test('Given the hero, When rendered, Then it shows the one line and both ways in', async () => {
  const page = (await homeHero).toString()
  expect(page).toContain('<h1>さわって、わかる。</h1>')
  expect(page).toContain('href="/decks">GitHub ではじめる</a>')
  expect(page).toContain('href="#touch">さわってみる</a>')
})

test('Given the hero and the feature sections, When rendered, Then their mock screens embed no author content', async () => {
  for (const part of [homeHero, homeFeatures]) {
    const page = (await part).toString()
    expect(page).not.toContain('<iframe')
    expect(page).not.toContain('<script')
  }
})
