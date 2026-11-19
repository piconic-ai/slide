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
  uniqueIndex,
} from 'drizzle-orm/sqlite-core'
import { NOTIFICATION_KINDS } from '../notifications/notification'

export const decks = sqliteTable(
  'decks',
  {
    id: text().primaryKey(),
    /**
     * The name the author chose, the last part of /@handle/slug. Nullable only
     * because SQLite cannot add NOT NULL to a column without a default; see
     * migrations/0022. Every write passes a slug. Code that
     * reads it parses it with deckSlugSchema, which requires a string.
     */
    slug: text(),
    owner_user_id: text().notNull(),
    created_at: integer().notNull(),
    publication_mode: text({ enum: ['manual', 'repository'] })
      .notNull()
      .default('manual'),
    paused_at: integer(),
    first_published_at: integer(),
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
    // An operator's takedown; see src/publication/takedown.ts.
    hidden_at: integer(),
    hidden_reason: text(),
    hidden_by: text(),
  },
  (table) => [
    check(
      'deck_hidden_reason',
      sql`${table.hidden_reason} IS NULL OR length(${table.hidden_reason}) BETWEEN 1 AND 500`,
    ),
    check(
      'deck_hidden_by',
      sql`${table.hidden_by} IS NULL OR length(${table.hidden_by}) BETWEEN 1 AND 320`,
    ),
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
    uniqueIndex('decks_owner_slug').on(table.owner_user_id, table.slug),
    check(
      'deck_ci_run',
      sql`(${table.ci_run_id} IS NULL) = (${table.ci_run_attempt} IS NULL) AND ${table.ci_run_attempt} >= 1`,
    ),
  ],
)

export const suspensions = sqliteTable('suspensions', {
  user_id: text().primaryKey(),
  reason: text().notNull(),
  suspended_at: integer().notNull(),
  suspended_by: text().notNull(),
})

export const suspensionRowSchema = createSelectSchema(suspensions)

export const mutes = sqliteTable(
  'mutes',
  {
    muter_user_id: text().notNull(),
    muted_user_id: text().notNull(),
    created_at: integer().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.muter_user_id, table.muted_user_id] }),
    check(
      'mute_other_user',
      sql`${table.muter_user_id} <> ${table.muted_user_id}`,
    ),
  ],
)

export const follows = sqliteTable(
  'follows',
  {
    follower_user_id: text().notNull(),
    followee_user_id: text().notNull(),
    created_at: integer().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.follower_user_id, table.followee_user_id] }),
    check(
      'follow_other_user',
      sql`${table.follower_user_id} <> ${table.followee_user_id}`,
    ),
    index('follows_followee').on(table.followee_user_id),
  ],
)

export const notifications = sqliteTable(
  'notifications',
  {
    id: text().primaryKey(),
    recipient_user_id: text().notNull(),
    kind: text({ enum: NOTIFICATION_KINDS }).notNull(),
    actor_user_id: text().notNull(),
    deck_id: text(),
    target_deck_id: text(),
    created_at: integer().notNull(),
    read_at: integer(),
  },
  (table) => [
    check(
      'notification_shape',
      sql`(${table.kind} = 'cited' AND ${table.deck_id} IS NOT NULL AND ${table.target_deck_id} IS NOT NULL)
        OR (${table.kind} = 'followee_published' AND ${table.deck_id} IS NOT NULL AND ${table.target_deck_id} IS NULL)
        OR (${table.kind} IN ('github_followee_joined', 'followed') AND ${table.deck_id} IS NULL AND ${table.target_deck_id} IS NULL)`,
    ),
    check(
      'notification_other_user',
      sql`${table.recipient_user_id} <> ${table.actor_user_id}`,
    ),
    uniqueIndex('notifications_once').on(
      table.recipient_user_id,
      table.kind,
      table.actor_user_id,
      sql`coalesce(${table.deck_id}, '')`,
      sql`coalesce(${table.target_deck_id}, '')`,
    ),
    index('notifications_recipient').on(
      table.recipient_user_id,
      table.created_at,
    ),
  ],
)

export const notificationOptOuts = sqliteTable(
  'notification_opt_outs',
  {
    user_id: text().notNull(),
    kind: text({ enum: NOTIFICATION_KINDS }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.user_id, table.kind] })],
)

export const reports = sqliteTable(
  'reports',
  {
    id: text().primaryKey(),
    deck_id: text()
      .notNull()
      .references(() => decks.id),
    deployment_id: text().notNull(),
    share_path: text().notNull(),
    reason: text({ enum: ['nuisance', 'rights', 'other'] }).notNull(),
    note: text().notNull(),
    reporter_user_id: text(),
    created_at: integer().notNull(),
    updated_at: integer().notNull(),
  },
  (table) => [
    check(
      'report_reason',
      sql`${table.reason} IN ('nuisance', 'rights', 'other')`,
    ),
    uniqueIndex('reports_deck_reporter').on(
      table.deck_id,
      table.reporter_user_id,
    ),
  ],
)

