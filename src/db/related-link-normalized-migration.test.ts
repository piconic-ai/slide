import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { afterAll, expect, test } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import { normalizedUrlOf } from '../links/normalize'
import { seedDeck } from '../publication/test-support'
import { parseHttpsUrl } from '../share/https-url'
import { relatedLinks } from './schema'
import { applyMigrations } from './test-migrations'

const platform = await getPlatformProxy<Env>({ persist: false })
const database = platform.env.DB
const orm = drizzle(database)
afterAll(() => platform.dispose())

const BEFORE = '0050_auth_session_device.sql'

// Every pair of the spec, and the cases around them.
const EXAMPLES = [
  'HTTPS://Example.COM:443/a',
  'https://example.com./a',
  'https://example.com:8443/a',
  'https://[::1]:8443/a/',
  'https://[::1]/a',
  'https://example.com/a#intro',
  'https://example.com/a/?q=1#x',
  'https://example.com',
  'https://example.com//',
  'https://www.example.com/a',
  'https://a.www.example.com/a',
  'https://example.com/a?b=2&a=1',
  'https://example.com/a?b=1&a=2&a=1',
  'https://example.com/a?&b=1&&',
  'https://example.com/a?',
  'https://example.com/a?q',
  'https://example.com/a?q=a=b',
  'https://example.com/a?utm_source=x&fbclid=y&UTM_x=1&xutm_a=1',
  'https://example.com/a?mc_cid=1&mc_eid=1&msclkid=1&yclid=1&dclid=1&igshid=1&ref_src=1&_ga=1&_gl=1&utm_=1',
  'https://example.com/a?source=x&tk=y',
  'https://example.com/A',
  'https://example.com/a?q="x"\\y',
  'https://example.com/ü?q=ü',
  'https://例え.jp/a',
  'https://connpass.com/event/300000/',
  'https://pieceofcake.connpass.com/event/300000/',
  'https://pieceofcake.connpass.com/event/300000/presentation/',
  'https://connpass.com/event/300000/participation/?utm_campaign=mail',
  'https://a.connpass.com/event/x/',
  'https://a.connpass.com/',
  'https://connpass.com.example/event/1/',
  'https://connpass.com/EVENT/1/',
  'https://lu.ma/abc?tk=secret',
  'https://www.luma.com/CJIHMLT6',
  'https://luma.com/Cjihmlt6?Tk=1',
  'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
  'https://youtu.be/dQw4w9WgXcQ?si=abc',
  'https://youtu.be/dQw4w9WgXcQ/',
  'https://youtu.be/dQw4w9WgXcQ?t=30',
  'https://youtu.be/',
  'https://youtu.be/a/b',
  'https://m.youtube.com/watch?v=dQw4w9WgXcQ&feature=share',
  'https://youtube.com/watch?pp=x&v=dQw4w9WgXcQ&v=other&t=1',
  'https://www.youtube.com/watch?v=',
  'https://www.youtube.com/watch?v=a.b',
  'https://www.youtube.com/watch',
  'https://www.youtube.com/shorts/dQw4w9WgXcQ',
  'https://www.youtube.com/live/dQw4w9WgXcQ',
  'https://www.youtube.com/embed/dQw4w9WgXcQ?list=PL1',
  'https://youtube.com/shorts/a/b',
  'https://www.youtube.com/@kfly8/?si=1',
  'https://music.youtube.com/watch?v=dQw4w9WgXcQ&si=x',
  'https://www.nicovideo.jp/watch/sm9',
  'https://sp.nicovideo.jp/watch/sm9?from=30',
  'https://nico.ms/sm9',
  'https://nico.ms/so12',
  'https://nico.ms/nm3/',
  'https://nico.ms/lv1',
  'https://nico.ms/sm',
  'https://nico.ms/sm9/x',
  'https://sp.nicovideo.jp/ranking',
  'https://player.vimeo.com/video/123',
  'https://player.vimeo.com/video/123?h=abcdef&badge=0',
  'https://player.vimeo.com/video/123?h=',
  'https://player.vimeo.com/video/x',
  'https://vimeo.com/123',
  'https://www.vimeo.com/123/',
  'https://vimeo.com/123/abcdef',
  'https://vimeo.com/123/abcdef?h=other',
  'https://vimeo.com/123?h=abcdef&h=b',
  'https://vimeo.com/123/a/b',
  'https://vimeo.com/channels/staff',
  'https://m.twitch.tv/videos/1',
  'https://www.twitch.tv/videos/1',
  'https://twitch.tv/videos/1',
  'https://www.loom.com/share/0123abcd',
  'https://www.loom.com/embed/0123abcd',
  'https://loom.com/embed/0123abcd/',
  'https://loom.com/embed/a/b',
  'https://medium.com/@a/post-abc?source=rss',
  'https://kfly8.medium.com/post-abc?source=x&b=1',
  'https://zenn.dev/A/articles/x?utm_medium=social',
]

const HOSTS = [
  'example.com',
  'www.example.com.',
  'example.com:8443',
  'a.connpass.com',
  'lu.ma',
  'youtu.be',
  'm.youtube.com',
  'music.youtube.com',
  'nico.ms',
  'sp.nicovideo.jp',
  'player.vimeo.com',
  'vimeo.com',
  'm.twitch.tv',
  'www.loom.com',
  'x.medium.com',
]
const PATHS = [
  '/',
  '/a/',
  '/event/1/presentation/',
  '/watch',
  '/shorts/ID',
  '/sm9',
  '/watch/sm9',
  '/video/123',
  '/123/abc',
  '/embed/x',
  '/ABC/',
]
const QUERIES = [
  '',
  '?b=1&a=2&a=1',
  '?v=ID&si=x&utm_x=1',
  '?h=hh&tk=1&source=2&v=x-y_z',
  '?&v=&t=30#f',
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

test('F27-AC48: Given links kept before the compared form existed, When the migration is applied, Then every one gets the form normalizedUrlOf gives its url', async () => {
  await applyMigrations(database, { until: BEFORE })
  await seedDeck(database, 'talk')
  for (let start = 0; start < hrefs.length; start += 30)
    await orm.run(
      sql`INSERT INTO related_links (id, deck_id, kind, url, title, position, created_at) VALUES ${sql.join(
        hrefs
          .slice(start, start + 30)
          .map(
            (url, at) =>
              sql`(${`l${start + at}`}, 'talk', 'other', ${url}, NULL, ${start + at + 1}, 1)`,
          ),
        sql`, `,
      )}`,
    )
  await applyMigrations(database, { after: BEFORE })
  const kept = await orm
    .select({ url: relatedLinks.url, form: relatedLinks.normalized_url })
    .from(relatedLinks)
    .orderBy(relatedLinks.position)
  expect(kept).toHaveLength(hrefs.length)
  expect(kept).toEqual(
    hrefs.map((url) => ({ url, form: normalizedUrlOf(url) })),
  )
  // A Worker that does not write the form still adds links.
  await orm.run(
    sql`INSERT INTO related_links (id, deck_id, kind, url, title, position, created_at) VALUES ('old', 'talk', 'other', 'https://example.com/', NULL, 100000, 1)`,
  )
  const [old] = await orm
    .select({ form: relatedLinks.normalized_url })
    .from(relatedLinks)
    .where(sql`${relatedLinks.id} = 'old'`)
  expect(old).toEqual({ form: null })
}, 60000)
