/**
 * What one address's checks have come to. `failures` counts the checks that
 * failed in a row. `noticeSent` is true while a "cannot open" notice has gone
 * out and no "can open again" one has. `lastNoticeAt` is when a "cannot open"
 * notice last went out (seconds), kept across recoveries so that an address
 * that flaps is not told again within the hour.
 */
export type TargetState = Readonly<{
  failures: number
  noticeSent: boolean
  lastNoticeAt: number | null
  /** Checks in a row that met maintenance. */
  maintenance: number
}>

export const FRESH_STATE: TargetState = {
  failures: 0,
  noticeSent: false,
  lastNoticeAt: null,
  maintenance: 0,
}

/** What one check saw. */
export type Observation = 'ok' | 'failed' | 'maintenance'

/** What to tell, if anything: the address is down, or it is back. */
export type Action = 'down' | 'recovered' | null

export type Rules = Readonly<{
  /** Failed checks in a row that make a notice (D-57: 2). */
  failuresToTell: number
  /** The least gap between two "cannot open" notices of one address (D-58). */
  throttleSeconds: number
  /**
   * Checks in a row that may meet maintenance before the next is taken as a
   * failure. Maintenance is held on purpose and ends, so a service that
   * answers "maintenance" for longer than this is stuck, or the header is a
   * mistake that hides a fault.
   */
  maintenanceChecksToFail: number
}>

/**
 * The next state and the notice for one check (F39-AC13, AC14, AC15).
 *
 * - One failure tells nothing; `failuresToTell` in a row tell once.
 * - A notice that did not get out (`noticeSent` false) is tried again at the
 *   next failed check, so a failed post is not lost.
 * - A check that finds the address open again, after a notice went out,
 *   tells once that it is back.
 * - A check that meets maintenance is not a check: the failure counts neither
 *   grow nor reset while the service is held on purpose (D-120). But only for
 *   `maintenanceChecksToFail` checks in a row; after that each is a failure.
 */
export function step(
  state: TargetState,
  seen: Observation,
  now: number,
  rules: Rules,
): Readonly<{ state: TargetState; action: Action }> {
  switch (seen) {
    case 'maintenance': {
      const held = state.maintenance + 1
      // Maintenance that goes on past the limit is a failure, not a pause.
      return held > rules.maintenanceChecksToFail
        ? failed({ ...state, maintenance: held }, now, rules)
        : { state: { ...state, maintenance: held }, action: null }
    }
    case 'ok':
      return {
        state: { ...FRESH_STATE, lastNoticeAt: state.lastNoticeAt },
        action: state.noticeSent ? 'recovered' : null,
      }
    case 'failed':
      return failed({ ...state, maintenance: 0 }, now, rules)
  }
}

function failed(
  state: TargetState,
  now: number,
  rules: Rules,
): Readonly<{ state: TargetState; action: Action }> {
  const failures = state.failures + 1
  const held =
    state.lastNoticeAt !== null &&
    now - state.lastNoticeAt < rules.throttleSeconds
  const tell = failures >= rules.failuresToTell && !state.noticeSent && !held
  return tell
    ? {
        state: { ...state, failures, noticeSent: true, lastNoticeAt: now },
        action: 'down',
      }
    : { state: { ...state, failures }, action: null }
}

/** The state after a "cannot open" notice failed to get out: it is tried again. */
export const unsent = (state: TargetState): TargetState => ({
  ...state,
  noticeSent: false,
  lastNoticeAt: null,
})
