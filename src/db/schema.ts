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
import { EVENT_SERVICES } from '../events/event-url'
import { COMMUNITY_LINK_KINDS } from '../communities/link-rules'
import { COMMUNITY_COLORS } from '../site/cover-pattern'
import { FEED_FAILURES } from '../feeds/feed-answer'

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
    paused_at: integer(),
    first_published_at: integer(),
    public_deployment_id: text().references(
      (): AnySQLiteColumn => deployments.id,
    ),
    resume_deployment_id: text().references(
      (): AnySQLiteColumn => deployments.id,
    ),
    revision: integer().notNull().default(0),
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
    check('deck_revision', sql`${table.revision} >= 0`),
    check(
      'deck_public_not_paused',
      sql`${table.public_deployment_id} IS NULL OR ${table.paused_at} IS NULL`,
    ),
    check(
      'deck_resume_when_paused',
      sql`${table.resume_deployment_id} IS NULL OR ${table.paused_at} IS NOT NULL`,
    ),
    check(
      'deck_deleted_unpointed',
      sql`${table.deleted_at} IS NULL OR (${table.public_deployment_id} IS NULL AND ${table.resume_deployment_id} IS NULL)`,
    ),
    index('decks_deleted_at').on(table.deleted_at),
    uniqueIndex('decks_owner_slug').on(table.owner_user_id, table.slug),
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

/** One person's block of another (docs/dev/f32-block.md). */
export const blocks = sqliteTable(
  'blocks',
  {
    blocker_user_id: text().notNull(),
    blocked_user_id: text().notNull(),
    created_at: integer().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.blocker_user_id, table.blocked_user_id] }),
    check(
      'block_other_user',
      sql`${table.blocker_user_id} <> ${table.blocked_user_id}`,
    ),
    index('blocks_blocked').on(table.blocked_user_id),
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
    /** The community a slide is shown under; only for community_published. */
    community_id: integer().references(() => communities.id),
    created_at: integer().notNull(),
    read_at: integer(),
  },
  (table) => [
    check(
      'notification_shape',
      sql`(${table.kind} = 'cited' AND ${table.deck_id} IS NOT NULL AND ${table.target_deck_id} IS NOT NULL AND ${table.community_id} IS NULL)
        OR (${table.kind} = 'followee_published' AND ${table.deck_id} IS NOT NULL AND ${table.target_deck_id} IS NULL AND ${table.community_id} IS NULL)
        OR (${table.kind} = 'followed' AND ${table.deck_id} IS NULL AND ${table.target_deck_id} IS NULL AND ${table.community_id} IS NULL)
        OR (${table.kind} = 'community_published' AND ${table.deck_id} IS NOT NULL AND ${table.target_deck_id} IS NULL AND ${table.community_id} IS NOT NULL)`,
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
    uniqueIndex('notifications_deck_once')
      .on(table.recipient_user_id, table.deck_id)
      .where(
        sql`${table.kind} IN ('followee_published', 'community_published')`,
      ),
    index('notifications_community')
      .on(table.community_id)
      .where(sql`${table.community_id} IS NOT NULL`),
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
    /** When they agreed to the terms; see migrations/0044. */
    terms_accepted_at: integer(),
  },
  (table) => [
    check(
      'account_handle',
      sql`length(${table.handle}) BETWEEN 1 AND 39 AND ${table.handle} NOT GLOB '*[^a-z0-9-]*' AND ${table.handle} NOT GLOB '-*'`,
    ),
  ],
)

/** Who can hold a handle: a person or a community; see migrations/0053. */
export const HANDLE_OWNER_KINDS = ['person', 'community'] as const

/**
 * Every handle in use and who holds it, shared by people and communities;
 * see migrations/0053. The primary key keeps a handle to one owner.
 */
export const handles = sqliteTable(
  'handles',
  {
    handle: text().primaryKey(),
    owner_kind: text({ enum: HANDLE_OWNER_KINDS }).notNull(),
    owner_id: text().notNull(),
    created_at: integer().notNull(),
  },
  (table) => [
    check(
      'handle_spelling',
      sql`length(${table.handle}) BETWEEN 1 AND 39 AND ${table.handle} NOT GLOB '*[^a-z0-9-]*' AND ${table.handle} NOT GLOB '-*'`,
    ),
    uniqueIndex('handles_owner').on(table.owner_kind, table.owner_id),
  ],
)

/**
 * A handle someone let go of, and when; nobody takes it for a while. After
 * an operator's change it names the owner the old URL moves to; see
 * migrations/0053.
 */
