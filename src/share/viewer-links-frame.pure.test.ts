import { expect, test } from 'vitest'
import { viewerLinksFrame } from './viewer-links-frame'

test('F27-AC85: Given a link of the kind event, When the viewer shows it, Then it carries the event icon and the kind name event in either language', async () => {
  const links = [
    {
      id: 'l1',
      kind: 'event',
      eventId: 1,
      url: 'https://kanagawapm.connpass.com/event/410635/',
      href: 'https://kanagawapm.connpass.com/event/410635/',
      title: 'Kanagawa.pm #3',
    },
  ] as const
  const ja = String(await viewerLinksFrame(links, 'ja'))
    .replace(/\s+/g, ' ')
    .replace(/ >/g, '>')
    .replace(/ </g, '<')
  const en = String(await viewerLinksFrame(links, 'en'))
    .replace(/\s+/g, ' ')
    .replace(/ >/g, '>')
    .replace(/ </g, '<')
  expect(ja).toContain('class="related-link-kind">イベント</span>')
  expect(en).toContain('class="related-link-kind">Event</span>')
  // The calendar of the event icon, not the chain of "other".
  expect(ja).toContain('M3 8.5h14M7 2.5v4M13 2.5v4')
  expect(ja).toContain('rel="noopener nofollow ugc"')
})
