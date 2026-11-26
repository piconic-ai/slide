/**
 * Who may sign up: only the people the operator invited, or anyone with an
 * email address (F42). The setting is `OPEN_SIGNUP` and is changed with
 * `wrangler` or in Cloudflare's dashboard, never from the operator's pages.
 */
export type SignupMode = 'invitation' | 'open'

/**
 * The mode a setting means. Only the exact value `on` opens sign-up: a
 * missing, empty or mistaken value (`ON`, `true`, `1`, a typo) keeps the
 * service invite-only, so a mistake never opens the door (D-125).
 */
export function signupModeOf(setting: unknown): SignupMode {
  return setting === 'on' ? 'open' : 'invitation'
}

/**
 * The name an invitation row carries when the service itself made it, for a
 * person who signed up while sign-up was open. The operator's own
 * invitations carry the operator's address, which is never this word, so the
 * two are told apart without a new column.
 */
export const OPEN_SIGNUP_INVITER = 'open-signup'

/**
 * Whether an address may be mailed a login code, and whether the code may
 * sign it in. An invite-only service admits the invited; an open one admits
 * every address. What `invited` is for an address is the invitation list's
 * answer, read the same way whatever the mode, so that the work done for an
 * address does not tell its standing.
 */
export function admitsSignIn(mode: SignupMode, invited: boolean): boolean {
  return mode === 'open' || invited
}