export const releasedHandles = sqliteTable(
  'released_handles',
  {
    handle: text().primaryKey(),
    released_at: integer().notNull(),
    moved_to_kind: text({ enum: HANDLE_OWNER_KINDS }),
    moved_to_id: text(),
  },
  (table) => [
    check(
      'released_handle_move',
      sql`(${table.moved_to_kind} IS NULL) = (${table.moved_to_id} IS NULL)`,
    ),
  ],
)

/** What an author wrote about themselves; see migrations/0037. */
export const profiles = sqliteTable('profiles', {
  user_id: text().primaryKey(),
  name: text().notNull(),
  bio: text(),
  location: text(),
  website: text(),
  /** 1 shows the Gravatar picture when no picture was uploaded; see 0042. */
  use_gravatar: integer().notNull().default(1),
  /** When Gravatar was last asked for the picture, in seconds; see 0048. */
  gravatar_at: integer(),
})

/** Up to three links an author wrote, in their order; see migrations/0042. */
export const profileLinks = sqliteTable(
  'profile_links',
  {
    user_id: text().notNull(),
    position: integer().notNull(),
    url: text().notNull(),
  },
  (table) => [primaryKey({ columns: [table.user_id, table.position] })],
)

/** That an author uploaded a picture, kept in R2; see migrations/0043. */
export const profilePictures = sqliteTable('profile_pictures', {
  user_id: text().primaryKey(),
  /** In milliseconds since 0048 (seconds before); the picture's version. */
  uploaded_at: integer().notNull(),
})

/** Each time the operator took an uploaded picture down; see 0043. */
export const pictureRemovals = sqliteTable('picture_removals', {
  id: integer().primaryKey({ autoIncrement: true }),
  user_id: text().notNull(),
  removed_by: text().notNull(),
  reason: text().notNull(),
  removed_at: integer().notNull(),
})

/** The people the operator invited, by address; see migrations/0036. */
export const invitedEmails = sqliteTable('invited_emails', {
  email: text().primaryKey(),
  invited_at: integer().notNull(),
  invited_by: text().notNull(),
})

/** Mail written, not sent, where no real mail service is set up. */
export const mailOutbox = sqliteTable('mail_outbox', {
  id: text().primaryKey(),
  to_address: text().notNull(),
  subject: text().notNull(),
  body: text().notNull(),
  created_at: integer().notNull(),
})

