import { expect, test } from 'vitest'
import { isoOf, timeTag } from './operator-time'

test('Given a moment in seconds, When it is shown, Then it is ISO 8601 in UTC, as a time element', () => {
  expect(isoOf(0)).toBe('1970-01-01T00:00:00.000Z')
  expect(String(timeTag(1_795_000_000))).toBe(
    '<time datetime="2026-11-18T11:06:40.000Z">2026-11-18T11:06:40.000Z</time>',
  )
})

test('Given no moment, When it is shown, Then it reads as the words given, or "まだありません"', () => {
  expect(String(timeTag(null))).toBe('まだありません')
  expect(String(timeTag(null, '-'))).toBe('-')
})
