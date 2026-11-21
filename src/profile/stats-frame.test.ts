import { expect, test } from 'vitest'
import { handleSchema } from '../share/handle'
import { profileTabs } from './pages'
import { profileStatsFrame } from './stats-frame'
import { settingsAccountFrame } from '../site/settings-account-frame'
import { settingsProfileFrame } from '../site/settings-profile-frame'
import { viewerLinksFrame } from '../share/viewer-links-frame'

const handle = handleSchema.parse('kfly8')
const counts = {
  slides: 6,
  following: 12,
  followers: 34,
  citing: 5,
  cited: 12,
} as const

const flat = (value: unknown) =>
  String(value).replace(/\s+/g, ' ').replace(/ >/g, '>')

test('Given a profile, When its head is rendered, Then following and followers come first as links to their lists with their counts', () => {
  const head = String(profileStatsFrame(handle, counts, 'ja'))
    .replace(/\s+/g, ' ')
    .replace(/ >/g, '>')
  const following = head.indexOf('/@kfly8/following')
  const followers = head.indexOf('/@kfly8/followers')
  expect(following).toBeGreaterThan(-1)
  expect(followers).toBeGreaterThan(following)
  expect(head).toContain('>12</span><span class="stat-label">フォロー中')
  expect(head).toContain('>34</span><span class="stat-label">フォロワー')
})

test('F21-AC54: Given a profile, When its head is rendered, Then following, followers, citing and cited stand in this order with their counts', () => {
  const head = flat(profileStatsFrame(handle, counts, 'ja'))
  const labels = ['フォロー中', 'フォロワー', '引用した', '引用された']
  const at = labels.map((label) => head.indexOf(`>${label}</span>`))
  expect(at.every((index) => index > -1)).toBe(true)
  expect([...at].sort((a, b) => a - b)).toEqual(at)
  expect(head).toContain('>5</span><span class="stat-label">引用した')
  expect(head).toContain('>12</span><span class="stat-label">引用された')
})

test.each([
  ['ja', '引用した', '引用された'],
  ['en', 'Citing', 'Cited'],
] as const)(
  'F21-AC54: Given a profile with no citation, When its head is rendered in %s, Then both numbers show as 0',
  (lang, citing, cited) => {
    const head = flat(
      profileStatsFrame(handle, { ...counts, citing: 0, cited: 0 }, lang),
    )
    expect(head).toContain(`>0</span><span class="stat-label">${citing}`)
    expect(head).toContain(`>0</span><span class="stat-label">${cited}`)
  },
)

test('F21-AC55: Given a profile, When its head is rendered, Then each number links to its list', () => {
  const head = flat(profileStatsFrame(handle, counts, 'en'))
  const hrefs = [...head.matchAll(/href="([^"]+)"/g)].map((match) => match[1])
  expect(hrefs).toEqual([
    '/@kfly8/following',
    '/@kfly8/followers',
    '/@kfly8/citing',
    '/@kfly8/cited',
  ])
})

test('F21-AC56: Given a profile, When its tabs are rendered, Then they run slides, following, followers, citing, cited, each with its count', () => {
  const tabs = flat(profileTabs(handle, counts, 'slides', 'ja'))
  const found = [
    ...tabs.matchAll(/<a href="([^"]+)"[^>]*>(.+?) <span class="count">(\d+)/g),
  ].map((match) => [match[1], match[2], match[3]])
  expect(found).toEqual([
    ['/@kfly8', 'スライド', '6'],
    ['/@kfly8/following', 'フォロー中', '12'],
    ['/@kfly8/followers', 'フォロワー', '34'],
    ['/@kfly8/citing', '引用した', '5'],
    ['/@kfly8/cited', '引用された', '12'],
  ])
})

test.each(['citing', 'cited'] as const)(
  'F21-AC56: Given the %s list is open, When the tabs are rendered, Then only its tab is the current page',
  (open) => {
    const tabs = flat(profileTabs(handle, counts, open, 'en'))
    expect(tabs.match(/aria-current="page"/g)).toHaveLength(1)
    expect(tabs).toMatch(
      new RegExp(`href="/@kfly8/${open}" aria-current="page"`),
    )
  },
)

test('Given the new frames are not filled, When they are rendered, Then each holds nothing at all', () => {
  expect([
    viewerLinksFrame([], 'ja'),
    settingsProfileFrame(),
    settingsAccountFrame(),
  ]).toEqual(['', '', ''])
})
