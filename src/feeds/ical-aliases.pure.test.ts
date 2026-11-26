import { expect, test } from 'vitest'
import { lumaEventAliases, lumaEventKeys } from './ical'

const calendar = (...events: string[]) =>
  [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Luma//piconic//EN',
    ...events.flatMap((lines) => ['BEGIN:VEVENT', lines, 'END:VEVENT']),
    'END:VCALENDAR',
    '',
  ].join('\r\n')

// An event as Luma's feed writes it (2026-11-26): its name address in the
// DESCRIPTION, its id address in the LOCATION and its id in the UID.
const LUMA_EVENT = [
  'UID:evt-nPHM1FY0GGaiJyh@events.lu.ma',
  'SUMMARY:Test event',
  'DESCRIPTION:Get up-to-date information at: https://luma.com/e03n9o8s\\n\\nAd',
  ' dress:\\nCheck event page for more details.',
  'LOCATION:https://luma.com/event/evt-nPHM1FY0GGaiJyh',
].join('\r\n')

test('F33-AC20: Given an event as Luma writes it, When the feed is read, Then its id stands for its name, which alone lists it', () => {
  const feed = calendar(LUMA_EVENT)
  expect(lumaEventAliases(feed)).toEqual([
    {
      aliasKey: 'https://luma.com/event/evt-nPHM1FY0GGaiJyh',
      eventKey: 'https://luma.com/e03n9o8s',
    },
  ])
  // The id stands for the name; only the name lists the event.
  expect(lumaEventKeys(feed)).toEqual(['https://luma.com/e03n9o8s'])
})

test('F33-AC20: Given an event with its id only in the UID, When the feed is read, Then the id still stands for its name', () => {
  const feed = calendar(
    'UID:evt-abc123@events.lu.ma\r\nURL:https://lu.ma/kpm-one',
  )
  expect(lumaEventAliases(feed)).toEqual([
    {
      aliasKey: 'https://luma.com/event/evt-abc123',
      eventKey: 'https://luma.com/kpm-one',
    },
  ])
})

test.each([
  ['no name address', 'LOCATION:https://luma.com/event/evt-abc123'],
  [
    'two name addresses',
    'UID:evt-abc123@events.lu.ma\r\nURL:https://lu.ma/one\r\nDESCRIPTION:see https://lu.ma/two',
  ],
  ['no id at all', 'URL:https://lu.ma/kpm-one'],
  [
    'a UID of another site',
    'UID:evt-abc123@example.com\r\nURL:https://lu.ma/one',
  ],
])(
  'F33-AC20: Given an event with %s, When the feed is read, Then no id is paired',
  (_, lines) => {
    expect(lumaEventAliases(calendar(lines))).toEqual([])
  },
)

test('F33-AC20: Given two events, When the feed is read, Then each id is paired with the name of its own event', () => {
  const feed = calendar(
    'UID:evt-one@events.lu.ma\r\nURL:https://lu.ma/first',
    'UID:evt-two@events.lu.ma\r\nURL:https://lu.ma/second',
  )
  expect(lumaEventAliases(feed)).toEqual([
    {
      aliasKey: 'https://luma.com/event/evt-one',
      eventKey: 'https://luma.com/first',
    },
    {
      aliasKey: 'https://luma.com/event/evt-two',
      eventKey: 'https://luma.com/second',
    },
  ])
})

test('F33-AC12: Given an event as Luma writes it, When its pairs are read, Then nothing but the keys comes out', () => {
  expect(JSON.stringify(lumaEventAliases(calendar(LUMA_EVENT)))).not.toMatch(
    /Test event|details/u,
  )
})

test('F33-AC20: Given an event with its id address alone, When the feed is read, Then the id lists it', () => {
  expect(
    lumaEventKeys(calendar('LOCATION:https://luma.com/event/evt-abc123')),
  ).toEqual(['https://luma.com/event/evt-abc123'])
})
