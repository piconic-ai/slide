// Where a subscriber's email address is kept, which files may read it, and
// where it may show (F43). This is data, not code: the tests that judge the
// source, the help article that tells subscribers where their address is
// used, and the script that writes D1 out without the tables that hold one
// all read it, so that none of them can drift from the others. Adding a row
// is allowed and is the way to add a place; the row's reason and the diff are
// what a reviewer reads. See docs/dev/f43-email-handling.md.
//
// This file imports nothing at run time: scripts/*.mjs load it as it is.

/**
 * What a column that is named like an address (or like who did something)
 * holds.
 * - `subscriber`: the address a person signs in with, or one built from it.
 * - `operator`: the address of an operator, from Cloudflare Access.
 * - `keyed-hash`: a hash of an address made with a secret, so that it cannot
 *   be checked without the secret.
 * - `not-an-address`: named like one, and is not one.
 */
export type AddressKind =
  | 'subscriber'
  | 'operator'
  | 'keyed-hash'
  | 'not-an-address'

export type AddressColumn = Readonly<{
  table: string
  column: string
  reason: string
}> &
  (
    | Readonly<{
        kind: 'subscriber'
        /** How the column is written in drizzle: the table's export and the column's key. */
        drizzle: string
      }>
    | Readonly<{ kind: Exclude<AddressKind, 'subscriber'> }>
  )

/**
 * The columns of D1 whose name has `email`, `mail`, `address` or ends in
 * `_by` (who did it: an operator's address), and the ones that hold a
 * subscriber's address without being named so. Every such column of the
 * schema is here, in one kind.
 */
export const ADDRESS_COLUMNS: readonly AddressColumn[] = [
  {
    table: 'auth_user',
    column: 'email',
    kind: 'subscriber',
    drizzle: 'authUser.email',
    reason:
      'The address a person signs in with; Better Auth keeps it here in lowercase.',
  },
  {
    table: 'invited_emails',
    column: 'email',
    kind: 'subscriber',
    drizzle: 'invitedEmails.email',
    reason:
      'The operator invites by address, and a person who signs up while sign-up is open is recorded here too.',
  },
  {
    table: 'mail_outbox',
    column: 'to_address',
    kind: 'subscriber',
    drizzle: 'mailOutbox.to_address',
    reason:
      'The local stand-in for mail writes the message here; production does not (MAIL_OUTBOX is off) and a row goes in a day.',
  },
  {
    table: 'auth_verification',
    column: 'identifier',
    kind: 'subscriber',
    drizzle: 'authVerification.identifier',
    reason:
      'Better Auth names a pending sign-in code `sign-in-otp-` and the address; the row goes when the code is used or expires.',
  },
  {
    table: 'login_code_requests',
    column: 'address_hash',
    kind: 'keyed-hash',
    reason:
      'Counts the requests for sign-in codes per address without keeping it; made with the auth secret (src/auth/login-keys.ts).',
  },
  {
    table: 'auth_user',
    column: 'email_verified',
    kind: 'not-an-address',
    reason: 'A flag that the address was confirmed.',
  },
  {
    table: 'auth_session',
    column: 'ip_address',
    kind: 'not-an-address',
    reason: 'The IP address of a sign-in, not an email address.',
  },
  {
    table: 'alerts',
    column: 'mailed_at',
    kind: 'not-an-address',
    reason: 'When the next-day mail of alerts was sent, a time.',
  },
  {
    table: 'invited_emails',
    column: 'invited_by',
    kind: 'operator',
    reason:
      'Who invited: an operator’s address, or the word the service writes for a person who signed up while sign-up was open.',
  },
  {
    table: 'decks',
    column: 'hidden_by',
    kind: 'operator',
    reason: 'The operator who took a slide down.',
  },
  {
    table: 'suspensions',
    column: 'suspended_by',
    kind: 'operator',
    reason: 'The operator who suspended an account.',
  },
  {
    table: 'picture_removals',
    column: 'removed_by',
    kind: 'operator',
    reason: 'The operator who took a picture down.',
  },
  {
    table: 'signup_pause_events',
    column: 'changed_by',
    kind: 'operator',
    reason: 'The operator who stopped or resumed sign-up.',
  },
  {
    table: 'events',
    column: 'named_by',
    kind: 'operator',
    reason: 'The operator who named an event.',
  },
]

