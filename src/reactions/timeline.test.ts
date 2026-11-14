import { expect, test } from 'vitest'
import type { StoredPost } from './store'
import { timelineOf } from './timeline'

const post = (
  id: string,
  postedAt: number | null,
  addedAt = 1000,
): StoredPost => ({
  id,
  page: 0,
  post: { service: 'x', id: '1830000000000000000' },
  source: 'pasted',
  postedAt,
  addedAt,
})

test('Given posts, When put on a timeline, Then the newest comes first', () => {
  const timeline = timelineOf([
    post('old', 100),
    post('new', 300),
    post('mid', 200),
  ])

  expect(timeline.map((item) => item.id)).toEqual(['new', 'mid', 'old'])
})

test('Given a post whose own time is unknown, When put on a timeline, Then it counts from when it was added', () => {
  const timeline = timelineOf([
    post('known', 100, 900),
    post('unknown', null, 500),
  ])

  expect(timeline.map((item) => [item.id, item.at])).toEqual([
    ['unknown', 500],
    ['known', 100],
  ])
})

test('Given posts at the same time, When put on a timeline, Then they keep the order they came in', () => {
  expect(
    timelineOf([post('a', 100), post('b', 100)]).map((item) => item.id),
  ).toEqual(['a', 'b'])
})

test('Given no posts, When put on a timeline, Then it is empty', () => {
  expect(timelineOf([])).toEqual([])
})

test('Given a post that claims a time after it was added, When put on a timeline, Then it counts from when it was added', () => {
  const timeline = timelineOf([
    post('honest', 800, 900),
    post('ahead', 4000000000, 500),
  ])

  expect(timeline.map((item) => [item.id, item.at])).toEqual([
    ['honest', 800],
    ['ahead', 500],
  ])
})
