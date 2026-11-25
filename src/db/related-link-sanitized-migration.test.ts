import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { afterAll, expect, test } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import { normalizedUrlOf } from '../links/normalize'
import { sanitizedUrlOf } from '../links/sanitize'
import { seedDeck } from '../publication/test-support'
import { parseHttpsUrl } from '../share/https-url'
import { relatedLinks } from './schema'
import { applyMigrations } from './test-migrations'

const platform = await getPlatformProxy<Env>({ persist: false })
const database = platform.env.DB
const orm = drizzle(database)
afterAll(() => platform.dispose())

const BEFORE = '0051_related_link_normalized_url.sql'

// The cases of the spec, and the ones around them.
const EXAMPLES = [
  'https://example.com/a?utm_source=x&b=1',
  'https://example.com/a/?utm_source=x&fbclid=y',
  'https://example.com/a?utm_source=x#intro',
  'https://example.com/a?utm_source=x#b?fbclid=y',
  'https://example.com/a?q=1#utm_source=x',
  'https://example.com/a?z=1&utm_source=x&a=b=c&q=a%20b+c&&y',
  'https://example.com/a?&utm_source=x',
  'https://example.com/a?&&utm_source=x',
  'https://example.com/a?utm_source=&fbclid&q=1',
  'https://example.com/a?utm_source=a&q=1&utm_source=b&gclid=c',
  'https://example.com/a?mc_cid=1&mc_eid=1&msclkid=1&yclid=1&dclid=1&igshid=1&ref_src=1&_ga=1&_gl=1&utm_=1',
  'https://example.com/a?UTM_SOURCE=x&Fbclid=y&xutm_a=1&utm%5Fsource=1',
  'https://example.com/a?',
  'https://example.com/a#',
  'https://example.com/a?#',
  'https://example.com',
  'https://example.com/a?q="x"\\y&utm_source=1',
  'https://example.com/a‮b?x=⁦y&utm_source=1#c‮d',
  'https://例え.jp/a?utm_source=1&q=ü',
  'https://[::1]:8443/a?utm_source=1&tk=1',
  'https://lu.ma/abc?tk=secret&x=1',
  'https://luma.com/abc?tk=secret',
  'https://www.luma.com/abc?tk=secret',
  'https://LU.MA./abc?tk=secret',
  'https://lu.ma:8443/abc?tk=secret',
  'https://events.lu.ma/abc?tk=x',
  'https://luma.com/abc?Tk=1&tk',
  'https://medium.com/@a/post-abc?source=rss&x=1',
  'https://blog.medium.com/post-abc?source=rss',
  'https://www.medium.com/post-abc?source=rss',
  'https://medium.com.example/a?source=x',
  'https://notmedium.com/a?source=x',
  'https://example.com/a?source=x&tk=y',
  'https://youtu.be/abc?si=x&utm_source=y&t=30',
]

const HOSTS = [
  'example.com',
  'www.example.com.',
  'example.com:8443',
  'lu.ma',
  'www.luma.com',
  'x.medium.com',
  'medium.com:8443',
]
const QUERIES = [
  '',
  '?',
  '?b=1&a=2',
  '?tk=1&source=2&utm_x=3',
  '?a=1&tk&source=&fbclid=2#f?tk=1',
  '?&gclid=1&&',
]

/** Every address as parseHttpsUrl keeps it. */
const hrefs = [
  ...new Set(
    [
      ...EXAMPLES,
      ...HOSTS.flatMap((host) =>
        ['/', '/a/'].flatMap((path) =>
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

test('F27-AC59: Given links kept before the sanitized address existed, When the migration is applied, Then every one gets the address sanitizedUrlOf gives its url, and keeps its url and compared form', async () => {
  await applyMigrations(database, { until: BEFORE })
  await seedDeck(database, 'talk')
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
  await applyMigrations(database, { after: BEFORE })
  const kept = await orm
    .select({
      url: relatedLinks.url,
      form: relatedLinks.normalized_url,
      href: relatedLinks.sanitized_url,
    })
    .from(relatedLinks)
    .orderBy(relatedLinks.position)
  expect(kept).toHaveLength(hrefs.length)
  expect(kept).toEqual(
    hrefs.map((url) => ({
      url,
      form: normalizedUrlOf(url),
      href: sanitizedUrlOf(url),
    })),
  )
  // Some addresses lose parts and some keep all of them.
  expect(kept.filter((one) => one.href !== one.url).length).toBeGreaterThan(30)
  expect(kept.filter((one) => one.href === one.url).length).toBeGreaterThan(10)
  // A Worker that does not write the sanitized address still adds links.
  await orm.run(
    sql`INSERT INTO related_links (id, deck_id, kind, url, normalized_url, title, position, created_at) VALUES ('old', 'talk', 'other', 'https://example.com/?utm_source=x', 'https://example.com/', NULL, 100000, 1)`,
  )
  const [old] = await orm
    .select({ href: relatedLinks.sanitized_url })
    .from(relatedLinks)
    .where(sql`${relatedLinks.id} = 'old'`)
  expect(old).toEqual({ href: null })
}, 60000)
