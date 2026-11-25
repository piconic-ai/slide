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
 * read.
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
    if (chosen !== link.kind)
      changes.push({ id: link.id, url: link.url, kind: chosen })
  }
  return { ok: true, changes }
}
