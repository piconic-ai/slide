import { html, raw } from 'hono/html'
import type { HtmlEscapedString } from 'hono/utils/html'
import { helpBotTitle } from '../site/help-bot-page'
import { messages, type Lang } from '../site/i18n'
import { pageShell, PLAIN_PAGE_POLICY } from '../site/shell'
import { aimName, aimSummary, HELP_AIMS, type HelpAim } from './aims'
import {
  articlesOfAim,
  relatedOf,
  type Catalog,
  type CatalogEntry,
} from './catalog'
import { helpNumbers, type HelpNumbers } from './numbers'
import {
  HELP_BOT_PATH,
  HELP_PATH,
  HELP_QUERY_PARAM,
  helpAimPath,
} from './paths'
import { MAX_QUERY_CHARS, plainText, type SearchHit } from './search'
import type { SearchQuery } from './search'

/** The help's lists and articles carry only service markup and the frame. */
export const HELP_PAGE_POLICY = PLAIN_PAGE_POLICY

/**
 * The entrance and the results have the search box, which sends to the help
 * itself; that alone is let through. The pages that have no form keep the
 * plain policy, so a move between them and the terms stays in the frame.
 */
export const HELP_SEARCH_PAGE_POLICY = PLAIN_PAGE_POLICY.replace(
  "form-action 'none'",
  "form-action 'self'",
)

/** How many of an aim's articles the entrance lists under its name. */
export const ENTRANCE_ARTICLES = 3

type Html = HtmlEscapedString | Promise<HtmlEscapedString>

const text = messages({
  ja: {
    title: 'ヘルプ',
    breadcrumb: 'パンくず',
    searchLabel: 'ヘルプを探す',
    searchButton: '探す',
    contactBefore: '見つからないときは、',
    contactLink: 'お問い合わせ',
    contactAfter: 'へ。',
    related: '関係する記事',
    unresolved: '解決しないときは',
    unresolvedAfter: 'から、お知らせください。',
    count: (word: string, n: number) => `${word}の記事 ${n} 件`,
    none: (word: string) => `${word}に合う記事は見つかりませんでした。`,
    aims: '狙いから探す',
  },
  en: {
    title: 'Help',
    breadcrumb: 'Breadcrumb',
    searchLabel: 'Search the help',
    searchButton: 'Search',
    contactBefore: 'Cannot find it? ',
    contactLink: 'Contact us',
    contactAfter: '.',
    related: 'Related articles',
    unresolved: 'If this did not solve it',
    unresolvedAfter: ' and tell us what happened.',
    count: (word: string, n: number) =>
      `${n} ${n === 1 ? 'article' : 'articles'} for “${word}”`,
    none: (word: string) => `No article matches “${word}”.`,
    aims: 'Browse by aim',
  },
})

export const helpTitle = (lang: Lang) => text[lang].title

/** What the help's own markup needs; colors come from the shared tokens. */
const helpStyle = html`<style>
  .help-search {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
    max-width: 40em;
    margin: 0 0 32px;
  }
  .help-search input[type='search'] {
    flex: 1 1 12em;
    width: auto;
  }
  .help-aims {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0 48px;
  }
  .help-aim > h2,
  .help-aims-heading {
    margin-top: 24px;
    font-size: 20px;
  }
  .help-aim-summary {
    margin: 0 0 8px;
    color: var(--muted-foreground);
    font-size: 14px;
    line-height: 1.7;
  }
  .help-aim > h2 a {
    display: inline-flex;
    align-items: center;
    min-height: 44px;
    text-decoration: none;
  }
  .help-aim > h2 a:hover {
    text-decoration: underline;
  }
  .help-links {
    list-style: none;
    margin: 0 0 16px;
    padding: 0;
  }
  .help-links > li > a {
    display: flex;
    align-items: center;
    min-height: 44px;
  }
  .help-entries {
    list-style: none;
    margin: 0 0 24px;
    padding: 0;
    max-width: 40em;
  }
  .help-entries > li {
    padding: 12px 0;
    border-bottom: 1px solid var(--border);
  }
  .help-entries > li > a {
    display: inline-flex;
    align-items: center;
    min-height: 44px;
    font-weight: 600;
  }
  .help-entries p {
    margin: 0;
    color: var(--muted-foreground);
    font-size: 14px;
    line-height: 1.7;
  }
  .help-entries .help-aim-name {
    margin-left: 8px;
    color: var(--muted-foreground);
    font-size: 13px;
  }
  mark {
    padding: 0 2px;
    border-radius: 2px;
    background: var(--accent);
    color: var(--accent-foreground);
    font-weight: 700;
    text-decoration: underline;
  }
  .help-crumbs ol {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 8px;
    list-style: none;
    margin: 16px 0 0;
    padding: 0;
    font-size: 14px;
  }
  .help-crumbs li {
    display: flex;
    align-items: center;
    min-height: 44px;
  }
  .help-crumbs li + li::before {
    content: '/';
    margin-right: 8px;
    color: var(--muted-foreground);
  }
  .help-crumbs [aria-current='page'] {
    color: var(--muted-foreground);
  }
  .help-article {
    line-height: 1.9;
  }
  .help-article > h2,
  .help-related > h2,
  .help-unresolved > h2 {
    margin-top: 40px;
    font-size: 20px;
  }
  .help-article p,
  .help-article ul,
  .help-article ol {
    max-width: 40em;
  }
  .help-article .help-lead {
    /* 40em of the body's size, not of this larger type. */
    max-width: min(40em, 640px);
    font-size: 18px;
    font-weight: 600;
  }
  .help-contact {
    margin-top: 32px;
  }
  @media (max-width: 599px) {
    .help-aims {
      grid-template-columns: minmax(0, 1fr);
    }
  }
</style>`

