import type { Lang } from '../site/i18n'
import type { TOOL_DESCRIPTIONS } from '../mcp/tools'
import { referrerOf, type OwnHosts } from './referrer'
import { searchTermOf } from './term'

/**
 * Everything the service counts (D-72), one case for each kind of event, with
 * exactly the fields that kind may carry (D-71). A field that is not here
 * cannot be passed: there is no place for an IP address, an email address, a
 * person's id or a cookie, and no free text but the help search word, which
 * `searchTermOf` checks. Ids are those of slides and communities.
 *
 * What each kind is, and where it is written, is in docs/dev/metrics.md.
 */
export type MetricEvent =
  // Putting slides up. `source` is where the version was sent from.
  | Readonly<{ name: 'upload_started'; source: UploadChannel }>
  | Readonly<{
      name: 'upload_finished'
      source: UploadChannel
      deckId: string
    }>
  | Readonly<{ name: 'upload_refused'; reason: UploadRefusalClass }>
  | Readonly<{
      name: 'deck_published'
      deckId: string
      /** Seconds from the version being ready to it being made public. */
      lagSeconds: number
    }>
  | Readonly<{
      name: 'deck_opened'
      via: 'page' | 'embed'
      deckId: string
      /** The Referer header as it came; only its host is kept. */
      referrer: string | null | undefined
    }>
  | Readonly<{ name: 'login_code_sent' }>
  | Readonly<{
      name: 'login_code_entered'
      outcome: 'accepted' | 'rejected'
    }>
  | Readonly<{ name: 'article_published'; deckId: string }>
  | Readonly<{ name: 'related_link_added'; deckId: string }>
  // A put version links to another slide.
  | Readonly<{ name: 'citation_made' }>
  | Readonly<{ name: 'oembed_served' }>
  | Readonly<{ name: 'community_created'; communityId: string }>
  | Readonly<{ name: 'community_followed'; communityId: string }>
  | Readonly<{ name: 'author_followed' }>
  | Readonly<{ name: 'export_downloaded'; what: ExportKind }>
  | Readonly<{ name: 'mcp_tool_called'; tool: ToolName }>
  // The help. `article` is `<aim>/<slug>` of a help article.
  | Readonly<{ name: 'help_search_empty'; term: string }>
  | Readonly<{ name: 'help_article_viewed'; article: string }>
  | Readonly<{ name: 'help_to_contact'; article: string }>
  | Readonly<{
      name: 'screen_error'
      kind: ErrorClass
      /** The pattern of the route that answered, never the address asked for. */
      screen: string
    }>

/** The name of a tool the MCP server offers. */
export type ToolName = keyof typeof TOOL_DESCRIPTIONS
/** Where a version was sent from. */
export type UploadChannel = 'browser' | 'mcp'
/** Why a start was refused (F40-AC6). */
export type UploadRefusalClass =
  | 'too_many_files'
  | 'file_too_large'
  | 'deployment_too_large'
  | 'author_bytes_exceeded'
  | 'daily_starts_exceeded'
  | 'deck_limit'
  | 'not_allowed'
export type ExportKind = 'slide' | 'article' | 'info' | 'account' | 'picture'
/** Maintenance is planned, not an error, so it is not counted. */
export type ErrorClass = 'not_found' | 'server_error'

export type EventName = MetricEvent['name']

/**
 * What the writer is given besides the event: the language the screen was in,
 * and the service's own hosts, to tell its own links from another site's.
 */
export type MetricContext = Readonly<{ lang: Lang | null; own: OwnHosts }>

/**
 * One row of the dataset, in the order the columns are fixed in
 * docs/dev/metrics.md: the event name is the only index (the sampling key);
 * the blobs are `detail`, `referrer`, `lang`, `subject` and `screen`, each an
 * empty string when the event has none; the one double is the event's value,
 * given only by events that have one.
 */
export type DataPoint = Readonly<{
  indexes: [string]
  blobs: [string, string, string, string, string]
  doubles: number[]
}>

/** The ids of slides and communities, and nothing else, may be a subject. */
const SUBJECT = /^[A-Za-z0-9_-]{1,64}$/
/** A closed word: a reason, a tool name, a kind. */
const WORD = /^[a-z0-9_]{1,40}$/
/** `<aim>/<slug>` of a help article. */
const ARTICLE = /^[a-z0-9-]{1,40}\/[a-z0-9-]{1,60}$/
/** The characters a route pattern is made of. */
const SCREEN = /^[\x21-\x7e]{1,80}$/

