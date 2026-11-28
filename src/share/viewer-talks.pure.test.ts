import { describe, expect, test } from 'vitest'
import type { CitedDeck } from '../citations/store'
import { deckSlugSchema } from '../decks/deck-id'
import { handleSchema } from './handle'
import type { ViewerEvent } from './viewer-events-frame'
import {
  viewerSameCommunityFrame,
  viewerSameEventFrame,
} from './viewer-recommendations-frame'
import {
  NO_TALKS,
  planTalkSections,
  toViewerTalks,
  type TalksRead,
} from './viewer-talks'

const talk = (slug: string, handle = 'owner'): CitedDeck => ({
  handle: handleSchema.parse(handle),
  slug: deckSlugSchema.parse(slug),
  title: slug,
  deploymentId: `d-${slug}`,
  coverPath: null,
  at: 1,
})
const talks = (prefix: string, count: number) =>
  Array.from({ length: count }, (_, index) => talk(`${prefix}${index}`))

const community = {
  id: 77,
  handle: handleSchema.parse('kanagawapm'),
  name: 'Kanagawa.pm',
  color: 'green',
  logoAt: null,
  coverAt: null,
} as const
const event = (inCommunity: ViewerEvent['community']): ViewerEvent => ({
  id: 5,
  service: 'connpass',
  ref: '410635',
  host: 'kanagawapm.connpass.com',
  url: 'https://connpass.com/event/410635/',
  name: 'Kanagawa.pm #3',
  firstTitle: null,
  community: inCommunity,
})
const read = (
  sameEvent: readonly CitedDeck[],
  otherEvents: readonly CitedDeck[],
  inCommunity: ViewerEvent['community'] = community,
): TalksRead => ({ event: event(inCommunity), sameEvent, otherEvents })

const slugs = (list: readonly CitedDeck[]) => list.map((deck) => deck.slug)
const none = new Set<string>()

describe('planTalkSections', () => {
  test.each([
    [0, false],
    [1, false],
    [3, false],
    [4, true],
    [5, true],
    [8, true],
  ])(
    'F24-AC41, F24-AC42: Given %i other talks of the same event in a community, When the sections are planned, Then the event has its own section: %s',
    (count, split) => {
      const sections = planTalkSections(
        read(talks('e', count), talks('o', 2)),
        none,
      )
      if (split) {
        expect(slugs(sections.sameEvent)).toEqual(slugs(talks('e', count)))
        expect(slugs(sections.sameCommunity)).toEqual(['o0', 'o1'])
      } else {
        expect(sections.sameEvent).toEqual([])
        expect(slugs(sections.sameCommunity)).toEqual([
          ...slugs(talks('e', count)),
          'o0',
          'o1',
        ])
      }
    },
  )

  test('F24-AC42: Given three talks of the event and eight of other events, When the sections are planned, Then the community’s section holds the three first and is cut at eight', () => {
    const sections = planTalkSections(read(talks('e', 3), talks('o', 8)), none)
    expect(slugs(sections.sameCommunity)).toEqual([
      'e0',
      'e1',
      'e2',
      'o0',
      'o1',
      'o2',
      'o3',
      'o4',
    ])
  })

  test.each([1, 3, 4, 9])(
    'F24-AC43: Given an event in no community and %i other talks, When the sections are planned, Then the event’s section alone stands',
    (count) => {
      const sections = planTalkSections(read(talks('e', count), [], null), none)
      expect(slugs(sections.sameEvent)).toEqual(
        slugs(talks('e', Math.min(count, 8))),
      )
      expect(sections.sameCommunity).toEqual([])
    },
  )

  test('F24-AC44: Given more than eight talks on each side, When the sections are planned, Then each holds eight', () => {
    const sections = planTalkSections(
      read(talks('e', 16), talks('o', 16)),
      none,
    )
    expect(sections.sameEvent).toHaveLength(8)
    expect(sections.sameCommunity).toHaveLength(8)
  })

  test('F24-AC44: Given no event, or an event with no other talk, When the sections are planned, Then both are empty', () => {
    expect(planTalkSections(null, none)).toEqual({
      sameEvent: [],
      sameCommunity: [],
    })
    expect(planTalkSections(read([], []), none)).toEqual({
      sameEvent: [],
      sameCommunity: [],
    })
  })

  test('F24-AC46: Given talks the citations show, When the sections are planned, Then they are left out but still count toward the event’s own section', () => {
    const shown = new Set(['/@owner/e0', '/@owner/o1'])
    const sections = planTalkSections(read(talks('e', 4), talks('o', 2)), shown)
    expect(slugs(sections.sameEvent)).toEqual(['e1', 'e2', 'e3'])
    expect(slugs(sections.sameCommunity)).toEqual(['o0'])
  })

  test('F24-AC46: Given every talk is shown by the citations, When the sections are planned, Then both are empty', () => {
    const all = [...talks('e', 2), ...talks('o', 2)]
    const shown = new Set(all.map((deck) => `/@owner/${deck.slug}`))
    const sections = planTalkSections(read(talks('e', 2), talks('o', 2)), shown)
    expect(sections).toEqual({ sameEvent: [], sameCommunity: [] })
  })
})

