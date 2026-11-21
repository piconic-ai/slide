import { expect, test } from 'vitest'
import { handleSchema } from '../share/handle'
import { citedStat, citedTab, citingStat, citingTab } from './citation-frames'
import { profileTabs } from './pages'
import { profileStatsFrame } from './stats-frame'
import { articleFrame } from '../decks/article-frame'
import { viewerArticleFrame } from '../share/viewer-article-frame'
import { viewerLinksFrame } from '../share/viewer-links-frame'

const handle = handleSchema.parse('kfly8')
const counts = { slides: 6, following: 12, followers: 34 } as const

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

test('Given the citation frames are not filled, When the head and tabs are rendered, Then they hold only what they held before', () => {
  expect([citingStat(), citedStat(), citingTab(), citedTab()]).toEqual([
    '',
    '',
    '',
    '',
  ])
  const tabs = String(profileTabs(handle, counts, 'slides', 'en'))
  expect(tabs.match(/<a\b/g)).toHaveLength(3)
})

test('Given the frames of the other works are not filled, When they are rendered, Then each holds nothing at all', () => {
  expect([viewerLinksFrame(), viewerArticleFrame(), articleFrame()]).toEqual([
    '',
    '',
    '',
  ])
})
