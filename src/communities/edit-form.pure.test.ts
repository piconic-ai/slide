import { expect, test } from 'vitest'
import { readEditForm } from './edit-form'

test('F30-AC25: Given a good editing form, When it is read, Then the name, description, other links and links are valid', () => {
  expect(
    readEditForm({
      name: 'Kanagawa.pm',
      description: 'Perl',
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
