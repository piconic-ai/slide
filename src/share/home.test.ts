import { expect, test } from 'vitest'
import {
  creatorSections,
  homeIntro,
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
  const page = (await homeIntro).toString()
  for (const section of sections) {
    // The formatter may break the heading over lines; only the order matters.
    const heading = new RegExp(
      `<h3 id="${section.id}">\\s*${section.title}\\s*<span class="status status-${section.status}">${STATUS_LABELS[section.status]}</span>\\s*</h3>`,
    )
    expect(page).toMatch(heading)
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
  const page = (await homeIntro).toString()
  expect(page).toContain('<h1>さわって、わかる。</h1>')
  expect(page).toContain('href="/decks">GitHub ではじめる</a>')
  expect(page).toContain('href="#touch">さわってみる</a>')
  // Mock screens are service markup only; no author content is embedded.
  expect(page).not.toContain('<iframe')
  expect(page).not.toContain('<script')
})
