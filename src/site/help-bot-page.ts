import { html } from 'hono/html'
import { LUMA_FEED_FORM } from '../communities/link-rules'
import {
  FEED_TIMEOUT_MS,
  FEED_USER_AGENT,
  FEEDS_PER_MINUTE,
  MAX_FAILURES,
  MAX_FEED_BYTES,
} from '../feeds/limits'
import { messages, type Lang } from './i18n'
import { CONTACT_ADDRESS, legalPath } from './legal-pages'
import { SERVICE_NAME } from './service'
import { pageShell, PLAIN_PAGE_POLICY } from './shell'

/** The page carries only service markup and the shared frame, like the help. */
export const HELP_BOT_PAGE_POLICY = PLAIN_PAGE_POLICY

/**
 * The numbers the page quotes, taken from the code that enforces them. The
 * read once a day and once an hour at most are written out in words; their
 * test holds them to READ_EVERY and MIN_READ_INTERVAL.
 */
export const helpBotNumbers = () =>
  Object.freeze({
    perMinute: FEEDS_PER_MINUTE,
    mb: MAX_FEED_BYTES / (1024 * 1024),
    seconds: FEED_TIMEOUT_MS / 1000,
    failures: MAX_FAILURES,
  })
type Numbers = ReturnType<typeof helpBotNumbers>

const contactLink = (label: string) =>
  html`<a href="${legalPath('contact')}">${label}</a>`

const text = messages({
  ja: {
    title: '配信を読むボット',
    body: (n: Numbers) =>
      html`<p>
          User-Agent が
          <code>${FEED_USER_AGENT}</code> の取得は、${SERVICE_NAME}
          のボットです。このページでは、ボットが何を、どの間隔で、何のために読むかを書いています。
        </p>
        <h2>読むもの</h2>
        <p>
          Luma のカレンダーの「iCal
          で購読」の配信(<code>${LUMA_FEED_FORM}</code>)だけです。コミュニティの管理者が、紐づけ用リンクとして入れた配信を読みます。
        </p>
        <p>
          ほかの URL には取りに行きません。Luma
          のイベントのページ、カレンダーのページ、API、connpass や Doorkeeper
          のページ、スライドの関連リンクの先も読みません。リダイレクトは追いません。
        </p>
        <h2>間隔</h2>
        <ul>
          <li>各配信を 1 日 1 回読みます。</li>
          <li>
            同じ配信は 1 時間に 1
            回までです。紐づけ用リンクが足されたときや、どのカレンダーにも無い
            Luma
            のイベントのリンクがスライドに保存されたときは前倒しで読みますが、この間隔は超えません。
          </li>
          <li>
            Luma への取得は、同時に 1 本だけで、1 分に ${n.perMinute}
            本までです。
          </li>
          <li>
            前の応答の <code>ETag</code> と <code>Last-Modified</code>
            を使い、条件付きで取りに行きます。
          </li>
          <li>応答は ${n.mb} MB、${n.seconds} 秒までで打ち切ります。</li>
          <li>
            失敗したときは、すぐにやり直さず、間隔を倍々に広げます(長くて 1
            日)。<code>429</code> と <code>503</code> の
            <code>Retry-After</code> に従います。${n.failures}
            回続けて失敗した配信は、読むのを止めます。
          </li>
        </ul>
        <h2>何のために読むか</h2>
        <p>
          配信に並ぶイベントの URL を、スライドの関連リンクにあるイベントの URL
          と照らし合わせ、そのイベントの発表をコミュニティのページに集めるためだけに読みます。イベント名、日時、場所など、配信の中身は保存せず、画面にも出しません。持つのは、照らし合わせに使うイベントの
          URL だけです。
        </p>
        <h2>問い合わせ先</h2>
        <p>
          ボットについてのご連絡は、${contactLink('お問い合わせ')}(<code>${CONTACT_ADDRESS}</code>)へお送りください。
        </p>`,
  },
  en: {
    title: 'The feed-reading bot',
    body: (n: Numbers) =>
      html`<p>
          Requests with the User-Agent <code>${FEED_USER_AGENT}</code> come from
          the bot of ${SERVICE_NAME}. This page says what it reads, how often,
          and why.
        </p>
        <h2>What it reads</h2>
        <p>
          Only the “Subscribe with iCal” feeds of Luma calendars
          (<code>${LUMA_FEED_FORM}</code>): the feeds the admins of a community
          entered as its links.
        </p>
        <p>
          It fetches no other URL. It does not read Luma’s event pages, calendar
          pages or API, pages on connpass or Doorkeeper, or the pages that
          slides link to. It does not follow redirects.
        </p>
        <h2>How often</h2>
        <ul>
          <li>Each feed is read once a day.</li>
          <li>
            The same feed is read once an hour at most. When a link is added, or
            a slide gets a link to a Luma event no calendar lists, the feeds are
            read early, but never more often than that.
          </li>
          <li>
            One request to Luma at a time, and at most ${n.perMinute} a minute.
          </li>
          <li>
            Requests are conditional, with the <code>ETag</code> and
            <code>Last-Modified</code> of the last answer.
          </li>
          <li>An answer is cut off at ${n.mb} MB or ${n.seconds} seconds.</li>
          <li>
            After a failure it does not retry at once; the wait doubles each
            time, up to a day. It follows <code>Retry-After</code> on
            <code>429</code> and <code>503</code>. After ${n.failures} failures
            in a row, it stops reading the feed.
          </li>
        </ul>
        <h2>Why it reads them</h2>
        <p>
          Only to match the event URLs in a feed against the event URLs in the
          related links of slides, and so gather the talks at those events on
          the community’s page. It keeps nothing of the feed, such as event
          names, dates or places, and shows none of it. It keeps only the event
          URLs it matches by.
        </p>
        <h2>Contact</h2>
        <p>
          Please send anything about the bot through ${contactLink('Contact')}
          (<code>${CONTACT_ADDRESS}</code>).
        </p>`,
  },
})

export const helpBotTitle = (lang: Lang) => text[lang].title

/** What the bot reads, how often, why, and where to write (D-66, F33-AC18). */
export const helpBotBody = (lang: Lang) =>
  html`<h1>${text[lang].title}</h1>
    <div class="help-bot">${text[lang].body(helpBotNumbers())}</div>`

const helpBotStyle = html`<style>
  .help-bot {
    line-height: 1.9;
  }
  .help-bot p,
  .help-bot ul {
    max-width: 40em;
  }
  .help-bot code {
    overflow-wrap: anywhere;
  }
</style>`

export const helpBotPage = (lang: Lang, url: URL) =>
  pageShell({
    lang,
    title: helpBotTitle(lang),
    url,
    style: helpBotStyle,
    body: helpBotBody(lang),
  })
