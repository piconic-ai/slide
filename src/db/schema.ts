import { sql } from 'drizzle-orm'
import { createSelectSchema } from 'drizzle-zod'
import {
  type AnySQLiteColumn,
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  unique,
} from 'drizzle-orm/sqlite-core'

export const decks = sqliteTable(
  'decks',
  {
    id: text().primaryKey(),
    owner_user_id: text().notNull(),
    created_at: integer().notNull(),
    publication_mode: text({ enum: ['manual', 'repository'] })
      .notNull()
      .default('manual'),
    paused_at: integer(),
    public_deployment_id: text().references(
      (): AnySQLiteColumn => deployments.id,
    ),
    resume_deployment_id: text().references(
      (): AnySQLiteColumn => deployments.id,
    ),
    revision: integer().notNull().default(0),
    author_revision: integer().notNull().default(0),
    ci_run_id: integer(),
    ci_run_attempt: integer(),
    change_id: text(),
    deleted_at: integer(),
  },
  (table) => [
    check(
      'deck_publication_mode',
      sql`${table.publication_mode} IN ('manual', 'repository')`,
    ),
    check('deck_revision', sql`${table.revision} >= 0`),
    check(
      'deck_author_revision',
      sql`${table.author_revision} >= 0 AND ${table.author_revision} <= ${table.revision}`,
    ),
    check(
      'deck_public_not_paused',
      sql`${table.public_deployment_id} IS NULL OR ${table.paused_at} IS NULL`,
    ),
    check(
      'deck_resume_when_paused',
      sql`${table.resume_deployment_id} IS NULL OR ${table.paused_at} IS NOT NULL`,
    ),
    check('deck_ci_run_id', sql`${table.ci_run_id} >= 0`),
    check(
      'deck_deleted_unpointed',
      sql`${table.deleted_at} IS NULL OR (${table.public_deployment_id} IS NULL AND ${table.resume_deployment_id} IS NULL)`,
    ),
    index('decks_deleted_at').on(table.deleted_at),
    check(
      'deck_ci_run',
      sql`(${table.ci_run_id} IS NULL) = (${table.ci_run_attempt} IS NULL) AND ${table.ci_run_attempt} >= 1`,
    ),
  ],
)

export const repositoryBindings = sqliteTable('repository_bindings', {
  deck_id: text()
    .primaryKey()
    .references(() => decks.id),
  repository_id: text().notNull(),
  repository_owner_id: text().notNull(),
  repository_full_name: text().notNull(),
  allowed_refs: text().notNull(),
  verified_by: text().notNull(),
  verified_at: integer().notNull(),
})

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
    deck_id: text().references(() => decks.id),
    start_revision: integer(),
    publish_intent: text({ enum: ['published', 'unpublished'] }),
    /** The entry's <title>; see migrations/0011. */
    title: text(),
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
    check(
      'deployment_publish_intent',
      sql`${table.publish_intent} IN ('published', 'unpublished')`,
    ),
    index('deployments_unswept').on(table.swept_at, table.state),
    index('deployments_deck_created').on(table.deck_id, table.created_at),
    check(
      'deployment_title',
      sql`${table.title} IS NULL OR length(${table.title}) BETWEEN 1 AND 200`,
    ),
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

export type Deck = typeof decks.$inferSelect
export type RepositoryBinding = typeof repositoryBindings.$inferSelect
export const deckRowSchema = createSelectSchema(decks)
export const repositoryBindingRowSchema = createSelectSchema(repositoryBindings)

export const previewLaunches = sqliteTable(
  'preview_launches',
  {
    token_hash: text().primaryKey(),
    deployment_id: text()
      .notNull()
      .references(() => deployments.id),
    owner_user_id: text().notNull(),
    created_at: integer().notNull(),
    expires_at: integer().notNull(),
    consumed_at: integer(),
    session_hash: text(),
  },
  (table) => [
    check(
      'preview_launch_expiry',
      sql`${table.expires_at} > ${table.created_at}`,
    ),
    check(
      'preview_launch_consumed',
      sql`(${table.consumed_at} IS NULL) = (${table.session_hash} IS NULL)`,
    ),
    index('preview_launches_expires_at').on(table.expires_at),
    index('preview_launches_deployment').on(table.deployment_id),
  ],
)

export const contentSessions = sqliteTable(
  'content_sessions',
  {
    token_hash: text().primaryKey(),
    deployment_id: text()
      .notNull()
      .references(() => deployments.id),
    owner_user_id: text().notNull(),
    created_at: integer().notNull(),
    expires_at: integer().notNull(),
    hard_expires_at: integer().notNull(),
  },
  (table) => [
    check(
      'content_session_expiry',
      sql`${table.expires_at} > ${table.created_at} AND ${table.expires_at} <= ${table.hard_expires_at}`,
    ),
    index('content_sessions_deployment').on(table.deployment_id),
    index('content_sessions_expires_at').on(table.expires_at),
  ],
)

export const contentSessionRowSchema = createSelectSchema(contentSessions)

export const purgedPrefixes = sqliteTable(
  'purged_prefixes',
  {
    deployment_id: text().primaryKey(),
    purged_at: integer().notNull(),
    sweep_after: integer().notNull(),
  },
  (table) => [index('purged_prefixes_sweep_after').on(table.sweep_after)],
)

/** The handle naming an owner in share URLs; see migrations/0010. */
export const accounts = sqliteTable(
  'accounts',
  {
    user_id: text().primaryKey(),
    handle: text().notNull().unique(),
    created_at: integer().notNull(),
  },
  (table) => [
    check(
      'account_handle',
      sql`length(${table.handle}) BETWEEN 1 AND 39 AND ${table.handle} NOT GLOB '*[^a-z0-9-]*' AND ${table.handle} NOT GLOB '-*'`,
    ),
  ],
)