const searchForm = (lang: Lang, shown: string) => {
  const t = text[lang]
  return html`<form
    class="help-search"
    method="get"
    action="${HELP_PATH}"
    role="search"
  >
    <label class="visually-hidden" for="help-q">${t.searchLabel}</label>
    <input
      id="help-q"
      type="search"
      name="${HELP_QUERY_PARAM}"
      value="${shown}"
      maxlength="${MAX_QUERY_CHARS}"
      autocomplete="off"
    />
    <button class="button-primary" type="submit">${t.searchButton}</button>
  </form>`
}

const contactLine = (lang: Lang) => {
  const t = text[lang]
  return html`<p class="help-contact">
    ${t.contactBefore}<a href="/contact">${t.contactLink}</a>${t.contactAfter}
  </p>`
}

const breadcrumbs = (
  lang: Lang,
  trail: readonly Readonly<{ label: string; href?: string }>[],
) =>
  html`<nav class="help-crumbs" aria-label="${text[lang].breadcrumb}">
    <ol>
      ${trail.map((item) =>
        item.href
          ? html`<li><a href="${item.href}">${item.label}</a></li>`
          : html`<li aria-current="page">${item.label}</li>`,
      )}
    </ol>
  </nav>`

const entryLink = (entry: CatalogEntry, lang: Lang) =>
  html`<a href="${entry.path}">${entry.article[lang].title}</a>`

/** The lead of an article as text, for a list and for a page's description. */
export async function leadText(
  entry: CatalogEntry,
  lang: Lang,
  numbers: HelpNumbers = helpNumbers(),
) {
  return plainText(String(await entry.article[lang].lead(numbers)))
}

/**
 * The entrance: the search box, the aims in order, and for each the first
 * articles of its list.
 */
export function helpEntryPage(lang: Lang, url: URL, catalog: Catalog) {
  const t = text[lang]
  return pageShell({
    lang,
    title: t.title,
    url,
    width: 'wide',
    style: helpStyle,
    body: html`<h1>${t.title}</h1>
      ${searchForm(lang, '')}
      <div class="help-aims">
        ${HELP_AIMS.map(
          (aim) =>
            html`<section class="help-aim">
              <h2><a href="${helpAimPath(aim)}">${aimName(aim, lang)}</a></h2>
              <p class="help-aim-summary">${aimSummary(aim, lang)}</p>
              <ul class="help-links">
                ${articlesOfAim(catalog, aim)
                  .slice(0, ENTRANCE_ARTICLES)
                  .map((entry) => html`<li>${entryLink(entry, lang)}</li>`)}
              </ul>
            </section>`,
        )}
      </div>
      ${contactLine(lang)}`,
  })
}

