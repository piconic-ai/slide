import { expect, test } from 'vitest'
import { alternateLinks } from './i18n'

const origin = 'https://slide.example'

test.each([
  ['https://slide.example/', '/'],
  ['https://slide.example/@kobaken/talk?lang=en', '/@kobaken/talk'],
  // Tracking tags and other parameters are not part of the page.
  ['https://slide.example/@kobaken?utm_source=x&lang=ja', '/@kobaken'],
  ['https://other.example//evil.example/x', '/evil.example/x'],
])(
  'Given the page %s, When its alternates are listed, Then every language and the default point at %s on the service origin',
  (url, path) => {
    expect(alternateLinks(origin, new URL(url))).toBe(
      [
        `<${origin}${path}?lang=ja>; rel="alternate"; hreflang="ja"`,
        `<${origin}${path}?lang=en>; rel="alternate"; hreflang="en"`,
        `<${origin}${path}>; rel="alternate"; hreflang="x-default"`,
      ].join(', '),
    )
  },
)
