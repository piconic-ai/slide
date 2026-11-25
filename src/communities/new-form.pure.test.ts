import { expect, test } from 'vitest'
import type { Handle } from '../share/handle'
import {
  editActionOf,
  markTaken,
  readNewCommunityForm,
  valuesOf,
} from './new-form'

test('Given a body with one or many links, When they are read, Then every text value comes in order', () => {
  expect(valuesOf({ link: 'a' }, 'link')).toEqual(['a'])
  expect(valuesOf({ link: ['a', 'b'] }, 'link')).toEqual(['a', 'b'])
  expect(valuesOf({}, 'link')).toEqual([])
})

test.each([
  [{}, null],
  [{ remove: '2' }, { remove: 2, add: false }],
  [{ remove: 'x' }, null],
  [{ remove: '999' }, null],
  [{ add: 'link' }, { remove: null, add: true }],
])(
  'F30-AC39: Given the buttons %j, When the action is read, Then it is %j',
  (body, action) => {
    expect(editActionOf(body)).toEqual(action)
  },
)

test('F30-AC9: Given a good form, When it is read, Then the handle, the name and the links are valid', () => {
  const read = readNewCommunityForm({
    handle: 'kanagawapm',
    name: ' Kanagawa.pm ',
    link: ['https://kanagawapm.connpass.com', ''],
  })
  expect(read).toMatchObject({
    kind: 'valid',
    handle: 'kanagawapm',
    name: 'Kanagawa.pm',
    links: [{ url: 'https://kanagawapm.connpass.com/' }],
  })
})

test('F30-AC3: Given a reserved handle and an upper-case one, When the form is read, Then the handle is refused with its reason', () => {
  expect(
    readNewCommunityForm({
      handle: 'communities',
      name: 'x',
      link: 'https://a.connpass.com/',
    }).form.problems.handle,
  ).toBe('reserved')
  expect(
    readNewCommunityForm({
      handle: 'Kanagawa',
      name: 'x',
      link: 'https://a.connpass.com/',
    }).form.problems.handle,
  ).toBe('invalid_characters')
})

test('F30-AC13: Given an owner of one typed link, When the fields are marked, Then only that field names the community, whatever its spelling', () => {
  const fields = markTaken(
    [
      { value: 'http://HONO.connpass.com', problem: null },
      { value: 'https://kanagawa.pm/', problem: null },
    ],
    new Map([['https://hono.connpass.com/', 'hono' as Handle]]),
  )
  expect(fields).toEqual([
    {
      value: 'http://HONO.connpass.com',
      problem: { kind: 'taken', handle: 'hono' },
    },
    { value: 'https://kanagawa.pm/', problem: null },
  ])
})
