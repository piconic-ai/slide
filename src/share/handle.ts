import { z } from 'zod'

/**
 * A handle as share URLs spell it: lowercase letters, digits and hyphens.
 * The person chooses it at their first sign-in (see src/auth/handle-rules.ts).
 */
export const handleSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]{0,38}$/, 'Invalid handle')
  .brand<'Handle'>()
export type Handle = z.infer<typeof handleSchema>
