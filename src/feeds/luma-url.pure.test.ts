import { describe, expect, test } from 'vitest'
import { lumaFeedTarget, lumaFeedUrl } from './luma-url'

const FEED = 'https://api.lu.ma/ics/get?entity=calendar&id=cal-abc123'

describe('the one address asked for', () => {
  test('F33-AC10: Given a calendar feed written as the service writes it, When it is checked, Then it is the address asked for', () => {
    expect(lumaFeedTarget(FEED)).toBe(FEED)
    expect(lumaFeedUrl('cal-abc123')).toBe(FEED)
  })

  test.each([
    [
      'another host',
      'https://evil.example/ics/get?entity=calendar&id=cal-abc123',
    ],
    [
      'a host ending in api.lu.ma',
      'https://api.lu.ma.evil.example/ics/get?entity=calendar&id=cal-abc123',
    ],
    [
      'a subdomain of lu.ma',
      'https://x.api.lu.ma/ics/get?entity=calendar&id=cal-abc123',
    ],
    ['the event site', 'https://lu.ma/ics/get?entity=calendar&id=cal-abc123'],
    ['http', 'http://api.lu.ma/ics/get?entity=calendar&id=cal-abc123'],
    ['a port', 'https://api.lu.ma:8443/ics/get?entity=calendar&id=cal-abc123'],
    [
      'the default port written',
      'https://api.lu.ma:443/ics/get?entity=calendar&id=cal-abc123',
    ],
    ['a user', 'https://user@api.lu.ma/ics/get?entity=calendar&id=cal-abc123'],
    [
      'a user and password',
      'https://a:b@api.lu.ma/ics/get?entity=calendar&id=cal-abc123',
    ],
    [
      'another path',
      'https://api.lu.ma/public/v1/calendar?entity=calendar&id=cal-abc123',
    ],
    [
      'a path past the feed',
      'https://api.lu.ma/ics/get/../x?entity=calendar&id=cal-abc123',
    ],
    [
      'a trailing slash',
      'https://api.lu.ma/ics/get/?entity=calendar&id=cal-abc123',
    ],
    [
      'an encoded path',
      'https://api.lu.ma/ics/%67et?entity=calendar&id=cal-abc123',
    ],
    ['an extra parameter', `${FEED}&redirect=https://evil.example/`],
    ['the parameter twice', `${FEED}&id=cal-other`],
    ['a fragment', `${FEED}#x`],
    ['another entity', 'https://api.lu.ma/ics/get?entity=event&id=cal-abc123'],
    ['no id', 'https://api.lu.ma/ics/get?entity=calendar'],
    [
      'an id not of a calendar',
      'https://api.lu.ma/ics/get?entity=calendar&id=evt-abc123',
    ],
    [
      'an id with a slash',
      'https://api.lu.ma/ics/get?entity=calendar&id=cal-a/b',
    ],
    [
      'the parameters swapped',
      'https://api.lu.ma/ics/get?id=cal-abc123&entity=calendar',
    ],
    [
      'upper case host',
      'https://API.LU.MA/ics/get?entity=calendar&id=cal-abc123',
    ],
    ['leading space', ` ${FEED}`],
    [
      'an IP address',
      'https://127.0.0.1/ics/get?entity=calendar&id=cal-abc123',
    ],
    [
      'localhost',
      'http://localhost:8770/ics/get?entity=calendar&id=cal-abc123',
    ],
    ['not an address', 'api.lu.ma/ics/get?entity=calendar&id=cal-abc123'],
    ['empty', ''],
    ['javascript', 'javascript:alert(1)'],
    ['a data address', 'data:text/calendar,BEGIN:VCALENDAR'],
  ])(
    'F33-AC10: Given %s, When it is checked, Then it is never asked for',
    (_, address) => {
      expect(lumaFeedTarget(address)).toBeNull()
    },
  )
})
