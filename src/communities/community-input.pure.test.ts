import { describe, expect, test } from 'vitest'
import {
  parseDescription,
  parseName,
  parseSites,
  storedSites,
} from './community-input'

describe('F30-AC37: the name and the description', () => {
  test.each([
    ['Kanagawa.pm', { ok: true, value: 'Kanagawa.pm' }],
    ['  Kanagawa.pm  ', { ok: true, value: 'Kanagawa.pm' }],
    ['あ'.repeat(50), { ok: true, value: 'あ'.repeat(50) }],
    ['👨‍👩‍👧'.repeat(7), { ok: true, value: '👨‍👩‍👧'.repeat(7) }],
    ['<b>x</b>', { ok: true, value: '<b>x</b>' }],
    ['Kana​gawa', { ok: true, value: 'Kanagawa' }],
    ['', { ok: false, reason: 'empty' }],
    [' ​ ', { ok: false, reason: 'empty' }],
    ['あ'.repeat(51), { ok: false, reason: 'too_long' }],
    [42, { ok: false, reason: 'empty' }],
  ])('Given the name %j, When it is read, Then %j', (input, expected) => {
    expect(parseName(input)).toEqual(expected)
  })

  test.each([
    ['', { ok: true, value: '' }],
    ['a\r\nb\rc', { ok: true, value: 'a\nb\nc' }],
    [
      'https://example.com/ <script>',
      { ok: true, value: 'https://example.com/ <script>' },
    ],
    ['あ'.repeat(160), { ok: true, value: 'あ'.repeat(160) }],
    ['あ'.repeat(161), { ok: false, reason: 'too_long' }],
    [undefined, { ok: true, value: '' }],
  ])(
    'Given the description %j, When it is read, Then %j',
    (input, expected) => {
      expect(parseDescription(input)).toEqual(expected)
    },
  )
})

describe('F30-AC25: the other links', () => {
  test('Given up to three addresses and empty fields, When they are read, Then they are kept in https', () => {
    expect(
      parseSites(['http://kanagawa.pm/', '', 'https://x.com/kanagawapm']),
    ).toEqual({
      ok: true,
      sites: ['https://kanagawa.pm/', 'https://x.com/kanagawapm'],
    })
  })

  test('Given four addresses or one that is not an address, When they are read, Then the fields say which', () => {
    const four = [
      'https://a.example/',
      'https://b.example/',
      'https://c.example/',
      'https://d.example/',
    ]
    expect(parseSites(four)).toMatchObject({
      ok: false,
      fields: [
        { problem: null },
        { problem: null },
        { problem: null },
        { problem: 'too_many' },
      ],
    })
    expect(parseSites(['javascript:alert(1)'])).toEqual({
      ok: false,
      fields: [{ value: 'javascript:alert(1)', problem: 'invalid' }],
    })
  })

  test('Given stored sites that are not a list of addresses, When they are read, Then they read as none', () => {
    expect(storedSites('nope')).toEqual([])
    expect(storedSites('{"a":1}')).toEqual([])
    expect(storedSites('["https://kanagawa.pm/", 3, "javascript:x"]')).toEqual([
      'https://kanagawa.pm/',
    ])
  })
})
