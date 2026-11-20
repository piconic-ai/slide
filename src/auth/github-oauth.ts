import { z } from 'zod'

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
