import { z } from 'zod'

export const reportReasonSchema = z.enum(['nuisance', 'rights', 'other'])
export type ReportReason = z.infer<typeof reportReasonSchema>

const reportSchema = z.object({
  reason: reportReasonSchema,
  note: z.string().trim().max(500).default(''),
})
export type Report = z.infer<typeof reportSchema>

export type ParseReportResult =
  | Readonly<{ kind: 'valid' } & Report>
  | Readonly<{ kind: 'invalid_reason' }>
  | Readonly<{ kind: 'invalid_note' }>
  | Readonly<{ kind: 'note_too_long' }>
  | Readonly<{ kind: 'note_required' }>

export function parseReport(
  input: Readonly<{ reason?: unknown; note?: unknown }>,
): ParseReportResult {
  const reason = reportReasonSchema.safeParse(input.reason)
  if (!reason.success) return { kind: 'invalid_reason' }
  if (input.note !== undefined && typeof input.note !== 'string')
    return { kind: 'invalid_note' }
  const note = reportSchema.shape.note.safeParse(input.note)
  if (!note.success) return { kind: 'note_too_long' }
  if (reason.data === 'other' && note.data === '')
    return { kind: 'note_required' }
  return { kind: 'valid', reason: reason.data, note: note.data }
}