const flat = (value: unknown) =>
  String(value).replace(/\s+/g, ' ').replace(/ >/g, '>').replace(/ </g, '<')

const noCitations = {
  cites: { shown: [], more: 0 },
  citedBy: { shown: [], more: 0 },
}

describe('the sections', () => {
  test('F24-AC52: Given both sections, When they are drawn, Then each heading stands with the way to the event or the community', async () => {
    const view = toViewerTalks(
      read(talks('e', 4), talks('o', 1)),
      noCitations,
      null,
    )
    const event = flat(await viewerSameEventFrame(view, 'ja'))
    const home = flat(await viewerSameCommunityFrame(view, 'ja'))
    expect(event).toContain(
      '<h2 id="same-event">Kanagawa.pm #3 のほかの発表</h2><a href="/link/connpass.com/event/410635">イベントを見る</a>',
    )
    expect(event).toContain('aria-labelledby="same-event"')
    expect(home).toContain(
      '<h2 id="same-community">Kanagawa.pm のほかのイベントの発表</h2><a href="/@kanagawapm">コミュニティを見る</a>',
    )
    expect(home).toContain('href="/@owner/o0"')
  })

  test('F24-AC52: Given a reader in English, When the sections are drawn, Then the headings and the ways read in English', async () => {
    const view = toViewerTalks(
      read(talks('e', 4), talks('o', 1)),
      noCitations,
      null,
    )
    expect(flat(await viewerSameEventFrame(view, 'en'))).toContain(
      'Other talks at Kanagawa.pm #3</h2><a href="/link/connpass.com/event/410635">View the event</a>',
    )
    expect(flat(await viewerSameCommunityFrame(view, 'en'))).toContain(
      'Talks at other events of Kanagawa.pm</h2><a href="/@kanagawapm">View the community</a>',
    )
  })

  test.each(['ja', 'en'] as const)(
    'F24-AC44: Given no talk, When the sections are drawn in %s, Then their places stand empty, with no heading',
    async (lang) => {
      expect(flat(await viewerSameEventFrame(NO_TALKS, lang))).toBe(
        '<div data-reader-lists="same-event"></div>',
      )
      expect(flat(await viewerSameCommunityFrame(NO_TALKS, lang))).toBe(
        '<div data-reader-lists="same-community"></div>',
      )
    },
  )

  test('F24-AC51: Given names with markup, When the sections are drawn, Then they are written as text', async () => {
    const view = toViewerTalks(
      {
        event: {
          ...event({ ...community, name: '<b>pm</b>' }),
          name: '<script>x</script>',
        },
        sameEvent: talks('e', 4),
        otherEvents: talks('o', 1),
      },
      noCitations,
      null,
    )
    const drawn =
      flat(await viewerSameEventFrame(view, 'ja')) +
      flat(await viewerSameCommunityFrame(view, 'ja'))
    expect(drawn).not.toContain('<script>')
    expect(drawn).not.toContain('<b>')
  })

  test('F24-AC46: Given cards on the citations, When the sections are made, Then those slides are not among them', () => {
    const view = toViewerTalks(
      read(talks('e', 1), talks('o', 1)),
      {
        cites: {
          shown: [
            {
              name: 'o0',
              href: '/@owner/o0',
              handle: 'owner',
              authorHref: '/@owner',
              publishedAt: 1,
              coverUrl: null,
              citedBy: 0,
            },
          ],
          more: 0,
        },
        citedBy: { shown: [], more: 0 },
      },
      new URL('https://content.example'),
    )
    expect(view.sameCommunity.map((card) => card.href)).toEqual(['/@owner/e0'])
    expect(view.sameCommunity[0]?.coverUrl).toBe('/covers/d-e0.jpg')
  })
})
