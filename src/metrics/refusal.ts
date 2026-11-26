import type { UploadRefusalClass } from './events'

const REASONS: ReadonlySet<string> = new Set<UploadRefusalClass>([
  'too_many_files',
  'file_too_large',
  'deployment_too_large',
  'author_bytes_exceeded',
  'daily_starts_exceeded',
  'deck_limit',
  'not_allowed',
])

/**
 * The class of refusal an upload start threw, or null when what it threw is
 * not a refusal worth counting: a start that is busy or that clashes with
 * another is to be tried again, and is no refusal (F40-AC6). The thrown
 * value is read for its `code` and, for a refused start, its `reason` only.
 */
export function refusalClassOf(thrown: unknown): UploadRefusalClass | null {
  if (typeof thrown !== 'object' || thrown === null) return null
  const { code, details } = thrown as { code?: unknown; details?: unknown }
  if (code === 'deck_limit') return 'deck_limit'
  if (code !== 'start_rejected') return null
  const reason = (details as { reason?: unknown } | null | undefined)?.reason
  return typeof reason === 'string' && REASONS.has(reason)
    ? (reason as UploadRefusalClass)
    : null
}