/** The list of one aim's articles: each title with its first sentence. */
export async function helpAimPage(
  lang: Lang,
  url: URL,
  aim: HelpAim,
  catalog: Catalog,
  numbers: HelpNumbers = helpNumbers(),
) {
  const t = text[lang]
  const name = aimName(aim, lang)
  const entries = articlesOfAim(catalog, aim)
  const leads = await Promise.all(
    entries.map((entry) => leadText(entry, lang, numbers)),
  )
  return pageShell({
    lang,
    title: `${name} - ${t.title}`,
    url,
    width: 'wide',
    style: helpStyle,
    head: html`<meta name="description" content="${aimSummary(aim, lang)}" />`,
    body: html`${breadcrumbs(lang, [
        { label: t.title, href: HELP_PATH },
        { label: name },
      ])}
      <h1>${name}</h1>
      <ul class="help-entries">
        ${entries.map(
          (entry, i) =>
            html`<li>
              ${entryLink(entry, lang)}
              <p>${leads[i]}</p>
            </li>`,
        )}
        ${
          aim === 'safety'
            ? html`<li>
                <a href="${HELP_BOT_PATH}">${helpBotTitle(lang)}</a>
              </li>`
            : ''
        }
      </ul>
      ${contactLine(lang)}`,
  })
}

/** One article: the lead, the body, related articles and the way to ask. */
export async function helpArticlePage(
  lang: Lang,
  url: URL,
  entry: CatalogEntry,
  catalog: Catalog,
  numbers: HelpNumbers = helpNumbers(),
) {
  const t = text[lang]
  const article = entry.article[lang]
  const [lead, body, description] = await Promise.all([
    article.lead(numbers),
    article.body(numbers),
    leadText(entry, lang, numbers),
  ])
  const related = relatedOf(catalog, entry)
  return pageShell({
    lang,
    title: `${article.title} - ${t.title}`,
    url,
    width: 'wide',
    style: helpStyle,
    head: html`<meta name="description" content="${description}" />`,
    body: html`${breadcrumbs(lang, [
        { label: t.title, href: HELP_PATH },
        { label: aimName(entry.aim, lang), href: helpAimPath(entry.aim) },
        { label: article.title },
      ])}
      <h1>${article.title}</h1>
      <div class="help-article">
        <p class="help-lead">${lead}</p>
        ${body}
      </div>
      ${
        related.length > 0
          ? html`<section class="help-related">
              <h2>${t.related}</h2>
              <ul class="help-links">
                ${related.map((item) => html`<li>${entryLink(item, lang)}</li>`)}
              </ul>
            </section>`
          : ''
      }
      <section class="help-unresolved">
        <h2>${t.unresolved}</h2>
        <p><a href="/contact">${t.contactLink}</a>${t.unresolvedAfter}</p>
      </section>`,
  })
}

/** A word's own text, as it was written, with the marked stretches. */
const excerptHtml = (hit: SearchHit): Html => {
  const { cut, segments } = hit.excerpt
  return html`${cut.before ? '…' : ''}${segments.map((segment) =>
    segment.mark ? html`<mark>${segment.text}</mark>` : segment.text,
  )}${cut.after ? '…' : ''}`
}

/**
 * The answer to a search. The word is shown as text; nothing the reader typed
 * is markup. A page of results is not listed by search engines.
 */
export function helpSearchPage(
  lang: Lang,
  url: URL,
  query: Extract<SearchQuery, { kind: 'words' }>,
  hits: readonly SearchHit[],
) {
  const t = text[lang]
  return pageShell({
    lang,
    title: `${query.shown} - ${t.title}`,
    url,
    width: 'wide',
    style: helpStyle,
    head: raw('<meta name="robots" content="noindex" />'),
    body: html`<h1>${t.title}</h1>
      ${searchForm(lang, query.shown)}
      ${
        hits.length > 0
          ? html`<h2 class="help-aims-heading">
                ${t.count(query.shown, hits.length)}
              </h2>
              <ul class="help-entries">
                ${hits.map(
                  (hit) =>
                    html`<li>
                      ${entryLink(hit.entry, lang)}
                      <span class="help-aim-name"
                        >${aimName(hit.entry.aim, lang)}</span
                      >
                      <p lang="${hit.excerpt.lang}">${excerptHtml(hit)}</p>
                    </li>`,
                )}
              </ul>`
          : html`<p>${t.none(query.shown)}</p>
              <h2 class="help-aims-heading">${t.aims}</h2>
              <ul class="help-links">
                ${HELP_AIMS.map(
                  (aim) =>
                    html`<li>
                      <a href="${helpAimPath(aim)}">${aimName(aim, lang)}</a>
                    </li>`,
                )}
              </ul>`
      }
      ${contactLine(lang)}`,
  })
}