/** The names that make a column one to declare: a part of its name. */
export const ADDRESS_COLUMN_NAME = /email|mail|address|_by$/

/**
 * A file that may read or write a subscriber's address, with what of it it
 * touches (a column as `table.column`, or `.email` for an `email` read off an
 * object, such as what Better Auth returns for a user) and why.
 */
export type AddressReader = Readonly<{
  file: string
  touches: readonly string[]
  reason: string
}>

export const ADDRESS_READERS: readonly AddressReader[] = [
  {
    file: 'src/auth/auth-store.ts',
    touches: ['.email'],
    reason:
      'Better Auth hands the address to the function that sends the sign-in code.',
  },
  {
    file: 'src/auth/invites-store.ts',
    touches: ['.email', 'invited_emails.email'],
    reason:
      'The operator’s invitations are kept and looked up by address; it is the one place that writes them.',
  },
  {
    file: 'src/auth/login-pages.ts',
    touches: ['.email'],
    reason:
      'The sign-in screens show the address the person typed back to them.',
  },
  {
    file: 'src/auth/login-routes.ts',
    touches: ['.email', 'auth_verification.identifier'],
    reason:
      'Takes the address typed, asks for the code to be sent, counts requests by keyed hash, and counts the wrong tries left of the pending code.',
  },
  {
    file: 'src/auth/registered-store.ts',
    touches: ['auth_user.email'],
    reason:
      'Tells whether an address belongs to a person who has registered, so a sign-in can be steered to sign-up or to the account.',
  },
  {
    file: 'src/auth/signup-store.ts',
    touches: [
      'auth_user.email',
      'auth_verification.identifier',
      'invited_emails.email',
    ],
    reason:
      'Removes what a first sign-in left of a person who did not finish signing up, which includes the address.',
  },
  {
    file: 'src/db/invitation-schema.ts',
    touches: ['auth_user.email', 'invited_emails.email'],
    reason:
      'The one query that says who is signed up and still invited, which compares the two addresses.',
  },
  {
    file: 'src/decks/deletion-store.ts',
    touches: ['auth_user.email', 'invited_emails.email'],
    reason:
      'Leaving the service deletes the address with the person: their user row and the invitation the service made for them.',
  },
  {
    file: 'src/exports/account-export-store.ts',
    touches: ['auth_user.email'],
    reason:
      'The account information a person exports holds their own address (F35).',
  },
  {
    file: 'src/exports/account-info.ts',
    touches: ['.email'],
    reason:
      'Builds the account information file with the person’s own address.',
  },
  {
    file: 'src/mail/outbox-store.ts',
    touches: ['mail_outbox.to_address'],
    reason:
      'The local stand-in for mail: writes the message to the table and reads it back for the tests, and drops rows after a day.',
  },
  {
    file: 'src/operator/pages.ts',
    touches: ['.email'],
    reason:
      'The operator’s list of invitations shows each address, by design (F43 leaves it as it is).',
  },
  {
    file: 'src/operator/routes.ts',
    touches: ['.email'],
    reason: 'Takes the address an operator types to invite or remove a person.',
  },
  {
    file: 'src/profile/face-routes.ts',
    touches: ['auth_user.email'],
    reason:
      'Asks Gravatar for a picture by the hash of the address, made each time and never kept.',
  },
  {
    file: 'src/profile/store.ts',
    touches: ['.email', 'auth_user.email'],
    reason:
      'The one function that reads a person’s address by their id, for their settings, their export and their picture.',
  },
  {
    file: 'src/site/settings-account-frame.ts',
    touches: ['.email'],
    reason: 'Shows a person their own address in their settings.',
  },
  {
    file: 'src/site/settings-pages.ts',
    touches: ['.email'],
    reason:
      'Hands the person’s own address to the settings page’s account frame.',
  },
  {
    file: 'src/site/settings-routes.ts',
    touches: ['auth_user.email'],
    reason: 'Reads the person’s own address for their settings page.',
  },
]

