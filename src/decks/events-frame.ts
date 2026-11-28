import { html } from 'hono/html'
import type { DeckEvent } from '../events/deck-event'
import { eventNameOf } from '../links/link-heading'
import { linkPagePath } from '../links/link-address'
import { messages, type Lang } from '../site/i18n'

const text = messages({
  ja: {
    heading: '発表したイベント',
    none: '関連リンクに、種類が「イベント」のリンクを足すと、そのイベントがここに並びます。',
    note: '関連リンクから決まるので、ここでは選べません。イベントから外すときは、関連リンクを外すか、種類を変えてください。',
  },
  en: {
    heading: 'Events presented at',
    none: 'Add a related link of the kind event, and its event is listed here.',
    note: 'They come from the related links, so they are not chosen here. To leave an event, remove its related link or change its kind.',
  },
})

/**
 * Where the page of one slide lists, under the related links, the events
 * the slides were presented at, as the related links decide them, each with
 * its community. Nothing is chosen here; with none, one sentence says where
 * they come from.
 */
export const presentedEventsFrame = (
  events: readonly DeckEvent[],
  lang: Lang,
) => {
  const t = text[lang]
  return html`<section class="panel" data-deck-frame="events" id="events">
    <h2>${t.heading}</h2>
    ${
      events.length === 0
        ? html`<p class="field-note">${t.none}</p>`
        : html`<ul class="link-rows">
              ${events.map(
                (event) =>
                  html`<li class="link-row">
                    <span class="link-row-body">
                      <a
                        class="link-row-title"
                        href="${linkPagePath(event.url)}"
                        >${eventNameOf(event, lang)}</a
                      >
                      ${
                        event.community
                          ? html`<span class="link-row-site"
                              >${event.community.name}</span
                            >`
                          : ''
                      }
                    </span>
                  </li>`,
              )}
            </ul>
            <p class="field-note">${t.note}</p>`
    }
  </section>`
}
