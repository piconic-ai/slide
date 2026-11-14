import { z } from 'zod'

/** Players of other slide services the viewer may frame. */
const PLAYERS = [
  /^https:\/\/speakerdeck\.com\/player\/[0-9a-f]{32}$/,
  /^https:\/\/www\.docswell\.com\/slide\/[A-Z0-9]{4,12}\/embed$/,
] as const

/**
 * The player address when it is one the viewer may frame. Anything else,
 * including another page of the same service, is not framed.
 */
export const playerUrlOf = (value: string | null): string | null =>
  value !== null && PLAYERS.some((player) => player.test(value)) ? value : null

/** A link readers may follow: https only, so no script or local address. */
export const linkSchema = z
  .string()
  .max(500)
  .refine((value) => {
    try {
      return new URL(value).protocol === 'https:'
    } catch {
      return false
    }
  })

/** A hashtag without its number sign. */
export const hashtagSchema = z.string().regex(/^[\p{L}\p{N}_]{1,50}$/u)

const DATE = /^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$/

/** Whether the text names a day its month has; 2026-02-31 does not. */
function isCalendarDate(text: string) {
  if (!DATE.test(text)) return false
  const date = new Date(`${text}T00:00:00Z`)
  return date.toISOString().slice(0, 10) === text
}

/** A calendar date as YYYY-MM-DD. */
export const heldOnSchema = z.string().refine(isCalendarDate)

/** A talk at an event: a public deck here, or slides on another service. */
export type Talk =
  | Readonly<{
      kind: 'deck'
      handle: string
      slug: string
      title: string | null
      deploymentId: string
    }>
  | Readonly<{
      kind: 'external'
      title: string
      speaker: string | null
      url: string
      /** That service's player, when the viewer may frame it. */
      playerUrl: string | null
    }>

/** One stored talk, with its deck's public state where it is a deck here. */
export type TalkRow = Readonly<{
  deckId: string | null
  handle: string | null
  deckTitle: string | null
  deploymentId: string | null
  title: string | null
  speaker: string | null
  url: string | null
  embedUrl: string | null
}>

/**
 * The talk a row describes, or null when readers should not see it: a deck
 * that is not public, or slides elsewhere without a title or a safe link.
 */
export function talkOf(row: TalkRow): Talk | null {
  if (row.deckId !== null)
    return row.handle !== null && row.deploymentId !== null
      ? {
          kind: 'deck',
          handle: row.handle,
          slug: row.deckId,
          title: row.deckTitle,
          deploymentId: row.deploymentId,
        }
      : null
  const url = linkSchema.safeParse(row.url)
  const title = row.title?.trim()
  if (!url.success || !title) return null
  return {
    kind: 'external',
    title,
    speaker: row.speaker?.trim() || null,
    url: url.data,
    playerUrl: playerUrlOf(row.embedUrl),
  }
}

/** The event's date in the reader's language. */
export const heldOnText = (heldOn: string, lang: string) =>
  new Intl.DateTimeFormat(lang, { dateStyle: 'long', timeZone: 'UTC' }).format(
    new Date(`${heldOn}T00:00:00Z`),
  )
