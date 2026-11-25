import { parseTitle } from '../links/link'

/**
 * Who asks to rename an event. An operator may rename any. A signed-in
 * person may rename the events of the communities they run, which another
 * piece of work adds (docs/features/f30-communities.md, F29-AC22): it passes
 * the people who run a community the event is in.
 */
export type EventRenamer =
  | Readonly<{ kind: 'operator' }>
  | Readonly<{ kind: 'person'; userId: string }>

/** Whether the one who asks may rename the event. */
export const mayRenameEvent = (
  renamer: EventRenamer,
  /** The people who run a community the event is in; none for now. */
  communityAdmins: ReadonlySet<string>,
): boolean => renamer.kind === 'operator' || communityAdmins.has(renamer.userId)

/**
 * The event an operator names: its number, the path of its page, or the
 * page's URL on this service. Anything else names nothing.
 */
export function parseEventTarget(
  input: unknown,
  publicOrigin: string,
): number | null {
  if (typeof input !== 'string') return null
  const text = input.trim()
  let path = text
  if (/^https?:\/\//iu.test(text)) {
    let url: URL
    try {
      url = new URL(text)
    } catch {
      return null
    }
    if (url.origin !== new URL(publicOrigin).origin) return null
    path = url.pathname
  }
  const match = /^(?:\/events\/)?([1-9][0-9]{0,15})\/?$/u.exec(path)
  return match ? Number(match[1]) : null
}

/**
 * The name an operator gives an event, under the rules of a link's title; it
 * cannot be left empty.
 */
export const parseEventName = (input: unknown): string | null => {
  const parsed = parseTitle(input)
  return parsed.ok ? parsed.title : null
}
