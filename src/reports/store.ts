import { count, desc, eq, isNull, max } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { z } from 'zod'
import { accounts, decks, reports } from '../db/schema'
import { deckSlugSchema, type DeckId } from '../decks/binding'
import { reportReasonSchema, type Report } from './report'

const REPORTED_DECK_LIMIT = 50

const listedReportSchema = z.object({
  reason: reportReasonSchema,
  note: z.string(),
  sharePath: z.string(),
  updatedAt: z.number().int(),
})
const reportedDeckSchema = z.object({
  handle: z.string(),
  slug: deckSlugSchema,
  reporters: z.number().int().positive(),
  lastReportedAt: z.number().int(),
  reports: z.array(listedReportSchema),
})
export type ReportedDeck = z.infer<typeof reportedDeckSchema>

const reportedRowSchema = reportedDeckSchema.omit({ reports: true }).extend({
  deckId: z.string(),
  report: listedReportSchema,
})

export async function listReportedDecks(
  database: D1Database,
): Promise<ReportedDeck[]> {
  const db = drizzle(database)
  const latest = db
    .select({
      deckId: decks.id,
      handle: accounts.handle,
      slug: decks.slug,
      reporters: count().as('reporters'),
      lastReportedAt: max(reports.updated_at).as('last_reported_at'),
    })
    .from(decks)
    .innerJoin(accounts, eq(accounts.user_id, decks.owner_user_id))
    .innerJoin(reports, eq(reports.deck_id, decks.id))
    .where(isNull(decks.deleted_at))
    .groupBy(decks.id)
    .orderBy(desc(max(reports.updated_at)), decks.slug, decks.id)
    .limit(REPORTED_DECK_LIMIT)
    .as('latest')
  const rows = await db
    .select({
      deckId: latest.deckId,
      handle: latest.handle,
      slug: latest.slug,
      reporters: latest.reporters,
      lastReportedAt: latest.lastReportedAt,
      report: {
        reason: reports.reason,
        note: reports.note,
        sharePath: reports.share_path,
        updatedAt: reports.updated_at,
      },
    })
    .from(latest)
    .innerJoin(reports, eq(reports.deck_id, latest.deckId))
    .orderBy(
      desc(latest.lastReportedAt),
      latest.slug,
      latest.deckId,
      desc(reports.updated_at),
    )
  const byDeck = new Map<string, ReportedDeck>()
  for (const row of rows) {
    const { deckId, report, ...deck } = reportedRowSchema.parse(row)
    const existing = byDeck.get(deckId)
    if (existing) existing.reports.push(report)
    else byDeck.set(deckId, { ...deck, reports: [report] })
  }
  return [...byDeck.values()]
}

export async function saveReport(
  database: D1Database,
  input: Readonly<
    Report & {
      deckId: DeckId
      deploymentId: string
      sharePath: string
      reporterUserId: string
      now: number
    }
  >,
): Promise<void> {
  const updated = {
    reason: input.reason,
    note: input.note,
    deployment_id: input.deploymentId,
    share_path: input.sharePath,
    updated_at: input.now,
  }
  await drizzle(database)
    .insert(reports)
    .values({
      ...updated,
      id: crypto.randomUUID(),
      deck_id: input.deckId,
      reporter_user_id: input.reporterUserId,
      created_at: input.now,
    })
    .onConflictDoUpdate({
      target: [reports.deck_id, reports.reporter_user_id],
      set: updated,
    })
}