/** Where a version can be sent from: a browser, or an agent through MCP. */
export const UPLOAD_SOURCES = ['browser', 'mcp'] as const
export type UploadSource = (typeof UPLOAD_SOURCES)[number]

export const deployments = sqliteTable(
  'deployments',
  {
    id: text().primaryKey(),
    idempotency_key: text().notNull().unique(),
    inventory_digest: text().notNull(),
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
    /** The entry's <meta name="description">; see migrations/0016. */
    description: text(),
    /** The file the entry names in og:image; see migrations/0017. */
    cover_path: text(),
    /**
     * Where the version was sent from. The database has a default only
     * because SQLite needs one to add the column; see migrations/0029. Every
     * insert passes a value.
     */
    source: text({ enum: UPLOAD_SOURCES }).notNull(),
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
      'deployment_description',
      sql`${table.description} IS NULL OR length(${table.description}) BETWEEN 1 AND 300`,
    ),
    check(
      'deployment_cover_path',
      sql`${table.cover_path} IS NULL OR length(${table.cover_path}) BETWEEN 1 AND 300`,
    ),
    check('deployment_source', sql`${table.source} IN ('browser', 'mcp')`),
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
export const deckRowSchema = createSelectSchema(decks)

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

/** An author's public GitHub profile, copied at each sign-in. */
export const profiles = sqliteTable('profiles', {
  user_id: text().primaryKey(),
  login: text().notNull(),
  name: text(),
  avatar_url: text(),
  location: text(),
  website: text(),
  has_sponsors: integer({ mode: 'boolean' }).notNull().default(false),
  synced_at: integer().notNull(),
})

/** Links from a deployment's HTML to share URLs; see migrations/0013. */
export const citations = sqliteTable(
  'citations',
  {
    deployment_id: text()
      .notNull()
      .references(() => deployments.id),
    target_handle: text().notNull(),
    target_slug: text().notNull(),
    /** The cited page, or 0 for the whole deck. */
    target_page: integer().notNull().default(0),
  },
  (table) => [
    primaryKey({
      columns: [
        table.deployment_id,
        table.target_handle,
        table.target_slug,
        table.target_page,
      ],
    }),
    check('citation_page', sql`${table.target_page} BETWEEN 0 AND 9999`),
    index('citations_target').on(table.target_handle, table.target_slug),
  ],
)

/** Posts on X and Bluesky shown beside a deck; see migrations/0014. */
export const reactionPosts = sqliteTable(
  'reaction_posts',
  {
    id: text().primaryKey(),
    deck_id: text()
      .notNull()
      .references(() => decks.id),
    /** The page the post reacts to, or 0 for the whole deck. */
    page: integer().notNull().default(0),
    service: text({ enum: ['x', 'bluesky'] }).notNull(),
    post_key: text().notNull(),
    source: text({ enum: ['pasted', 'collected'] }).notNull(),
    posted_at: integer(),
    created_at: integer().notNull(),
  },
  (table) => [
    unique().on(table.deck_id, table.service, table.post_key),
    check('reaction_post_page', sql`${table.page} BETWEEN 0 AND 9999`),
    check('reaction_post_service', sql`${table.service} IN ('x', 'bluesky')`),
    check(
      'reaction_post_source',
      sql`${table.source} IN ('pasted', 'collected')`,
    ),
  ],
)
export const reactionPostRowSchema = createSelectSchema(reactionPosts)

/** Communities, their events and the talks given there; see migrations/0015. */
export const communities = sqliteTable('communities', {
  id: text().primaryKey(),
  name: text().notNull(),
  url: text().notNull(),
})

export const events = sqliteTable('events', {
  id: text().primaryKey(),
  community_id: text()
    .notNull()
    .references(() => communities.id),
  name: text().notNull(),
  url: text().notNull(),
  /** Without the leading number sign. */
  hashtag: text(),
  /** The local date of the event, as YYYY-MM-DD. */
  held_on: text().notNull(),
})

export const eventTalks = sqliteTable(
  'event_talks',
  {
    event_id: text()
      .notNull()
      .references(() => events.id),
    position: integer().notNull(),
    /** A deck here; otherwise `url` names slides on another service. */
    deck_id: text().references(() => decks.id),
    title: text(),
    speaker: text(),
    url: text(),
    embed_url: text(),
  },
  (table) => [
    primaryKey({ columns: [table.event_id, table.position] }),
    unique().on(table.event_id, table.deck_id),
    check('event_talk_position', sql`${table.position} >= 0`),
    check(
      'event_talk_kind',
      sql`(${table.deck_id} IS NULL) <> (${table.url} IS NULL)`,
    ),
    index('event_talks_deck').on(table.deck_id),
  ],
)
