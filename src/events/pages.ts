import { html } from 'hono/html'
import { messages, type Lang } from '../site/i18n'
import { deckFrame, deckHref, type CitedView } from '../reactions/pages'
import type { Shortened } from '../reactions/citing'
import { heldOnText } from './talk'

/** A talk as the viewer shows it. */
export type TalkView =
  | Readonly<{ kind: 'deck'; deck: CitedView }>
  | Readonly<{
      kind: 'external'
      title: string
      speaker: string | null
      url: string
      playerUrl: string | null
    }>

/** An event the deck was presented at, with a few of its other talks. */
export type EventView = Readonly<{
  name: string
  url: string
  hashtag: string | null
  heldOn: string
  community: Readonly<{ name: string; url: string }>
  talks: Shortened<TalkView>
}>

const text = messages({
  ja: {
    presentedAt: '発表したイベント',
    otherTalks: (event: string) => `${event} のほかの発表`,
    more: (count: number) => `ほか ${count} 件`,
  },
  en: {
    presentedAt: 'Presented at',
    otherTalks: (event: string) => `Other talks at ${event}`,
    more: (count: number) => `${count} more`,
  },
})

/** The origins of the talks the viewer frames: decks here and players. */
export const talkOriginsOf = (events: readonly EventView[]): string[] => [
  ...new Set(
    events.flatMap((event) =>
      event.talks.shown.flatMap((talk) => {
        const framed =
          talk.kind === 'deck' ? talk.deck.contentUrl : talk.playerUrl
        return framed ? [new URL(framed).origin] : []
      }),
    ),
  ),
]

const outside = (href: string, label: string) =>
  html`<a href="${href}" target="_blank" rel="noopener noreferrer">${label}</a>`

/**
 * Where the deck was presented: the community, the event, its date and its
 * hashtag. Shown beside the author, so a reader sees the occasion at once.
 */
export const eventLines = (events: readonly EventView[], lang: Lang) =>
  events.length
    ? html`<ul class="events" aria-label="${text[lang].presentedAt}">
        ${events.map(
          (event) =>
            html`<li>
              <span class="community"
                >${outside(event.community.url, event.community.name)}</span
              >
              ${outside(event.url, event.name)}
              <time datetime="${event.heldOn}"
                >${heldOnText(event.heldOn, lang)}</time
              >
              ${
                event.hashtag
                  ? outside(
                      `https://x.com/hashtag/${encodeURIComponent(event.hashtag)}`,
                      `#${event.hashtag}`,
                    )
                  : ''
              }
            </li>`,
        )}
      </ul>`
    : ''

/**
 * Slides on another service. Its player runs in a frame that cannot move or
 * script the viewer; without a known player the talk is a link only.
 */
const externalTalk = (talk: Extract<TalkView, { kind: 'external' }>) =>
  html`${
      talk.playerUrl
        ? html`<div class="mini">
            <iframe
              src="${talk.playerUrl}"
              title="${talk.title}"
              loading="lazy"
              sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox"
              referrerpolicy="no-referrer"
              allow="fullscreen"
            ></iframe>
          </div>`
        : ''
    }
    <p>
      ${outside(talk.url, talk.title)}
      ${talk.speaker ? html`<small>${talk.speaker}</small>` : ''}
    </p>`

const talkItem = (talk: TalkView) => {
  if (talk.kind === 'external') return html`<li>${externalTalk(talk)}</li>`
  const href = deckHref(talk.deck)
  return href ? html`<li>${deckFrame(talk.deck, href)}</li>` : ''
}

/** The other talks of each event, shown under the deck as running slides. */
export const eventSections = (events: readonly EventView[], lang: Lang) =>
  events.map((event) =>
    event.talks.shown.length
      ? html`<section class="cites talks">
          <h2>${text[lang].otherTalks(event.name)}</h2>
          <ul>
            ${event.talks.shown.map(talkItem)}
          </ul>
          ${
            event.talks.more > 0
              ? html`<p class="more">${text[lang].more(event.talks.more)}</p>`
              : ''
          }
        </section>`
      : '',
  )
