import { z } from 'zod'
import { startRejections, type StartRejection } from '../uploads/rejections'

/** Why an upload a tool started did not go through. */
export type UploadRefusalCode =
  | StartRejection
  | 'not_allowed'
  | 'upload_busy'
  | 'deck_limit'
  | 'credential_expired'
  | 'files_missing'
  | 'upload_failed'

export type UploadRefusal = Readonly<{
  code: UploadRefusalCode
  message: string
}>

const refusalSchema = z.object({
  status: z.number(),
  message: z.string(),
  code: z.string().optional(),
  details: z.record(z.string(), z.unknown()).optional(),
})

const PASSED_ON = new Set<string>([
  'upload_busy',
  'deck_limit',
  'credential_expired',
])
const isRejection = (value: unknown): value is StartRejection =>
  (startRejections as readonly unknown[]).includes(value)

const LIMIT_MESSAGES: Readonly<Record<StartRejection, string>> = {
  too_many_files: 'The version has more files than one version may hold.',
  file_too_large: 'A file is larger than one file may be.',
  deployment_too_large:
    'The files together are larger than one version may be.',
  author_bytes_exceeded:
    'The author’s stored slides would exceed their storage limit. Deleting old slides in the browser frees space.',
  daily_starts_exceeded:
    'The author has started as many uploads as are allowed in 24 hours. Try again later.',
}

function missingMessage(missing: unknown): string {
  const paths = z.array(z.string()).safeParse(missing)
  const named = paths.success ? paths.data.slice(0, 20).join(', ') : ''
  return `Not every file has arrived${named ? `: ${named}` : ''}. Send the missing files to their URLs, then call finish_upload again.`
}

/**
 * Reads the refusal of an upload, thrown by the start or answered by the
 * upload routes, into a code and a sentence an agent can pass on. Anything
 * unrecognized is a plain failure; null when the value is no refusal.
 */
export function uploadRefusal(input: unknown): UploadRefusal | null {
  const parsed = refusalSchema.safeParse(input)
  if (!parsed.success) return null
  const { status, message, code, details } = parsed.data
  const reason = details?.reason
  if (isRejection(reason))
    return { code: reason, message: LIMIT_MESSAGES[reason] }
  if (code !== undefined && PASSED_ON.has(code))
    return { code: code as UploadRefusalCode, message }
  if (code === 'files_missing')
    return { code, message: missingMessage(details?.missing) }
  // The upload routes answer an unknown, wrong or expired credential alike.
  if (status === 401)
    return {
      code: 'credential_expired',
      message:
        'The upload credential is wrong or has expired. Call begin_upload again for a new one.',
    }
  if (status === 403)
    return {
      code: 'not_allowed',
      message:
        'Uploads for this account or slide are not accepted: the account is not a registered author, is suspended, or the slide is being deleted.',
    }
  return { code: 'upload_failed', message }
}