/** Functions that return an address, so that importing one is reading it. */
export const ADDRESS_ACCESSORS: readonly Readonly<{
  module: string
  name: string
  touches: string
}>[] = [
  {
    module: 'src/profile/store.ts',
    name: 'readEmail',
    touches: 'auth_user.email',
  },
]

/** Names whose `.email` is not a subscriber’s address, and why. */
export const IGNORED_RECEIVERS: readonly Readonly<{
  name: string
  reason: string
}>[] = [
  {
    name: 'operator',
    reason: 'The operator’s own address, which Cloudflare Access passes.',
  },
  {
    name: 'payload',
    reason:
      'The claims of the Access token, which carry the operator’s address.',
  },
  { name: 'z', reason: 'zod’s `z.email()`, a validator and not a value.' },
  {
    name: 't',
    reason:
      'The words of a screen: `t.email` is the label “Email address”, not an address.',
  },
]

/** One thing a subscriber is told about where their address is used. */
export type Scene = Readonly<{ ja: string; en: string }>

/** Where a subscriber’s address shows, besides the tables above. */
export type Exposure = Readonly<{
  id: string
  where:
    | Readonly<{
        kind: 'page'
        host: 'site' | 'operator'
        method: 'GET' | 'POST'
        route: string
      }>
    | Readonly<{ kind: 'agent-tool'; tool: string }>
    | Readonly<{ kind: 'mail' }>
  reason: string
  /** What the help article says of it, in the words of the screens. */
  scene: Scene
}>

export const ADDRESS_EXPOSURES: readonly Exposure[] = [
  {
    id: 'settings',
    where: { kind: 'page', host: 'site', method: 'GET', route: '/settings' },
    reason:
      'A person sees their own address, to know which one they sign in with; nobody else does.',
    scene: {
      ja: '「設定」の「アカウント」に、ログインに使うメールアドレスが表示されます。ご本人にだけ見えます。',
      en: 'In “Settings”, “Account” shows the email address you sign in with. Only you can see it.',
    },
  },
  {
    id: 'export-page',
    where: {
      kind: 'page',
      host: 'site',
      method: 'GET',
      route: '/account/export/account.json',
    },
    reason:
      'The account information a person takes out is theirs to keep, and holds their own address (F35).',
    scene: {
      ja: '「設定」の「データを書き出す」で書き出す「アカウント」の情報に、ご本人のメールアドレスが入ります。',
      en: 'The “Account” information you take out in “Settings”, “Export your data” includes your own email address.',
    },
  },
  {
    id: 'export-agent',
    where: { kind: 'agent-tool', tool: 'export_account' },
    reason:
      'The same account information, for an AI agent the person connected and may export with.',
    scene: {
      ja: 'AI エージェントをつないだ場合、エージェントがアカウントの情報を書き出すと、ご本人のメールアドレスが入ります。',
      en: 'If you connect an AI agent and it takes out your account information, that includes your own email address.',
    },
  },
  {
    id: 'login-screen',
    where: { kind: 'page', host: 'site', method: 'POST', route: '/login' },
    reason:
      'The sign-in screen shows back the address the person typed, to say where the code went.',
    scene: {
      ja: 'ログインの画面は、入力したメールアドレスを、コードの送り先として表示します。',
      en: 'The sign-in screen shows the email address you entered, as the place the code was sent to.',
    },
  },
  {
    id: 'login-mail',
    where: { kind: 'mail' },
    reason:
      'The sign-in code is mailed to the address, to the person who asked for it and to no one else.',
    scene: {
      ja: 'ログインのコードを、そのメールアドレスに送ります。',
      en: 'The sign-in code is sent to your email address.',
    },
  },
  {
    id: 'operator-invites',
    where: { kind: 'page', host: 'operator', method: 'GET', route: '/' },
    reason:
      'The operator keeps the list of the people they invited by address and reads it to add and remove (F43 leaves it as it is until sign-up opens, F42).',
    scene: {
      ja: '運営だけが見る画面の、登録を許した人の一覧に、運営が許したメールアドレスが載ります。',
      en: 'The list of people allowed to sign up, in the screen only the operator sees, shows the email addresses the operator allowed.',
    },
  },
]
