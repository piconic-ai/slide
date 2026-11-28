import { expect, test } from 'vitest'
import { handleSchema } from './handle'
import { viewerEventsFrame, type ViewerEvent } from './viewer-events-frame'

const flat = (value: unknown) =>
  String(value).replace(/\s+/g, ' ').replace(/ >/g, '>').replace(/ </g, '<')

const community = {
  id: 77,
  handle: handleSchema.parse('kanagawapm'),
  name: 'Kanagawa.pm',
  color: 'green',
  logoAt: null,
  coverAt: null,
} as const

const event = (
  id: number,
  name: string | null,
  inCommunity: ViewerEvent['community'] = null,
): ViewerEvent => ({
  id,
  service: 'connpass',
  ref: String(410600 + id),
  host: 'kanagawapm.connpass.com',
  url: `https://connpass.com/event/${410600 + id}/`,
  name,
  community: inCommunity,
})

test('F24-AC51: Given an event in a community, When the viewer draws its line, Then the logo, the event to its page, “で発表” and the community to its page come in that order', async () => {
  const line = flat(
    await viewerEventsFrame([event(1, 'Kanagawa.pm #3', community)], 'ja'),
  )
  const logo = line.indexOf('class="community-logo community-logo-28"')
  const name = line.indexOf(
    '<a class="viewer-event-name" href="/link/connpass.com/event/410601">Kanagawa.pm #3</a>',
  )
  const presented = line.indexOf('<span>で発表</span>')
  const home = line.indexOf('<a href="/@kanagawapm">Kanagawa.pm</a>')
  expect([logo, name, presented, home].every((at) => at >= 0)).toBe(true)
  expect(logo < name && name < presented && presented < home).toBe(true)
  // The initial on the community's shade, as the logo has no upload.
  expect(line).toContain('var(--community-green)')
})

test('F24-AC51: Given a community with an uploaded logo, When the viewer draws its line, Then the uploaded logo shows at 28px', async () => {
  const line = flat(
    await viewerEventsFrame(
      [event(1, 'Kanagawa.pm #3', { ...community, logoAt: 1234 })],
      'ja',
    ),
  )
  expect(line).toContain('src="/communities/77/logo?v=1234"')
  expect(line).toContain('width="28"')
})

test('F24-AC51: Given an event in no community, When the viewer draws its line, Then neither a logo nor a community shows', async () => {
  const line = flat(await viewerEventsFrame([event(1, 'Perl Meetup')], 'ja'))
  expect(line).toContain(
    'href="/link/connpass.com/event/410601">Perl Meetup</a><span>で発表</span>',
  )
  expect(line).not.toContain('community-logo')
  expect(line).not.toContain('href="/@')
})

test('F24-AC51: Given an event without a name and a reader in English, When the viewer draws its line, Then it reads “Presented at” before the event’s fallback name', async () => {
  const line = flat(await viewerEventsFrame([event(1, null, community)], 'en'))
  expect(line).toContain(
    '<span>Presented at</span><a class="viewer-event-name" href="/link/connpass.com/event/410601">connpass event 410601</a>',
  )
  expect(line).toContain('aria-label="Events presented at"')
})

test('F24-AC40: Given several events, When the viewer draws them, Then one line each comes in the order given', async () => {
  const lines = flat(
    await viewerEventsFrame(
      [event(3, 'Third'), event(1, 'First', community), event(2, 'Second')],
      'ja',
    ),
  )
  expect(lines.match(/<li class="viewer-event">/g)).toHaveLength(3)
  expect(lines.indexOf('Third')).toBeLessThan(lines.indexOf('First'))
  expect(lines.indexOf('First')).toBeLessThan(lines.indexOf('Second'))
})

test('F24-AC51: Given names with markup, When the viewer draws the line, Then they are written as text', async () => {
  const line = flat(
    await viewerEventsFrame(
      [
        event(1, '<script>alert(1)</script>', {
          ...community,
          name: '<b>"pm"</b>',
        }),
      ],
      'ja',
    ),
  )
  expect(line).not.toContain('<script>')
  expect(line).not.toContain('<b>')
  expect(line).toContain('&lt;script&gt;')
})

test('F24-AC51: Given no event, When the viewer draws the place, Then it holds nothing at all', () => {
  expect(String(viewerEventsFrame([], 'ja'))).toBe('')
  expect(String(viewerEventsFrame([], 'en'))).toBe('')
})

test.each([
  ['https://loom.com/embed/x', '/link/loom.com/embed/x'],
  ['https://vimeo.com/123/abc', '/link/vimeo.com/123/abc'],
  ['https://www.example.com/conf/', '/link/www.example.com/conf'],
])(
  'F24-AC51: Given an event of another site at %s, When the viewer draws its line, Then it leads to the page at the address as written, %s',
  async (url, path) => {
    const line = flat(
      await viewerEventsFrame(
        [{ ...event(1, 'Talk night'), service: 'web', url }],
        'ja',
      ),
    )
    expect(line).toContain(
      `<a class="viewer-event-name" href="${path}">Talk night</a>`,
    )
  },
)
