import { z } from 'zod'
import { bindingRequestSchema } from '../decks/binding'

export const oauthIntentSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('login') }),
  z.strictObject({ kind: z.literal('bind'), request: bindingRequestSchema }),
])
export type OAuthIntent = z.infer<typeof oauthIntentSchema>
export const githubUserSchema = z.object({
  id: z.number().int().positive(),
  login: z.string().min(1).max(39),
})
export function base64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '')
}
