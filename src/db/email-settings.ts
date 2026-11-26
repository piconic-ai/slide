import { parseEmailCrypto, type EmailCrypto } from './email-cipher'

/** The three secrets of the email encryption, as the environment holds them. */
export type EmailSettings = Readonly<{
  EMAIL_CIPHER_KEYS?: string | undefined
  EMAIL_CIPHER_CURRENT?: string | undefined
  EMAIL_LOOKUP_KEY?: string | undefined
}>

/** What the environment's secrets say; off when none is set (D-08). */
export const emailCryptoOf = (source: EmailSettings): EmailCrypto =>
  parseEmailCrypto({
    keys: source.EMAIL_CIPHER_KEYS,
    current: source.EMAIL_CIPHER_CURRENT,
    lookupKey: source.EMAIL_LOOKUP_KEY,
  })