/** Login codes asked for, as hashes, so the limits can count them. */
export const loginCodeRequests = sqliteTable('login_code_requests', {
  id: text().primaryKey(),
  kind: text({ enum: ['send', 'attempt'] }).notNull(),
  address_hash: text().notNull(),
  source_hash: text().notNull(),
  requested_at: integer().notNull(),
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

/**
 * A link the author attached to one deck; see migrations/0039 and
 * docs/dev/f27-related-links.md. It belongs to the deck, not to a version.
 */
export const relatedLinks = sqliteTable(
  'related_links',
  {
    id: text().primaryKey(),
    deck_id: text()
      .notNull()
      .references(() => decks.id),
    kind: text({ enum: ['video', 'article', 'other'] }).notNull(),
    /** The address as the author added it, kept as a record; never shown. */
    url: text().notNull(),
    /**
     * The form the link is compared in (normalizedUrlOf), to tell that the
     * deck has it already. Null only on a row a Worker before migration 0051
     * added.
     */
    normalized_url: text(),
    /**
     * The address the link leads to and is shown as (sanitizedUrlOf). Null
     * only on a row a Worker before migration 0052 added.
     */
    sanitized_url: text(),
    /** Null when none was typed: the link shows its site name. */
    title: text(),
    /** Grows with every link added and is never reused: the order of adding. */
    position: integer().notNull(),
    created_at: integer().notNull(),
  },
  (table) => [
    check(
      'related_link_kind',
      sql`${table.kind} IN ('video', 'article', 'other')`,
    ),
    check(
      'related_link_title',
      sql`${table.title} IS NULL OR length(${table.title}) BETWEEN 1 AND 100`,
    ),
    uniqueIndex('related_links_order').on(table.deck_id, table.position),
  ],
)

/**
 * An event slides were given as talks of, known only by the address of its
 * related links; see migrations/0054 and docs/dev/f29-event-talks.md.
 */
export const events = sqliteTable(
  'events',
  {
    /** The number in /events/:id. */
    id: integer().primaryKey({ autoIncrement: true }),
    key: text().notNull().unique(),
    service: text({ enum: EVENT_SERVICES }).notNull(),
    ref: text().notNull(),
    host: text().notNull(),
    url: text().notNull(),
    /** The first title a link was saved with, or an operator's; null shows the service and number. */
    name: text(),
    named_by: text(),
    named_at: integer(),
    created_at: integer().notNull(),
  },
  (table) => [
    check(
      'event_named',
      sql`(${table.named_by} IS NULL) = (${table.named_at} IS NULL)`,
    ),
    check(
      'event_named_has_name',
      sql`${table.named_by} IS NULL OR ${table.name} IS NOT NULL`,
    ),
  ],
)

/**
 * Which event a related link is a talk of. A link with a row here is of the
 * kind "event", whatever related_links.kind says; see migrations/0054.
 */
export const relatedLinkEvents = sqliteTable(
  'related_link_events',
  {
    link_id: text()
      .primaryKey()
      .references(() => relatedLinks.id),
    event_id: integer()
      .notNull()
      .references(() => events.id),
    /** The host the link's address was written with: its group, on connpass. */
    host: text().notNull(),
    created_at: integer().notNull(),
  },
  (table) => [
    index('related_link_events_event').on(table.event_id),
    // A community finds its events by these hosts; see migrations/0056.
    index('related_link_events_host').on(table.host),
  ],
)

/**
 * The article under a deck, in Markdown; see migrations/0040. It belongs to
 * the deck, so a new version keeps it.
 */
export const articles = sqliteTable(
  'articles',
  {
    deck_id: text()
      .primaryKey()
      .references(() => decks.id),
    body: text().notNull(),
    /** The edit of a published article, which readers do not see; see migrations/0046. */
    draft_body: text(),
    /** Grows with every write, to find a save made from an old screen. */
    revision: integer().notNull().default(0),
    status: text({ enum: ['draft', 'published'] })
      .notNull()
      .default('draft'),
    created_at: integer().notNull(),
    updated_at: integer().notNull(),
  },
  (table) => [
    check('article_body_length', sql`length(${table.body}) <= 50000`),
    check(
      'article_draft_body_length',
      sql`${table.draft_body} IS NULL OR length(${table.draft_body}) <= 50000`,
    ),
    check('article_revision', sql`${table.revision} >= 0`),
  ],
)

/**
 * Links a published article makes to share URLs, kept only while it is
 * published; see migrations/0041.
 */
export const articleCitations = sqliteTable(
  'article_citations',
  {
    deck_id: text()
      .notNull()
      .references(() => decks.id),
    target_handle: text().notNull(),
    target_slug: text().notNull(),
    /** The cited page, or 0 for the whole deck. */
    target_page: integer().notNull().default(0),
  },
  (table) => [
    primaryKey({
      columns: [
        table.deck_id,
        table.target_handle,
        table.target_slug,
        table.target_page,
      ],
    }),
    check(
      'article_citation_page',
      sql`${table.target_page} BETWEEN 0 AND 9999`,
    ),
    index('article_citations_target').on(
      table.target_handle,
      table.target_slug,
    ),
  ],
)

/**
 * An MCP client registered with the service's OAuth authorization server;
 * see migrations/0031 and docs/dev/f23-agent-upload.md.
 */
export const mcpClients = sqliteTable(
  'mcp_clients',
  {
    id: text().primaryKey(),
    name: text().notNull(),
    /** The redirect URIs the client registered, as a JSON array. */
    redirect_uris: text().notNull(),
    created_at: integer().notNull(),
    /** When a grant was last made or refreshed through it; null until one is. */
    used_at: integer(),
  },
  (table) => [index('mcp_clients_used').on(table.used_at, table.created_at)],
)
export const mcpClientRowSchema = createSelectSchema(mcpClients)

const mcpOwner = () =>
  text()
    .notNull()
    .references(() => accounts.user_id, { onDelete: 'cascade' })
const mcpClient = () =>
  text()
    .notNull()
    .references(() => mcpClients.id, { onDelete: 'cascade' })

/** An authorization code not yet exchanged; only its hash is kept. */
export const mcpCodes = sqliteTable(
  'mcp_codes',
  {
    code_hash: text().primaryKey(),
    client_id: mcpClient(),
    owner_user_id: mcpOwner(),
    redirect_uri: text().notNull(),
    code_challenge: text().notNull(),
    expires_at: integer().notNull(),
  },
  (table) => [
    index('mcp_codes_client').on(table.client_id),
    index('mcp_codes_owner').on(table.owner_user_id),
  ],
)

/** One agent an author connected; only the hashes of its tokens are kept. */
export const mcpGrants = sqliteTable(
  'mcp_grants',
  {
    id: text().primaryKey(),
    client_id: mcpClient(),
    owner_user_id: mcpOwner(),
    access_token_hash: text().notNull().unique(),
    access_expires_at: integer().notNull(),
    refresh_token_hash: text().notNull().unique(),
    refresh_expires_at: integer().notNull(),
    created_at: integer().notNull(),
    last_used_at: integer(),
  },
  (table) => [
    index('mcp_grants_client').on(table.client_id),
    index('mcp_grants_owner').on(table.owner_user_id),
  ],
)

/**
 * A community: its handle is held in `handles`, never here; see
 * migrations/0056 and docs/dev/f30-communities.md.
 */
export const communities = sqliteTable(
  'communities',
  {
    /** Picked at random before the handle is taken; the cover's seed. */
    id: integer().primaryKey(),
    name: text().notNull(),
    description: text().notNull().default(''),
    color: text({ enum: COMMUNITY_COLORS }).notNull(),
    /** The other links, a JSON array of up to three addresses. */
    sites: text().notNull().default('[]'),
    /** When the logo was put up, in milliseconds; null shows the initial. */
    logo_at: integer(),
    /** When the cover was put up, in milliseconds; null shows the pattern. */
    cover_at: integer(),
    created_at: integer().notNull(),
  },
  (table) => [
    check('community_id', sql`${table.id} > 0`),
    check('community_name', sql`length(${table.name}) BETWEEN 1 AND 50`),
    check('community_description', sql`length(${table.description}) <= 160`),
  ],
)

/** The people who run a community; see migrations/0056. */
export const communityAdmins = sqliteTable(
  'community_admins',
  {
    community_id: integer()
      .notNull()
      .references(() => communities.id),
    user_id: text().notNull(),
    added_at: integer().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.community_id, table.user_id] }),
    index('community_admins_user').on(table.user_id),
  ],
)

