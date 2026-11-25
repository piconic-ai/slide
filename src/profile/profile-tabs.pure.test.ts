import { expect, test } from 'vitest'
import { handleSchema } from '../share/handle'
import { profileBody, type ProfileView } from '../share/list-pages'
import { profileTabs, type ProfileTab } from './pages'
import { communitiesListFrame } from './community-frames'
import { viewerLinksFrame } from '../share/viewer-links-frame'

const handle = handleSchema.parse('kfly8')
const counts = {
  slides: 6,
  communities: 3,
  following: 12,
  followers: 34,
  citing: 5,
  cited: 7,
} as const

const flat = (value: unknown) =>
  String(value).replace(/\s+/g, ' ').replace(/ >/g, '>')

const slidesView: ProfileView = {
  kind: 'slides',
  decks: [],
  contentBase: null,
  citedBy: new Map(),
}

/** The tabs a page shows: where each goes, its name and its count. */
const tabsOf = (page: string) =>
  [
    ...flat(page).matchAll(
      /<a href="([^"]+)"[^>]*>([^<]+?) <span class="count">(\d+)/g,
    ),
  ].map((match) => [match[1], match[2], match[3]])

test.each(['ja', 'en'] as const)(
  'F21-AC62: Given a profile with follows and citations, When it is rendered in %s, Then its head shows no numbers and each count stands only beside its tab',
  (lang) => {
    const page = flat(
      profileBody(
        { handle, profile: null, counts },
        slidesView,
        'signed-out',
        lang,
      ),
    )
    const head = page.slice(0, page.indexOf('<nav class="profile-tabs"'))
    expect(head).not.toMatch(/profile-stat|stat-count/)
    for (const count of Object.values(counts))
      expect(head).not.toContain(`>${count}<`)
    expect(tabsOf(page).map(([, , count]) => count)).toEqual([
      '6',
      '3',
      '12',
      '34',
      '5',
      '7',
    ])
  },
)

test.each([
  [
    'ja',
    [
      ['/@kfly8', 'スライド', '6'],
      ['/@kfly8/communities', 'コミュニティ', '3'],
      ['/@kfly8/following', 'フォロー中', '12'],
      ['/@kfly8/followers', 'フォロワー', '34'],
      ['/@kfly8/citing', '引用した', '5'],
      ['/@kfly8/cited', '引用された', '7'],
    ],
  ],
  [
    'en',
    [
      ['/@kfly8', 'Slides', '6'],
      ['/@kfly8/communities', 'Communities', '3'],
      ['/@kfly8/following', 'Following', '12'],
      ['/@kfly8/followers', 'Followers', '34'],
      ['/@kfly8/citing', 'Citing', '5'],
      ['/@kfly8/cited', 'Cited', '7'],
    ],
  ],
] as const)(
  'F21-AC63: Given a profile, When its tabs are rendered in %s, Then they run slides, communities, following, followers, citing, cited, each with its count and its list',
  (lang, expected) => {
    expect(tabsOf(String(profileTabs(handle, counts, 'slides', lang)))).toEqual(
      expected,
    )
  },
)

test('F21-AC63: Given a profile with nothing at all, When its tabs are rendered, Then every tab is still there with 0', () => {
  const none = {
    slides: 0,
    communities: 0,
    following: 0,
    followers: 0,
    citing: 0,
    cited: 0,
  }
  const found = tabsOf(String(profileTabs(handle, none, 'slides', 'ja')))
  expect(found).toHaveLength(6)
  expect(found.every(([, , count]) => count === '0')).toBe(true)
})

test.each([
  ['slides', '/@kfly8'],
  ['communities', '/@kfly8/communities'],
  ['following', '/@kfly8/following'],
  ['followers', '/@kfly8/followers'],
  ['citing', '/@kfly8/citing'],
  ['cited', '/@kfly8/cited'],
] as const satisfies readonly (readonly [ProfileTab, string])[])(
  'F21-AC63: Given the %s part is open, When the tabs are rendered, Then only its tab is the current page',
  (open, href) => {
    const tabs = flat(profileTabs(handle, counts, open, 'en'))
    expect(tabs.match(/aria-current="page"/g)).toHaveLength(1)
    expect(tabs).toContain(`href="${href}" aria-current="page"`)
  },
)

test('F21-AC65: Given the list of communities is open, When the profile is rendered, Then its tab is current and the list frame holds nothing yet', () => {
  const page = flat(
    profileBody(
      { handle, profile: null, counts },
      { kind: 'communities' },
      'signed-out',
      'ja',
    ),
  )
  expect(page).toContain('href="/@kfly8/communities" aria-current="page"')
  expect(page.trimEnd()).toMatch(/<\/nav>$/)
})

test('Given the frames of the other works are not filled, When they are rendered, Then each holds nothing at all', () => {
  expect([
    viewerLinksFrame([], 'ja'),
    communitiesListFrame(handle, 'ja'),
  ]).toEqual(['', ''])
})
