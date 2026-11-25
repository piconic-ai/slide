import { expect, test } from 'vitest'
import { readEditForm } from './edit-form'

test('F30-AC25: Given a good editing form, When it is read, Then the name, description, color, other links and links are valid', () => {
  expect(
    readEditForm({
      name: 'Kanagawa.pm',
      description: 'Perl',
      color: 'red',
      site: ['https://kanagawa.pm/', '', ''],
      link: 'https://kanagawapm.connpass.com/',
    }),
  ).toMatchObject({
    kind: 'valid',
    sites: ['https://kanagawa.pm/'],
    links: [{ url: 'https://kanagawapm.connpass.com/' }],
  })
})

test('F30-AC25: Given a bad other link between empty ones, When it is read, Then the problem stays on its own field and three fields show', () => {
  const read = readEditForm({
    name: 'K',
    site: ['', 'nope', ''],
    link: 'https://k.connpass.com/',
  })
  expect(read.kind).toBe('refused')
  expect(read.form.sites).toEqual([
    { value: '', problem: null },
    { value: 'nope', problem: 'invalid' },
    { value: '', problem: null },
  ])
})

test('F30-AC39: Given "remove" on the editing form, When it is read, Then the row goes and nothing is checked', () => {
  const read = readEditForm({
    name: '',
    link: ['https://a.connpass.com/', 'https://b.connpass.com/'],
    remove: '1',
  })
  expect(read.kind).toBe('edited')
  expect(read.form.links).toEqual([
    { value: 'https://a.connpass.com/', problem: null },
  ])
  expect(read.form.sites).toHaveLength(3)
})

test.each(['red', 'orange', 'yellow', 'green', 'navy'] as const)(
  'F30-AC44: Given %s chosen on a good editing form, When it is read, Then the color is valid',
  (color) => {
    expect(
      readEditForm({ name: 'K', color, link: 'https://k.connpass.com/' }),
    ).toMatchObject({ kind: 'valid', color, form: { color } })
  },
)

test.each([
  ['a color not among the five', 'purple'],
  ['an empty color', ''],
  ['a color in capitals', 'Red'],
  ['two colors', ['red', 'navy']],
  ['no color', undefined],
])(
  'F30-AC44: Given %s, When the editing form is read, Then it is refused with the color problem alone and none is chosen',
  (_name, color) => {
    const read = readEditForm({
      name: 'K',
      link: 'https://k.connpass.com/',
      ...(color === undefined ? {} : { color }),
    })
    expect(read.kind).toBe('refused')
    expect(read.form.color).toBeNull()
    expect(read.form.problems).toEqual({
      name: null,
      description: null,
      color: 'invalid',
      links: null,
    })
  },
)

test('F30-AC44: Given a row removed after navy was chosen, When the form is read, Then navy stays chosen and nothing is checked', () => {
  const read = readEditForm({
    name: '',
    color: 'navy',
    link: ['https://a.connpass.com/', 'https://b.connpass.com/'],
    remove: '1',
  })
  expect(read.kind).toBe('edited')
  expect(read.form.color).toBe('navy')
  expect(read.form.problems.color).toBeNull()
})
