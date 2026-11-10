import { expect, test } from 'vitest'
import { alternateLinks } from './i18n'

const origin = 'https://slide.example'

test.each([
  ['https://slide.example/', '/'],
  ['https://slide.example/@kobaken/talk?lang=en', '/@kobaken/talk'],
  ['https://slide.example/@kobaken?x=1&lang=ja', '/@kobaken?x=1'],
  ['https://other.example//evil.example/x', '/evil.example/x'],
])(
  'Given the page %s, When its alternates are listed, Then every language and the default point at %s on the service origin',
  (url, path) => {
    const sep = path.includes('?') ? '&' : '?'
    expect(alternateLinks(origin, new URL(url))).toBe(
      [
        `<${origin}${path}${sep}lang=ja>; rel="alternate"; hreflang="ja"`,
        `<${origin}${path}${sep}lang=en>; rel="alternate"; hreflang="en"`,
        `<${origin}${path}>; rel="alternate"; hreflang="x-default"`,
      ].join(', '),
    )
  },
)
