import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { afterAll, expect, test } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import { gatherKeyOf, linkHostOf } from '../links/gather'
import { normalizedUrlOf } from '../links/normalize'
import { seedDeck } from '../publication/test-support'
import { parseHttpsUrl } from '../share/https-url'
import { relatedLinks } from './schema'
import { applyMigrations } from './test-migrations'

const platform = await getPlatformProxy<Env>({ persist: false })
const database = platform.env.DB
const orm = drizzle(database)
afterAll(() => platform.dispose())

const BEFORE = '0070_mcp_scope.sql'

// The pairs of F45-AC5 and F45-AC23, and the cases around them.
const EXAMPLES = [
  'HTTPS://WWW.Example.COM:443/a',
  'https://example.com./a',
  'https://www.example.com.:8443/a/',
  'https://[::1]:8443/a/?t=1',
  'https://[::1]/a',
  'https://example.com',
  'https://example.com/a?t=1&from=2#t=3',
  'https://example.com/a?utm_source=x&t=1',
  'https://www.www.youtube.com/watch?v=dQw4w9WgXcQ&t=1',
  'https://例え.jp/a?t=1',
  'https://WWW.例え.JP./ü?q=ü',
  'https://pieceofcake.connpass.com/event/300000/?t=1&from=2',
  'https://lu.ma/abc?tk=secret&t=1',
  'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
  'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=30s',
  'https://youtu.be/dQw4w9WgXcQ?t=30',
  'https://youtu.be/dQw4w9WgXcQ?si=abc&t=30&list=PL1',
  'https://YouTu.be./dQw4w9WgXcQ?t',
  'https://youtu.be/a/b?t=1',
  'https://m.youtube.com/watch?t=1&v=dQw4w9WgXcQ&feature=share&t=2',
  'https://youtube.com:8443/watch?T=1&t=1&tt=2&at=3&v=dQw4w9WgXcQ',
  'https://youtube.com/watch?a=t&b=t=1&t==&t=a=b',
  'https://www.youtube.com/watch?t=1',
  'https://www.youtube.com/@kfly8/?t=1&from=2',
  'https://www.youtube.com/shorts/dQw4w9WgXcQ?t=5&x="y"\\z',
  'https://www.youtube.com/embed/dQw4w9WgXcQ?start=5&t=5',
  'https://music.youtube.com/watch?v=dQw4w9WgXcQ&t=30',
  'https://www.nicovideo.jp/watch/sm9',
  'https://www.nicovideo.jp/watch/sm9?from=30',
  'https://sp.nicovideo.jp/watch/sm9?from=30&t=1',
  'https://nico.ms/sm9?from=30',
  'https://nico.ms/lv1?from=30&ref=x',
  'https://sp.nicovideo.jp/ranking?From=1&from&fromage=2',
  'https://live.nicovideo.jp/watch/lv1?from=30',
  'https://vimeo.com/123/abcdef?t=1&from=2',
  'https://www.twitch.tv/videos/1?t=1h2m',
  'https://zenn.dev/A/articles/x?from=feed',
]

const HOSTS = [
  'example.com',
  'WWW.Example.com.',
  'example.com:8443',
  'www.youtube.com',
  'youtu.be',
  'm.youtube.com.:8443',
  'music.youtube.com',
  'nico.ms',
  'www.nicovideo.jp',
  'sp.nicovideo.jp',
  'a.connpass.com',
  'player.vimeo.com',
]
const PATHS = ['/', '/a/', '/watch', '/shorts/ID', '/sm9', '/watch/sm9']
const QUERIES = [
  '',
  '?t=30',
  '?from=30',
  '?v=ID&t=30&from=1&si=x',
  '?from=1&b=1&t=2&a=2&t=3&utm_x=1',
  '?&t=&from=#t=1',
]

/** Every address as parseHttpsUrl keeps it. */
const hrefs = [
  ...new Set(
    [
      ...EXAMPLES,
      ...HOSTS.flatMap((host) =>
        PATHS.flatMap((path) =>
          QUERIES.map((query) => `https://${host}${path}${query}`),
        ),
      ),
    ].map((typed) => {
      const parsed = parseHttpsUrl(typed, 2000)
      if (!parsed.ok) throw new Error(`not an address: ${typed}`)
      return parsed.url
    }),
  ),
]

test('F45-AC5, F45-AC23: Given links kept before the gathering key existed, When the migrations are applied, Then every one gets the key gatherKeyOf and the host linkHostOf give its url', async () => {
  await applyMigrations(database, { until: BEFORE })
  await seedDeck(database, 'talk')
  // As the Worker before the migration writes a link: with its compared form.
  for (let start = 0; start < hrefs.length; start += 20)
    await orm.run(
      sql`INSERT INTO related_links (id, deck_id, kind, url, normalized_url, title, position, created_at) VALUES ${sql.join(
        hrefs
          .slice(start, start + 20)
          .map(
            (url, at) =>
              sql`(${`l${start + at}`}, 'talk', 'other', ${url}, ${normalizedUrlOf(url)}, NULL, ${start + at + 1}, 1)`,
          ),
        sql`, `,
      )}`,
    )
  // A link from before the compared form was written has no key to build.
  await orm.run(
    sql`INSERT INTO related_links (id, deck_id, kind, url, title, position, created_at) VALUES ('formless', 'talk', 'other', 'https://Example.com/', NULL, 99999, 1)`,
  )
  await applyMigrations(database, { after: BEFORE })
  const kept = await orm
    .select({
      url: relatedLinks.url,
      key: relatedLinks.gather_key,
      host: relatedLinks.link_host,
    })
    .from(relatedLinks)
    .orderBy(relatedLinks.position)
  expect(kept).toHaveLength(hrefs.length + 1)
  expect(kept.slice(0, -1)).toEqual(
    hrefs.map((url) => ({
      url,
      key: gatherKeyOf(url),
      host: linkHostOf(url),
    })),
  )
  expect(kept.at(-1)).toMatchObject({ key: null, host: 'example.com' })
  // The pairs the spec names end up with one key.
  const keyOf = (url: string) => kept.find((row) => row.url === url)?.key
  expect(keyOf('https://youtu.be/dQw4w9WgXcQ?t=30')).toBe(
    'https://youtube.com/watch?v=dQw4w9WgXcQ',
  )
  expect(keyOf('https://www.nicovideo.jp/watch/sm9?from=30')).toBe(
    'https://nicovideo.jp/watch/sm9',
  )
  expect(keyOf('https://music.youtube.com/watch?v=dQw4w9WgXcQ&t=30')).toBe(
    'https://music.youtube.com/watch?t=30&v=dQw4w9WgXcQ',
  )
  // A Worker that writes neither column still adds links.
  await orm.run(
    sql`INSERT INTO related_links (id, deck_id, kind, url, normalized_url, sanitized_url, title, position, created_at) VALUES ('old', 'talk', 'other', 'https://youtu.be/x?t=1', 'https://youtube.com/watch?t=1&v=x', 'https://youtu.be/x?t=1', NULL, 100000, 1)`,
  )
  const [old] = await orm
    .select({ key: relatedLinks.gather_key, host: relatedLinks.link_host })
    .from(relatedLinks)
    .where(sql`${relatedLinks.id} = 'old'`)
  expect(old).toEqual({ key: null, host: null })
}, 60000)
