import type { LegalText } from './document'
import { isDraft } from './document'
import { externalTransmission } from './texts/external-transmission'
import { privacy } from './texts/privacy'
import { terms } from './texts/terms'

/** The three texts the service carries. */
export const LEGAL_TEXT_KINDS = ['terms', 'privacy', 'external'] as const
export type LegalTextKind = (typeof LEGAL_TEXT_KINDS)[number]

/** Where each text is read (D-23). All three are served during maintenance. */
export const LEGAL_TEXT_PATHS: Readonly<Record<LegalTextKind, string>> = {
  terms: '/terms',
  privacy: '/privacy',
  external: '/privacy/external',
}

/** The texts as they are carried now. Each one is replaced on its own. */
export const LEGAL_TEXTS: Readonly<Record<LegalTextKind, LegalText>> = {
  terms,
  privacy,
  external: externalTransmission,
}

/**
 * The paths of the texts that are finished, so search engines may list them.
 * A draft is left out (D-21); each text switches on its own date (F34-AC12).
 */
export const indexableLegalPaths = (
  texts: Readonly<Record<LegalTextKind, LegalText>> = LEGAL_TEXTS,
): ReadonlySet<string> =>
  new Set(
    LEGAL_TEXT_KINDS.filter((kind) => !isDraft(texts[kind])).map(
      (kind) => LEGAL_TEXT_PATHS[kind],
    ),
  )
