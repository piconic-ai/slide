// Pure data: which diagram each table belongs to. Adding a table in a
// migration fails scripts/er-diagram.pure.test.mjs until it is listed here.

/**
 * @typedef {{ id: string, title: string, summary: string, tables: string[] }} Domain
 */

/** @type {Domain[]} */
export const DOMAINS = [
  {
    id: 'auth',
    title: '認証と利用者',
    summary:
      'メールのコードでのログイン、Better Auth の利用者とセッション、招待、作者のアカウント。',
    tables: [
      'accounts',
      'auth_user',
      'auth_account',
      'auth_session',
      'auth_verification',
      'invited_emails',
      'login_code_requests',
      'mail_outbox',
    ],
  },
  {
    id: 'mcp',
    title: 'AI エージェントの接続',
    summary: 'MCP の OAuth クライアント、認可コード、許可の記録。',
    tables: ['mcp_clients', 'mcp_codes', 'mcp_grants'],
  },
  {
    id: 'decks',
    title: 'スライドと版',
    summary:
      'スライド(decks)、置かれた版(deployments)、受け取り中のセッションとファイル、プレビュー。',
    tables: [
      'decks',
      'deployments',
      'content_sessions',
      'upload_files',
      'preview_launches',
      'purged_prefixes',
    ],
  },
  {
    id: 'moderation',
    title: '通報と運営',
    summary: '通報と、アカウントの停止。',
    tables: ['reports', 'suspensions'],
  },
  {
    id: 'social',
    title: 'フォローとお知らせ',
    summary: 'フォロー、ミュート、お知らせと、その受け取りの設定。',
    tables: ['follows', 'mutes', 'notifications', 'notification_opt_outs'],
  },
  {
    id: 'content',
    title: '記事と関連リンクと引用',
    summary: 'スライドに付く実況記事、関連リンク、スライドと記事からの引用。',
    tables: ['articles', 'article_citations', 'related_links', 'citations'],
  },
  {
    id: 'profile',
    title: 'プロフィール',
    summary: 'プロフィール、リンク、プロフィール画像と、その取り下げ。',
    tables: [
      'profiles',
      'profile_links',
      'profile_pictures',
      'picture_removals',
    ],
  },
]

/**
 * Problems in how `tableNames` are divided among `domains`: a table in no
 * diagram, one in two, or a listed table that does not exist.
 * @param {string[]} tableNames
 * @param {Domain[]} domains
 * @returns {string[]}
 */
export function assignmentProblems(tableNames, domains) {
  const existing = new Set(tableNames)
  const owners = new Map()
  const problems = []
  for (const { id, tables } of domains) {
    for (const table of tables) {
      if (!existing.has(table))
        problems.push(`${id} lists ${table}, which no migration creates`)
      owners.set(table, [...(owners.get(table) ?? []), id])
    }
  }
  for (const table of tableNames) {
    const ids = owners.get(table) ?? []
    if (ids.length === 0)
      problems.push(`${table} is in no domain: add it to DOMAINS`)
    else if (ids.length > 1)
      problems.push(`${table} is in several domains: ${ids.join(', ')}`)
  }
  return problems
}
