import { z } from 'zod'

const MAX_LENGTH = 254

const addressSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(MAX_LENGTH)
  .pipe(z.email())
  .brand<'EmailAddress'>()

/** An email address in the one spelling the service compares and stores. */
export type EmailAddress = z.infer<typeof addressSchema>

/**
 * The address as the service spells it: trimmed and lowercased, nothing else.
 * `a+b@example.com` stays a different address from `a@example.com`, so the
 * operator invites exactly the address a person will type. Null when the text
 * is not an address.
 */
export function normalizeAddress(value: unknown): EmailAddress | null {
  const parsed = addressSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}
