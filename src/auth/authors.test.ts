import { expect, test } from 'vitest'
import { isAuthor, parseAuthors } from './authors'

test.each([
  ['one ID', '722500', ['722500']],
  ['several IDs', '722500,1234,9', ['722500', '1234', '9']],
])(
  'Given a setting of %s, When parsed, Then exactly those people are authors',
  (_name, value, ids) => {
    expect([...parseAuthors(value)]).toEqual(ids)
  },
)

test.each([
  ['nothing', undefined],
  ['a number', 722500],
  ['an empty string', ''],
  ['only a comma', ','],
  ['a trailing comma', '722500,'],
  ['a leading comma', ',722500'],
  ['an empty entry', '722500,,1234'],
  ['a space after the comma', '722500, 1234'],
  ['a login name', '722500,octocat'],
  ['a negative number', '-1'],
  ['a leading zero', '0722500'],
  ['zero', '0'],
  ['a decimal', '722500.0'],
  ['a wildcard', '*'],
  ['the same ID twice', '722500,1234,722500'],
  ['a line break', '722500\n1234'],
])(
  'Given a setting of %s, When parsed, Then nobody is an author',
  (_name, value) => {
    const authors = parseAuthors(value)
    expect(authors.size).toBe(0)
    expect(isAuthor(authors, '722500')).toBe(false)
  },
)

test('Given the registered authors, When a person is checked, Then only an exact ID passes', () => {
  const authors = parseAuthors('722500,1234')
  expect(isAuthor(authors, '722500')).toBe(true)
  expect(isAuthor(authors, '1234')).toBe(true)
  expect(isAuthor(authors, '72250')).toBe(false)
  expect(isAuthor(authors, '7225000')).toBe(false)
  expect(isAuthor(authors, '722500,1234')).toBe(false)
  expect(isAuthor(authors, '')).toBe(false)
})
