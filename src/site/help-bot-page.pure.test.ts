import { expect, test } from 'vitest'
import {
  FEED_TIMEOUT_MS,
  FEED_USER_AGENT,
  FEEDS_PER_MINUTE,
  MAX_BACKOFF,
  MAX_FAILURES,
  MAX_FEED_BYTES,
  MIN_READ_INTERVAL,
  READ_EVERY,
} from '../feeds/limits'
import { HELP_BOT_PATH, helpSections } from './help-content'
import { helpBotBody } from './help-bot-page'
import { CONTACT_ADDRESS } from './legal-pages'
import type { Lang } from './i18n'

const squash = (text: string) => text.replace(/\s+/g, '')
const JAPANESE = /[぀-ヿ一-鿿]/
const body = async (lang: Lang) => squash(String(await helpBotBody(lang)))

test('F33-AC18: Given the limits the reader enforces, When the page words them, Then once a day, once an hour and a day at most are the values in the code', () => {
  expect(READ_EVERY).toBe(24 * 60 * 60)
  expect(MIN_READ_INTERVAL).toBe(60 * 60)
  expect(MAX_BACKOFF).toBe(24 * 60 * 60)
})

const MB = MAX_FEED_BYTES / 1024 / 1024
const SECONDS = FEED_TIMEOUT_MS / 1000

test.each([
  [
    'ja',
    [
      // What it reads.
      'Luma のカレンダーの「iCal で購読」の配信',
      'https://api.lu.ma/ics/get?entity=calendar&amp;id=cal-…',
      'この配信のほかは、取りに行きません',
      'ほかの API も',
      'リダイレクトは追いません',
      // How often.
      '各配信を 1 日 1 回読みます',
      '同じ配信は 1 時間に 1 回までです',
      `1 分に ${FEEDS_PER_MINUTE} 本まで`,
      `${MB} MB、${SECONDS} 秒まで`,
      `${MAX_FAILURES} 回続けて失敗した配信は、読むのを止めます`,
      // Why.
      'イベントの URL と照らし合わせ',
      '配信の中身は保存せず',
      // Where to write.
      '<a href="/contact">お問い合わせ</a>',
    ],
  ],
  [
    'en',
    [
      'the “Subscribe with iCal” feeds of Luma calendars',
      'https://api.lu.ma/ics/get?entity=calendar&amp;id=cal-…',
      'Beyond these feeds, it fetches nothing',
      'other API',
      'It does not follow redirects',
      'Each feed is read once a day',
      'The same feed is read once an hour at most',
      `at most ${FEEDS_PER_MINUTE} a minute`,
      `${MB} MB or ${SECONDS} seconds`,
      `After ${MAX_FAILURES} failures in a row`,
      'match the event URLs in a feed against the event URLs in the related links',
      'It keeps nothing of the feed',
      '<a href="/contact">Contact</a>',
    ],
  ],
] as const)(
  'F33-AC18: Given the page on the bot in %s, When it is read, Then it states what is read, how often, why, and where to write',
  async (lang, phrases) => {
    const text = await body(lang)
    for (const phrase of phrases) expect(text).toContain(squash(phrase))
    expect(text).toContain(squash(FEED_USER_AGENT))
    expect(text).toContain(CONTACT_ADDRESS)
    if (lang === 'en') expect(text).not.toMatch(JAPANESE)
  },
)

test('F33-AC19: Given the User-Agent of the reader, When its link is read, Then it is the page on the bot of the service', () => {
  const link = /\(\+(https:\/\/[^)\s]+)\)/.exec(FEED_USER_AGENT)?.[1]
  expect(link).toBeDefined()
  const url = new URL(link!)
  expect(url.origin).toBe('https://slide.community')
  expect(url.pathname).toBe(HELP_BOT_PATH)
  expect(url.search + url.hash).toBe('')
})

test.each(['ja', 'en'] as const)(
  'F33-AC19: Given the help’s section on communities in %s, When it names Luma, Then it links to the page on the bot',
  async (lang) => {
    const section = helpSections(lang).find((s) => s.id === 'communities')
    expect(String(await section!.body)).toContain(`href="${HELP_BOT_PATH}"`)
  },
)
