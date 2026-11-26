import { readdirSync, readFileSync } from 'node:fs'
import { expect, test } from 'vitest'

// The migrations of the second scope (0036 and later) that destroy data, and
// what they destroy. docs/dev/deploy.md lists the same, for the person who
// empties production before they land: a migration that drops or empties
// something must be added here, and to that list, on purpose.
const DESTRUCTIVE = {
  '0037_profiles_without_github.sql': ['DROP TABLE profiles'],
  '0038_remove_github_leftovers.sql': [
    'DROP TABLE owner_sessions',
    'DROP TABLE notifications',
    'DELETE FROM notification_opt_outs',
  ],
  // The table is rebuilt to drop NOT NULL on `title`; every row is copied first.
  '0045_related_link_title_optional.sql': ['DROP TABLE related_links'],
  // Rows derived from each version's index.html, no longer read.
  '0047_drop_page_script_deployments.sql': [
    'DROP TABLE page_script_deployments',
  ],
  // Rebuilt to drop the one-session-per-person constraint; every row is copied first.
  '0049_auth_session_per_device.sql': ['DROP TABLE auth_session'],
  // Rebuilt for the kind community_published and its column; every row is copied first.
  '0060_community_notifications.sql': ['DROP TABLE notifications'],
} as const

const sinceScope2 = readdirSync('migrations')
  .filter((name) => name.endsWith('.sql') && name >= '0036')
  .sort()

const destroys = (name: string) =>
  [
    ...readFileSync(`migrations/${name}`, 'utf8')
      .replace(/--.*$/gm, '')
      .matchAll(
        /\b(DROP\s+TABLE|DROP\s+COLUMN|DELETE\s+FROM|DROP\s+INDEX|TRUNCATE)\s+(?:IF\s+EXISTS\s+)?(\w+)/gi,
      ),
  ].map(([, verb, target]) => `${verb!.replace(/\s+/g, ' ')} ${target}`)

test('Given the migrations since 0036, When the statements that drop or empty something are read, Then they are exactly the listed ones', () => {
  expect(sinceScope2.length).toBeGreaterThanOrEqual(8)
  const found = Object.fromEntries(
    sinceScope2
      .map((name) => [name, destroys(name)] as const)
      .filter(([, statements]) => statements.length > 0),
  )
  expect(found).toEqual(DESTRUCTIVE)
})

test('Given the deploy guide, When it is read, Then it names every migration that destroys data and what it destroys', () => {
  const guide = readFileSync('docs/dev/deploy.md', 'utf8')
  for (const [name, statements] of Object.entries(DESTRUCTIVE)) {
    expect(guide, name).toContain(name)
    for (const statement of statements)
      expect(guide, `${name}: ${statement}`).toContain(
        statement.split(' ').at(-1)!,
      )
  }
})