/**
 * A link a community gathers slides by; one link belongs to one community.
 * `host` is matched against the hosts of events' links; a Luma calendar has
 * none. See migrations/0056.
 */
export const communityLinks = sqliteTable(
  'community_links',
  {
    id: integer().primaryKey({ autoIncrement: true }),
    community_id: integer()
      .notNull()
      .references(() => communities.id),
    url: text().notNull().unique(),
    kind: text({ enum: COMMUNITY_LINK_KINDS }).notNull(),
    host: text(),
    created_at: integer().notNull(),
  },
  (table) => [
    index('community_links_community').on(table.community_id),
    uniqueIndex('community_links_host')
      .on(table.host)
      .where(sql`${table.host} IS NOT NULL`),
    check(
      'community_link_host',
      sql`(${table.kind} = 'luma') = (${table.host} IS NULL)`,
    ),
  ],
)

/** The events a Luma calendar's feed lists, by key; see migrations/0056. */
export const communityFeedEvents = sqliteTable(
  'community_feed_events',
  {
    link_id: integer()
      .notNull()
      .references(() => communityLinks.id),
    event_key: text().notNull(),
    added_at: integer().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.link_id, table.event_key] }),
    index('community_feed_events_key').on(table.event_key),
  ],
)

/** Who follows which community; see migrations/0058. */
export const communityFollows = sqliteTable(
  'community_follows',
  {
    user_id: text().notNull(),
    community_id: integer()
      .notNull()
      .references(() => communities.id),
    created_at: integer().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.user_id, table.community_id] }),
    index('community_follows_community').on(
      table.community_id,
      table.created_at,
    ),
  ],
)

/** How each Luma calendar's feed is read; see migrations/0057. */
export const lumaFeeds = sqliteTable(
  'luma_feeds',
  {
    url: text().primaryKey().notNull(),
    read_at: integer(),
    not_before: integer().notNull().default(0),
    due_at: integer().notNull().default(0),
    retry_until: integer(),
    etag: text(),
    last_modified: text(),
    failures: integer().notNull().default(0),
    last_failure: text({ enum: FEED_FAILURES }),
    stopped_at: integer(),
  },
  (table) => [
    index('luma_feeds_due')
      .on(table.due_at)
      .where(sql`${table.stopped_at} IS NULL`),
    check(
      'luma_feed_stopped',
      sql`${table.stopped_at} IS NULL OR ${table.last_failure} IS NOT NULL`,
    ),
  ],
)

/** The one gate of requests to Luma, in milliseconds; see migrations/0057. */
export const lumaFeedGate = sqliteTable('luma_feed_gate', {
  id: integer().primaryKey().notNull(),
  busy_until: integer().notNull(),
  next_start_at: integer().notNull(),
})
