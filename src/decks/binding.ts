import { z } from 'zod'

// Branch names follow git check-ref-format closely enough to reject paths,
// control characters, and ref syntax that GitHub would not report in OIDC.
const branchSchema = z
  .string()
  .min(1)
  .max(200)
  .refine(
    (branch) =>
      /^[A-Za-z0-9._\/-]+$/.test(branch) &&
      !/(^|\/)\.|\.\.|\/\/|\/$|\.lock(\/|$)|^-/.test(branch),
    { message: 'Invalid branch name' },
  )

export const deckIdSchema = z
  .string()
  .regex(/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/, 'Invalid deck ID')
  .brand<'DeckId'>()
export type DeckId = z.infer<typeof deckIdSchema>

export const repositoryNameSchema = z
  .string()
  .regex(
    /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9._-]{1,100}$/,
    'Use owner/name',
  )
  .refine((name) => !/\/\.{1,2}$/.test(name), { message: 'Use owner/name' })

/** Allowed refs are stored fully qualified, deduplicated, and sorted. */
export const allowedRefsSchema = z
  .array(branchSchema)
  .min(1)
  .max(10)
  .transform((branches) =>
    [...new Set(branches.map((branch) => `refs/heads/${branch}`))].sort(),
  )

export const bindingRequestSchema = z.strictObject({
  deck: deckIdSchema,
  repository: repositoryNameSchema,
  branches: allowedRefsSchema,
})
export type BindingRequest = z.infer<typeof bindingRequestSchema>

export const storedRefsSchema = z
  .string()
  .transform((value, context) => {
    try {
      return JSON.parse(value) as unknown
    } catch {
      context.addIssue({ code: 'custom', message: 'Invalid stored refs' })
      return z.NEVER
    }
  })
  .pipe(z.array(z.string().startsWith('refs/heads/')).min(1))

export const githubRepositorySchema = z.object({
  id: z.number().int().positive(),
  full_name: z.string(),
  owner: z.object({ id: z.number().int().positive() }),
  permissions: z.object({ admin: z.boolean() }).optional(),
})
export type GitHubRepository = z.infer<typeof githubRepositorySchema>

export type BindingDecision =
  | {
      readonly ok: true
      readonly repositoryId: string
      readonly repositoryOwnerId: string
      readonly fullName: string
    }
  | { readonly ok: false; readonly reason: 'not_admin' | 'not_found' }

/**
 * Accepts a repository only when the signed-in user administers it. GitHub
 * omits permissions for repositories the app cannot see, which is treated as
 * not found so the owner can install the app on that repository.
 */
export function bindingDecision(
  repository: GitHubRepository | null,
): BindingDecision {
  if (!repository?.permissions) return { ok: false, reason: 'not_found' }
  if (!repository.permissions.admin) return { ok: false, reason: 'not_admin' }
  return {
    ok: true,
    repositoryId: String(repository.id),
    repositoryOwnerId: String(repository.owner.id),
    fullName: repository.full_name,
  }
}
