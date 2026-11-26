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
      'メールのコードでのログイン、Better Auth の利用者とセッション、招待、作者のアカウント、人とコミュニティが分け合うハンドル。',
    tables: [
      'accounts',
      'handles',
      'released_handles',
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
    summary: 'フォロー、ミュート、ブロック、お知らせと、その受け取りの設定。',
    tables: [
      'follows',
      'mutes',
      'blocks',
      'notifications',
      'notification_opt_outs',
    ],
  },
  {
    id: 'content',
    title: '記事と関連リンクと引用',
    summary: 'スライドに付く実況記事、関連リンク、スライドと記事からの引用。',
    tables: ['articles', 'article_citations', 'related_links', 'citations'],
  },
  {
    id: 'events',
    title: 'イベント',
    summary: '関連リンクの URL から決まるイベントと、関連リンクとの対応。',
    tables: ['events', 'related_link_events'],
  },
  {
    id: 'communities',
    title: 'コミュニティ',
    summary:
      'コミュニティ、その管理者、スライドの自動紐づけ用リンク、Luma のカレンダーの配信に並ぶイベントの鍵と、コミュニティのフォロー。',
    tables: [
      'communities',
      'community_admins',
      'community_links',
      'community_feed_events',
      'community_follows',
    ],
  },
  {
    id: 'feeds',
    title: 'Luma の配信',
    summary:
      'Luma のカレンダーの iCal 配信を読む記録(間隔、条件付きの取得、失敗と停止)と、Luma への取得を 1 本ずつに絞る門。',
    tables: ['luma_feeds', 'luma_feed_gate'],
  },
  {
    id: 'alerts',
    title: '運営への通知',
    summary:
      '運営へ知らせる通知。すぐ送ったものの記録と、翌日のメールにまとめるために待っているもの。通知にするための数え上げに使う出来事。',
    tables: ['alerts', 'alert_signals'],
  },
  {
    id: 'backups',
    title: 'R2 のバックアップ',
    summary:
      'バックアップのバケットにあるファイルの記録と、毎日の写しがどこまで進んだか。',
    tables: ['backup_objects', 'backup_state'],
  },
  {
    id: 'maintenance',
    title: 'メンテナンスの予告',
    summary:
      'サービスを止める予定。全ページの帯に出す、開始と終了の見込みと理由。予定は 1 つだけ持つ。',
    tables: ['maintenance_notice'],
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
