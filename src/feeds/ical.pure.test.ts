import { describe, expect, test } from 'vitest'
import { isCalendar, lumaEventKeys } from './ical'

const calendar = (...events: string[]) =>
  [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Luma//EN',
    'URL:https://lu.ma/calendar-page',
    ...events.flatMap((lines) => ['BEGIN:VEVENT', lines, 'END:VEVENT']),
    'END:VCALENDAR',
    '',
  ].join('\r\n')

describe('reading a feed', () => {
  test('F33-AC16: Given events with the address on the URL line and in the DESCRIPTION, When the feed is read, Then both are read as keys', () => {
    const feed = calendar(
      'SUMMARY:Kanagawa.pm #1\r\nDTSTART:20261201T100000Z\r\nURL:https://lu.ma/kpm-one',
      'SUMMARY:Kanagawa.pm #2\r\nDESCRIPTION:Get up-to-date information at: https://luma.com/kpm-two\\n\\nSee you!',
    )
    expect(lumaEventKeys(feed)).toEqual([
      'https://luma.com/kpm-one',
      'https://luma.com/kpm-two',
    ])
  })

  test('F33-AC12: Given an event with a name, a time and a place, When the feed is read, Then only the key comes out', () => {
    const keys = lumaEventKeys(
      calendar(
        'SUMMARY:Secret meetup\r\nDTSTART:20261201T100000Z\r\nLOCATION:Yokohama\r\nURL:https://lu.ma/abc',
      ),
    )
    expect(keys).toEqual(['https://luma.com/abc'])
    expect(JSON.stringify(keys)).not.toMatch(/Secret|Yokohama|2026/u)
  })

  test('F33-AC16: Given a folded line and an escaped DESCRIPTION, When the feed is read, Then the address is joined and read', () => {
    const feed = calendar(
      'DESCRIPTION:Details: https://lu.ma/fol\r\n ded-event\\, then more\;',
      'URL;VALUE=URI:https://lu.ma/with-\r\n\tparam',
    )
    expect(lumaEventKeys(feed)).toEqual([
      'https://luma.com/folded-event',
      'https://luma.com/with-param',
    ])
  })

  test('F33-AC16: Given LF line ends, a byte order mark and lower case names, When the feed is read, Then the events are read', () => {
    const feed =
      '\uFEFFBEGIN:VCALENDAR\nbegin:vevent\nurl:https://LU.MA/Case-Kept?utm=x#y\nend:vevent\nEND:VCALENDAR\n'
    expect(isCalendar(feed)).toBe(true)
    expect(lumaEventKeys(feed)).toEqual(['https://luma.com/Case-Kept'])
  })

  test('Given one event under both addresses and twice in the feed, When it is read, Then its key comes once', () => {
    const feed = calendar(
      'URL:https://lu.ma/same\r\nDESCRIPTION:https://luma.com/same/ and https://www.lu.ma/same.',
      'URL:https://luma.com/same?x=1',
    )
    expect(lumaEventKeys(feed)).toEqual(['https://luma.com/same'])
  })

  test.each([
    ['another site', 'URL:https://connpass.com/event/1/'],
    [
      'a Luma page that is no event',
      'URL:https://lu.ma/calendar\r\nDESCRIPTION:https://luma.com/discover https://lu.ma/u/someone',
    ],
    [
      'a calendar feed',
      'URL:https://api.luma.com/ics/get?entity=calendar&id=cal-x',
    ],
    [
      'a look-alike host',
      'DESCRIPTION:https://lu.ma.evil.example/abc https://evilluma.com/abc',
    ],
    ['a script', 'DESCRIPTION:<script>alert(1)</script> javascript:alert(1)'],
    ['nothing', 'SUMMARY:No link'],
  ])(
    'Given an event with %s, When the feed is read, Then no key comes out',
    (_, lines) => {
      expect(lumaEventKeys(calendar(lines))).toEqual([])
    },
  )

  test('Given an address outside any event, When the feed is read, Then it is left out', () => {
    expect(
      lumaEventKeys(
        'BEGIN:VCALENDAR\r\nURL:https://lu.ma/outside\r\nEND:VCALENDAR',
      ),
    ).toEqual([])
  })

  test('Given a quoted parameter holding a colon, When the URL line is read, Then the value starts after it', () => {
    expect(
      lumaEventKeys(calendar('URL;X-NOTE="a:b":https://lu.ma/quoted')),
    ).toEqual(['https://luma.com/quoted'])
  })

  test('Given more events than are read, When the feed is read, Then 2000 keys come out', () => {
    const many = Array.from(
      { length: 2100 },
      (_, index) => `URL:https://lu.ma/e${index}`,
    )
    const keys = lumaEventKeys(calendar(...many))
    expect(keys).toHaveLength(2000)
    expect(keys[1999]).toBe('https://luma.com/e1999')
  })

  test.each([
    ['empty', ''],
    ['HTML', '<!doctype html><html>BEGIN:VCALENDAR</html>'],
    ['JSON', '{"BEGIN":"VCALENDAR"}'],
  ])('Given %s, When it is checked, Then it is not a calendar', (_, text) => {
    expect(isCalendar(text)).toBe(false)
    expect(lumaEventKeys(text)).toEqual([])
  })
})
