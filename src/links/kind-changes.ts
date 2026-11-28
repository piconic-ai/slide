import { isEventAddress } from '../events/event-url'
import { LINK_KINDS, type LinkKind } from './link'

/** A link whose kind the author chose again. */
export type KindChange = Readonly<{ id: string; url: string; kind: LinkKind }>

export type KindChanges =
  | Readonly<{ ok: true; changes: readonly KindChange[] }>
  | Readonly<{ ok: false }>

const isKind = (value: unknown): value is LinkKind =>
  LINK_KINDS.some((kind) => kind === value)

/**
 * The links whose kind the form `kind-<link id>` chose differently from the
 * one they have. A link the form leaves out keeps its kind; a field that is
 * not one of the kinds refuses the whole form. Fields of other links are not
 * read. An address shaped like an event stays an event whatever is chosen
 * (F45-AC37): choosing another kind for it changes nothing, and choosing any
 * kind for one kept without its event makes it an event.
 */
export function kindChanges(
  links: readonly Readonly<{ id: string; url: string; kind: LinkKind }>[],
  form: Readonly<Record<string, unknown>>,
): KindChanges {
  const changes: KindChange[] = []
  for (const link of links) {
    const chosen = form[`kind-${link.id}`]
    if (chosen === undefined) continue
    if (!isKind(chosen)) return { ok: false }
    const kind = isEventAddress(link.url) ? 'event' : chosen
    if (kind !== link.kind) changes.push({ id: link.id, url: link.url, kind })
  }
  return { ok: true, changes }
}
