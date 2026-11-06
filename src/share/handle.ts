import { z } from 'zod'

/**
 * A handle as share URLs spell it: a GitHub login, lowercased. GitHub logins
 * compare case-insensitively, so one lowercase spelling names each owner.
 */
export const handleSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]{0,38}$/, 'Invalid handle')
  .brand<'Handle'>()
export type Handle = z.infer<typeof handleSchema>

/** The handle a GitHub login gives, or null when it cannot be one. */
export function handleOfLogin(login: string): Handle | null {
  const parsed = handleSchema.safeParse(login.toLowerCase())
  return parsed.success ? parsed.data : null
}
