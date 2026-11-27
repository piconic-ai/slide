/**
 * Who may sign up: only the people the operator invited, or anyone with an
 * email address (F42). The setting is `OPEN_SIGNUP`; in production it is a
 * secret, put and deleted with `wrangler`, never changed from the operator's
 * pages. A plain value set in Cloudflare's dashboard is lost at the next
 * release.
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

/** What the setting and the operator's switch say about new sign-ups now. */
export type SignupState = Readonly<{
  mode: SignupMode
  /** The operator stopped new sign-ups (D-129). */
  paused: boolean
}>

/** What is known of an address: whether it is invited, and whether it has registered. */
export type Standing = Readonly<{ invited: boolean; registered: boolean }>

/**
 * Whether an address may be mailed a login code, and whether the code may
 * sign it in. An invite-only service admits the invited; an open one admits
 * every address. While the operator has stopped new sign-ups, only a person
 * who has registered is admitted, whichever the mode: an invited address that
 * has not registered yet is a new sign-up too (F42-AC12, F42-AC13). Both
 * parts of the standing are read the same way for every address, whatever the
 * mode and the switch, so that the work done for an address does not tell
 * what it is (F28-AC9, F42-AC14).
 */
export function admitsSignIn(state: SignupState, standing: Standing): boolean {
  if (state.paused && !standing.registered) return false
  return state.mode === 'open' || standing.invited
}
