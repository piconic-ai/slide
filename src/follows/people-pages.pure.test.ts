import { expect, test } from 'vitest'
import { handleSchema } from '../share/handle'
import { japaneseOutside } from '../site/test-japanese'
import { peopleListBody } from './people-pages'
import type { PeopleReader } from './people'
import type { Person } from './store'

const alice = handleSchema.parse('alice')
const person = (handle: string, rest: Partial<Person> = {}): Person => ({
  userId: handle,
  handle: handleSchema.parse(handle),
  name: null,
  avatarUrl: null,
  followedByViewer: false,
  ...rest,
})
const draw = (
  people: Person[],
  total = people.length,
  page = 1,
  reader: PeopleReader = { kind: 'stopped' },
) =>
  String(
    peopleListBody(
      { handle: alice, list: 'following', people, page, total, reader },
      'ja',
    ),
  )

test('F21-AC8: Given a person with a name and a picture, When their row is drawn, Then the name is the link to their profile, over the picture and the handle', () => {
  const row = draw([
    person('bob', {
      name: 'Bob <script>alert(1)</script> & co',
      avatarUrl: '/avatars/2',
    }),
  ])
  expect(row).toContain(
    '<a class="person-name" href="/@bob"\n        >Bob &lt;script&gt;alert(1)&lt;/script&gt; &amp; co</a',
  )
  expect(row).not.toContain('<script>')
  expect(row).toContain('<span class="person-handle">@bob</span>')
  // The picture hides itself when it cannot be read, and the letter shows.
  expect(row).toMatch(
    /<span class="person-face" aria-hidden="true"\s*>B<img\s+data-cover\s+src="\/avatars\/2"/,
  )
  expect(row).toContain('referrerpolicy="no-referrer"')
})

test('F21-AC8: Given a person without a name or a picture, When their row is drawn, Then the handle names them once and its first letter stands for the picture', () => {
  const row = draw([person('carol')])
  expect(row).toMatch(/<a class="person-name" href="\/@carol"\s*>@carol<\/a/)
  expect(row).toMatch(/class="person-face" aria-hidden="true"\s*>C<\/span/)
  expect(row).not.toContain('<img')
  expect(row).not.toContain('person-handle')
})

test('F21-AC19: Given a list that fits one page, When it is drawn, Then there is no way to other pages', () => {
  expect(draw([person('bob')])).not.toContain('people-pages')
})

test('F21-AC19: Given the middle page of a long list, When it is drawn, Then it leads both ways', () => {
  const page = draw([person('bob')], 150, 2)
  expect(page).toContain('rel="prev" href="/@alice/following"')
  expect(page).toContain('rel="next" href="/@alice/following?page=3"')
})

test.each(['following', 'followers'] as const)(
  'F21-AC8: Given an empty %s list in English, When it is drawn, Then no Japanese is left in it',
  (list) => {
    const page = String(
      peopleListBody(
        {
          handle: alice,
          list,
          people: [],
          page: 1,
          total: 0,
          reader: { kind: 'stopped' },
        },
        'en',
      ),
    )
    expect(page).toContain('class="people-none"')
    expect(japaneseOutside(page)).toEqual([])
  },
)

test('F21-AC12: Given a reader who follows one person in the list and not another, When the rows are drawn, Then each has the button for the other state, and the reader’s own row has none', () => {
  const page = draw(
    [
      person('bob', { followedByViewer: true }),
      person('carol'),
      person('dave'),
    ],
    3,
    2,
    { kind: 'member', userId: 'dave' },
  )
  const forms = [...page.matchAll(/<form[\s\S]*?<\/form>/g)].map(
    ([form]) => form,
  )
  expect(forms).toHaveLength(2)
  expect(forms[0]).toContain('action="/follows/bob/release"')
  expect(forms[0]).toContain('aria-label="@bob さんのフォローを解除する"')
  expect(forms[1]).toContain('action="/follows"')
  expect(forms[1]).toContain('name="handle" value="carol"')
  expect(forms[1]).toContain('aria-label="@carol さんをフォローする"')
  // Both return to the list, at its first page.
  for (const form of forms)
    expect(form).toContain('name="slide" value="/@alice/following"')
})

test('F21-AC12: Given a stopped reader reads the list, When the rows are drawn, Then no row has a button', () => {
  expect(draw([person('bob', { followedByViewer: true })])).not.toContain(
    '<form',
  )
})

test('F21-AC43: Given a reader who is not signed in, When the rows are drawn, Then each has a named follow link that opens the prompt, and no form that posts', () => {
  const page = draw(
    [person('bob', { followedByViewer: true }), person('carol')],
    2,
    1,
    { kind: 'signed-out' },
  )
  expect(page).not.toContain('<form')
  const links = [...page.matchAll(/<a\s[^>]*data-login-prompt[^>]*>/g)].map(
    ([link]) => link,
  )
  expect(links).toHaveLength(2)
  expect(links[1]).toContain('data-login-prompt="follow"')
  expect(links[1]).toContain('aria-haspopup="dialog"')
  expect(links[1]).toContain('aria-label="@carol さんをフォローする"')
  expect(links[1]).toContain(
    'href="/follows/new?handle=carol&amp;slide=%2F%40alice%2Ffollowing"',
  )
})
