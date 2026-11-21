import { expect, test } from 'vitest'
import { peopleListBody } from '../follows/people-pages'
import type { Handle } from '../share/handle'
import { viewerAuthor } from '../share/viewer-author'
import type { Owner } from '../auth/owner-session'
import { sessionView } from '../site/session-view'

// Pictures are served by the service itself (F28-AC41 builds them).
const AVATAR = '/faces/722500'
const owner = { login: 'kfly8' } as Owner

test('F21-AC39: Given a saved picture, When the header session is drawn, Then it carries the picture, and null without one', () => {
  expect(sessionView(owner, 'kfly8', AVATAR)).toMatchObject({
    avatarUrl: AVATAR,
  })
  expect(sessionView(owner, 'kfly8', null)).toMatchObject({ avatarUrl: null })
})

const view = (avatarUrl: string | null) => ({
  handle: 'kfly8',
  name: 'Kenta Demo',
  avatarUrl,
  slide: '/@kfly8/talk',
  controls: 'none' as const,
})

test('F21-AC40: Given a saved picture, When the viewer shows the author, Then an image is drawn over the initial', () => {
  const page = String(viewerAuthor(view(AVATAR), 'ja'))
  expect(page).toContain(`<img`)
  expect(page).toContain(`src="${AVATAR}"`)
})

test('F21-AC40: Given no picture, When the viewer shows the author, Then the initial shows and no image is drawn', () => {
  const page = String(viewerAuthor(view(null), 'ja'))
  expect(page).not.toContain('<img')
  expect(page).toContain('>k</span')
})

const person = (avatarUrl: string | null) => ({
  userId: '2',
  handle: 'rina' as Handle,
  name: 'Rina Reader',
  avatarUrl,
  followedByViewer: false,
})
const list = (avatarUrl: string | null) =>
  String(
    peopleListBody(
      {
        handle: 'kfly8' as Handle,
        list: 'following',
        people: [person(avatarUrl)],
        page: 1,
        total: 1,
        reader: { kind: 'stopped' },
      },
      'ja',
    ),
  )

test('F21-AC41: Given a saved picture, When a list row is drawn, Then the image is there', () => {
  const page = list(AVATAR)
  expect(page).toContain('<img')
  expect(page).toContain(`src="${AVATAR}"`)
})

test('F21-AC41: Given no picture, When a list row is drawn, Then the initial of the name shows and no image', () => {
  const page = list(null)
  expect(page).not.toContain('<img')
  expect(page).toContain('>R<')
})