const row = (
  name: EventName,
  fields: Readonly<{
    detail?: string
    referrer?: string
    subject?: string
    screen?: string
    value?: number
  }>,
  context: MetricContext,
): DataPoint => ({
  indexes: [name],
  blobs: [
    fields.detail ?? '',
    fields.referrer ?? '',
    context.lang ?? '',
    fields.subject ?? '',
    fields.screen ?? '',
  ],
  doubles: fields.value === undefined ? [] : [fields.value],
})

const isSubject = (value: string) => SUBJECT.test(value)
const isWord = (value: string) => WORD.test(value)

/** A length of time in seconds that is a number and not absurd (a year). */
const isDuration = (seconds: number) =>
  Number.isFinite(seconds) && seconds >= 0 && seconds <= 366 * 24 * 60 * 60

type Builder<K extends EventName> = (
  event: Extract<MetricEvent, { name: K }>,
  context: MetricContext,
) => DataPoint | null

/** The row of an event that carries nothing but its name. */
const bare =
  <K extends EventName>(name: K): Builder<K> =>
  (_event, context) =>
    row(name, {}, context)

/** The row of an event that names one closed word, if it is one. */
const worded =
  <K extends EventName>(
    name: K,
    word: (event: Extract<MetricEvent, { name: K }>) => string,
  ): Builder<K> =>
  (event, context) =>
    isWord(word(event)) ? row(name, { detail: word(event) }, context) : null

/** The row of an event about one slide or community, if its id is one. */
const subjected =
  <K extends EventName>(
    name: K,
    id: (event: Extract<MetricEvent, { name: K }>) => string,
  ): Builder<K> =>
  (event, context) =>
    isSubject(id(event)) ? row(name, { subject: id(event) }, context) : null

/**
 * How each kind of event becomes a row. A new kind of event is a compile
 * error here until it has a builder.
 */
const BUILDERS: { [K in EventName]: Builder<K> } = {
  upload_started: worded('upload_started', (e) => e.source),
  upload_finished: (e, context) =>
    isWord(e.source) && isSubject(e.deckId)
      ? row('upload_finished', { detail: e.source, subject: e.deckId }, context)
      : null,
  upload_refused: worded('upload_refused', (e) => e.reason),
  deck_published: (e, context) =>
    isSubject(e.deckId) && isDuration(e.lagSeconds)
      ? row(
          'deck_published',
          { subject: e.deckId, value: Math.round(e.lagSeconds) },
          context,
        )
      : null,
  deck_opened: (e, context) =>
    isSubject(e.deckId)
      ? row(
          'deck_opened',
          {
            detail: e.via,
            subject: e.deckId,
            referrer: referrerOf(e.referrer, context.own),
          },
          context,
        )
      : null,
  login_code_sent: bare('login_code_sent'),
  login_code_entered: worded('login_code_entered', (e) => e.outcome),
  article_published: subjected('article_published', (e) => e.deckId),
  related_link_added: subjected('related_link_added', (e) => e.deckId),
  citation_made: bare('citation_made'),
  oembed_served: bare('oembed_served'),
  community_created: subjected('community_created', (e) => e.communityId),
  community_followed: subjected('community_followed', (e) => e.communityId),
  author_followed: bare('author_followed'),
  export_downloaded: worded('export_downloaded', (e) => e.what),
  mcp_tool_called: worded('mcp_tool_called', (e) => e.tool),
  help_search_empty: (e, context) => {
    const term = searchTermOf(e.term)
    return term === null
      ? null
      : row('help_search_empty', { detail: term }, context)
  },
  help_article_viewed: (e, context) =>
    ARTICLE.test(e.article)
      ? row('help_article_viewed', { detail: e.article }, context)
      : null,
  help_to_contact: (e, context) =>
    ARTICLE.test(e.article)
      ? row('help_to_contact', { detail: e.article }, context)
      : null,
  screen_error: (e, context) => {
    // `@` stands in a route pattern that names a handle; no `@` may be kept.
    const screen = e.screen.replaceAll('@', '~')
    return SCREEN.test(screen)
      ? row('screen_error', { detail: e.kind, screen }, context)
      : null
  },
}

/**
 * The row an event is written as, or null when the event is not one that may
 * be written: a field of the wrong form, such as an id that is not an id, an
 * article that names no article, or a search word that looks like an address.
 * A row is never made of a value that was not checked.
 */
export function dataPointOf(
  event: MetricEvent,
  context: MetricContext,
): DataPoint | null {
  const build = BUILDERS[event.name] as (
    event: MetricEvent,
    context: MetricContext,
  ) => DataPoint | null
  return build(event, context)
}
