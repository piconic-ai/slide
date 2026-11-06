import { sql } from 'drizzle-orm'
import { createSelectSchema } from 'drizzle-zod'
import {
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  unique,
} from 'drizzle-orm/sqlite-core'

export const deployments = sqliteTable(
  'deployments',
  {
    id: text().primaryKey(),
    idempotency_key: text().notNull().unique(),
    inventory_digest: text().notNull(),
    source_sha: text().notNull(),
    run_id: text().notNull(),
    run_attempt: text().notNull(),
    actor_id: text().notNull(),
    repository_id: text().notNull(),
    owner_id: text().notNull(),
    source_ref: text().notNull(),
    state: text({
      enum: ['uploading', 'ready', 'failed', 'expired'],
    }).notNull(),
    total_bytes: integer().notNull(),
    token_hash: text().notNull(),
    created_at: integer().notNull(),
    expires_at: integer().notNull(),
    credential_expires_at: integer().notNull(),
    lease_id: text(),
    lease_until: integer(),
    ready_at: integer(),
    failure_reason: text(),
    swept_at: integer(),
    sweep_after: integer(),
  },
  (table) => [
    check(
      'deployment_state',
      sql`${table.state} IN ('uploading', 'ready', 'failed', 'expired')`,
    ),
    check(
      'deployment_failure_reason',
      sql`(${table.state} = 'failed') = (${table.failure_reason} IS NOT NULL)`,
    ),
    index('deployments_unswept').on(table.swept_at, table.state),
    check(
      'deployment_ready_at',
      sql`(${table.state} = 'ready') = (${table.ready_at} IS NOT NULL)`,
    ),
  ],
)

export const uploadFiles = sqliteTable(
  'upload_files',
  {
    deployment_id: text()
      .notNull()
      .references(() => deployments.id),
    id: text().notNull(),
    path: text().notNull(),
    size: integer().notNull(),
    sha256: text().notNull(),
    media_type: text().notNull(),
    object_key: text(),
  },
  (table) => [
    primaryKey({ columns: [table.deployment_id, table.id] }),
    unique().on(table.deployment_id, table.path),
  ],
)

export type Deployment = typeof deployments.$inferSelect
export const deploymentRowSchema = createSelectSchema(deployments)
export const uploadFileRowSchema = createSelectSchema(uploadFiles)
