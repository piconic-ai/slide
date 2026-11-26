import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import { LANGS, type Lang } from '../site/i18n'
import { HELP_CATALOG } from './default-catalog'
import { helpNumbers } from './numbers'
import { plainText } from './search'
import { siteFooter } from '../site/footer'

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * The words the service shows: its own source, without the tests, the
 * declarations, and the articles themselves (an article quoting itself proves
 * nothing). The scenes of where an email address is used are the article's
 * words too, written in src/privacy/email-exposure.ts, so that file is left
 * out for the same reason.
 */
const screenSource = readdirSync(SRC, { recursive: true })
  .map((file) => String(file).replaceAll('\\', '/'))
  .filter((file) => /\.tsx?$/.test(file))
  .filter(
    (file) =>
      !/\.test\.|\.d\.ts$|(^|\/)test-[^/]*$|^help\/articles\/|^privacy\/email-exposure\.ts$/.test(
        file,
      ),
  )
  .map((file) => readFileSync(join(SRC, file), 'utf8'))
  .join('\n')

/** Spaces and the two kinds of apostrophe do not tell one wording from another. */
const squash = (text: string) =>
  text.replace(/[’']/gu, "'").replace(/\s+/gu, '')

/**
 * Words the source holds only with a value put in: the service's name, and
 * the operator's name in the footer. They are read off the pages, not typed.
 */
const drawn = LANGS.map((lang) =>
  plainText(String(siteFooter(lang, new URL('https://example.test/')))),
).join('\n')

const haystack = squash(
  `${screenSource.replaceAll('${SERVICE_NAME}', 'slide.community')}\n${drawn}`,
)

/** Where a quoted wording has a blank to fill in (a time) or a part left out. */
const GAPS = /\((?:日時|時刻|12:34|コミュニティ名|community)\)|…|\.\.\.|\bN\b/gu

const QUOTES: Readonly<Record<Lang, RegExp>> = {
  ja: /「([^」]+)」/gu,
  en: /“([^”]+)”/gu,
}

/**
 * What an article quotes as the screen's words, in one language: whatever it
 * puts in the language's quotation marks. A quotation with a blank (a time)
 * or a part left out is checked in its pieces.
 */
async function quotedWords(
  entry: (typeof HELP_CATALOG)[number],
  lang: Lang,
): Promise<string[]> {
  const numbers = helpNumbers()
  const text = entry.article[lang]
  const [lead, body] = await Promise.all([
    text.lead(numbers),
    text.body(numbers),
  ])
  const words = plainText(`${lead}${body}`)
  return [...words.matchAll(QUOTES[lang])].map((match) => match[1]!)
}

/**
 * Quotations that are not a screen's words: what a person might say to an
 * agent, or what a tool is named. They are named here so that nothing else
 * slips through unchecked.
 */
const NOT_SCREEN_WORDS: readonly string[] = [
  // The browser's own words, for the way to delete what it kept.
  'サイトのデータを消す',
  'delete site data',
  '置いて',
  'connpass event 410635',
  '△△さんの『□□』3 ページ',
  'Page 3 of ‘…’ by …',
  'slide.community のスライドと記事と、アカウントの情報を、すべてこのフォルダに書き出して',
  'Write all my slide.community slides, articles and account information into this folder.',
]

describe('F36-AC9: what an article puts in quotation marks is a wording the service shows', () => {
  test.each(
    HELP_CATALOG.flatMap((entry) =>
      LANGS.map((lang) => [entry.key, lang] as const),
    ),
  )(
    '%s in %s: Given the quoted words, When they are looked for in the service’s source, Then each is there',
    async (key, lang) => {
      const entry = HELP_CATALOG.find((found) => found.key === key)!
      const missing: string[] = []
      for (const quoted of await quotedWords(entry, lang)) {
        if (NOT_SCREEN_WORDS.includes(quoted)) continue
        const pieces = quoted
          .split(GAPS)
          .map(squash)
          .filter((piece) => piece.length > 0)
        for (const piece of pieces)
          if (!haystack.includes(piece)) missing.push(quoted)
      }
      expect(missing).toEqual([])
    },
  )
})
