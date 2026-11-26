import { expect, test } from 'vitest'
import { dataPointOf, type MetricEvent, type MetricContext } from './events'
import { ownHostsOf } from './referrer'

const context: MetricContext = {
  lang: 'ja',
  own: ownHostsOf({
    publicOrigin: 'https://slide.example',
    operatorOrigin: 'https://admin.slide.example',
    contentOrigin: 'https://content.example',
  }),
}
const DECK = '0b0c8f2e-3f0a-4bd1-9d86-1d6b1d5a1a11'

/** One valid example of every kind of event. */
const examples: readonly MetricEvent[] = [
  { name: 'upload_started', source: 'browser' },
  { name: 'upload_finished', source: 'mcp', deckId: DECK },
  { name: 'upload_refused', reason: 'file_too_large' },
  { name: 'deck_published', deckId: DECK, lagSeconds: 90 },
  {
    name: 'deck_opened',
    via: 'page',
    deckId: DECK,
    referrer: 'https://news.example/a?b=c',
  },
  { name: 'login_code_sent' },
  { name: 'login_code_entered', outcome: 'accepted' },
  { name: 'article_published', deckId: DECK },
  { name: 'related_link_added', deckId: DECK },
  { name: 'citation_made' },
  { name: 'oembed_served' },
  { name: 'community_created', communityId: '4503599627370495' },
  { name: 'community_followed', communityId: '12' },
  { name: 'author_followed' },
  { name: 'export_downloaded', what: 'slide' },
  { name: 'mcp_tool_called', tool: 'put_slide' },
  { name: 'help_search_empty', term: 'ぜんぜん見つからない語' },
  { name: 'help_article_viewed', article: 'start/first-slide' },
  { name: 'help_to_contact', article: 'start/first-slide' },
  { name: 'screen_error', kind: 'server_error', screen: '/my/slides/:deck' },
]

test('F40-AC15: Given every kind of event, When it is made a row, Then the name is the one index and no value is of a form that could identify a person', () => {
  for (const event of examples) {
    const point = dataPointOf(event, context)
    expect(point, event.name).not.toBeNull()
    expect(point?.indexes).toEqual([event.name])
    for (const text of [...(point?.indexes ?? []), ...(point?.blobs ?? [])]) {
      expect(text).not.toMatch(/@/)
      expect(text).not.toMatch(/\d{1,3}(\.\d{1,3}){3}/)
      expect(text).not.toMatch(/:.*:/)
      expect(text).not.toMatch(/https?:/)
    }
  }
})

test('F40-AC15: Given every kind of event, When it is made a row, Then it stays within the dataset limits: one index of 96 bytes, 20 blobs, 16 KB of blobs, 20 doubles', () => {
  for (const event of examples) {
    const point = dataPointOf(event, context)
    expect(point?.indexes).toHaveLength(1)
    expect(
      new TextEncoder().encode(point?.indexes[0]).length,
    ).toBeLessThanOrEqual(96)
    expect(point?.blobs.length).toBeLessThanOrEqual(20)
    expect(
      new TextEncoder().encode((point?.blobs ?? []).join('')).length,
    ).toBeLessThan(16 * 1024)
    expect(point?.doubles.length).toBeLessThanOrEqual(20)
  }
})

test('F40-AC10: Given an opened deck with a long referrer, When it is made a row, Then only the host name is in the row, with the slide, the view and the language', () => {
  expect(
    dataPointOf(
      {
        name: 'deck_opened',
        via: 'embed',
        deckId: DECK,
        referrer: 'https://news.example/a/b/c?token=SECRET#x',
      },
      context,
    ),
  ).toEqual({
    indexes: ['deck_opened'],
    blobs: ['embed', 'news.example', 'ja', DECK, ''],
    doubles: [],
  })
})

test('F40-AC10: Given a move from the service itself, When the opened deck is made a row, Then the referrer is internal', () => {
  const point = dataPointOf(
    {
      name: 'deck_opened',
      via: 'page',
      deckId: DECK,
      referrer: 'https://slide.example/@a/b',
    },
    context,
  )
  expect(point?.blobs[1]).toBe('internal')
})

test('F40-AC7: Given a version published after 90.4 seconds, When it is made a row, Then the wait is the one double, rounded to whole seconds', () => {
  expect(
    dataPointOf(
      { name: 'deck_published', deckId: DECK, lagSeconds: 90.4 },
      context,
    )?.doubles,
  ).toEqual([90])
})

test.each([Number.NaN, Number.POSITIVE_INFINITY, -1, 400 * 24 * 3600])(
  'F40-AC7: Given the impossible wait %s, When a published deck is made a row, Then it is not written',
  (lagSeconds) => {
    expect(
      dataPointOf(
        { name: 'deck_published', deckId: DECK, lagSeconds },
        context,
      ),
    ).toBeNull()
  },
)

test('F40-AC12: Given a search word of 80 characters that found nothing, When it is made a row, Then 50 characters are kept', () => {
  const point = dataPointOf(
    { name: 'help_search_empty', term: 'あ'.repeat(80) },
    context,
  )
  expect([...(point?.blobs[0] ?? '')]).toHaveLength(50)
})

test.each([
  'me@example.com',
  '198.51.100.7',
  'https://example.com',
  // Built here so that the file holds no string a secret scanner would take.
  ['sk', 'live', '0123456789abcdefghijklmnop'].join('_'),
])(
  'F40-AC15: Given the search word %s that is an address or a secret, When it is made a row, Then it is not written',
  (term) => {
    expect(dataPointOf({ name: 'help_search_empty', term }, context)).toBeNull()
  },
)

test('F40-AC13: Given an article id that names no article, When a view or a contact is made a row, Then it is not written', () => {
  for (const article of [
    '',
    'x',
    'a/b/c',
    'a@b.example/c',
    'Start/First',
    'a/b?q=1',
  ]) {
    expect(
      dataPointOf({ name: 'help_article_viewed', article }, context),
    ).toBeNull()
    expect(
      dataPointOf({ name: 'help_to_contact', article }, context),
    ).toBeNull()
  }
})

test.each([
  '',
  'has space',
  'a@b.example',
  'x'.repeat(65),
  '../etc',
  'ＡＢ',
  '1.2.3.4',
])(
  'F40-AC15: Given the subject %j that is no id, When events about slides and communities are made rows, Then they are not written',
  (id) => {
    expect(
      dataPointOf(
        { name: 'upload_finished', source: 'browser', deckId: id },
        context,
      ),
    ).toBeNull()
    expect(
      dataPointOf(
        { name: 'deck_published', deckId: id, lagSeconds: 1 },
        context,
      ),
    ).toBeNull()
    expect(
      dataPointOf(
        { name: 'deck_opened', via: 'page', deckId: id, referrer: null },
        context,
      ),
    ).toBeNull()
    expect(
      dataPointOf({ name: 'article_published', deckId: id }, context),
    ).toBeNull()
    expect(
      dataPointOf({ name: 'related_link_added', deckId: id }, context),
    ).toBeNull()
    expect(
      dataPointOf({ name: 'community_created', communityId: id }, context),
    ).toBeNull()
    expect(
      dataPointOf({ name: 'community_followed', communityId: id }, context),
    ).toBeNull()
  },
)

test('F40-AC15: Given a word from outside the closed words, When it is made a row, Then it is not written even if a caller forced the type', () => {
  const forced = (event: object) => dataPointOf(event as MetricEvent, context)
  expect(forced({ name: 'upload_refused', reason: 'a@b.example' })).toBeNull()
  expect(forced({ name: 'mcp_tool_called', tool: 'Put Slide' })).toBeNull()
  expect(forced({ name: 'export_downloaded', what: 'x'.repeat(41) })).toBeNull()
})

test('F40-AC14: Given an error on a route that names a handle, When it is made a row, Then no @ is kept, and a screen that is not a route pattern is not written', () => {
  expect(
    dataPointOf(
      { name: 'screen_error', kind: 'not_found', screen: '/@:handle/:slug' },
      context,
    )?.blobs,
  ).toEqual(['not_found', '', 'ja', '', '/~:handle/:slug'])
  expect(
    dataPointOf(
      { name: 'screen_error', kind: 'not_found', screen: '' },
      context,
    ),
  ).toBeNull()
  expect(
    dataPointOf(
      { name: 'screen_error', kind: 'not_found', screen: '/a b' },
      context,
    ),
  ).toBeNull()
  expect(
    dataPointOf(
      {
        name: 'screen_error',
        kind: 'not_found',
        screen: `/${'x'.repeat(100)}`,
      },
      context,
    ),
  ).toBeNull()
})

test('Given a screen with no known language, When an event is made a row, Then the language is empty', () => {
  expect(
    dataPointOf({ name: 'login_code_sent' }, { ...context, lang: null })?.blobs,
  ).toEqual(['', '', '', '', ''])
})
