/**
 * What the watcher knows of the maintenance the service is held for (D-120),
 * kept apart from the checks of each address: maintenance is one thing the
 * whole service is held for, however many addresses meet it. It says three
 * things, each told once: that it started, that it ran past its expected end
 * by `overrunSeconds`, and that it ended.
 *
 * `told` is what has gone out. A notice that did not get out is taken back
 * (`unsent`) so that the next run tells it again, as for an address that is down.
 */
export type MaintenancePhase = 'started' | 'overrun' | 'ended'

export type MaintenanceState = Readonly<{
  /** Whether the last run met maintenance and has not since seen it end. */
  active: boolean
  /** The expected end, kept from the last answer that named one (seconds). */
  until: number | null
  told: Readonly<Record<MaintenancePhase, boolean>>
}>

export const NO_MAINTENANCE: MaintenanceState = {
  active: false,
  until: null,
  told: { started: false, overrun: false, ended: false },
}

/** What one run saw of maintenance, over every address it checked. */
export type MaintenanceSight = Readonly<{
  /** Some address answered with the maintenance 503. */
  held: boolean
  /** Some address answered as open, which maintenance does not. */
  open: boolean
  /** The end an answer named, if any did. */
  until: number | null
}>

/** What one run makes of the sight of each address's check. */
export function sightOf(
  checks: readonly Readonly<{ seen: string; until: number | null }>[],
): MaintenanceSight {
  const untils = checks.flatMap((c) => (c.until === null ? [] : [c.until]))
  return {
    held: checks.some((c) => c.seen === 'maintenance'),
    open: checks.some((c) => c.seen === 'ok'),
    until: untils.length === 0 ? null : Math.max(...untils),
  }
}

export type MaintenanceStep = Readonly<{
  state: MaintenanceState
  /** The one notice to tell now, already marked as told in `state`. */
  action: MaintenancePhase | null
}>

const told = (state: MaintenanceState, phase: MaintenancePhase) => ({
  state: { ...state, told: { ...state.told, [phase]: true } },
  action: phase,
})

/**
 * The next state and the notice for one run (F38-AC24, AC25, AC26).
 *
 * - Meeting maintenance when none was known begins an episode and tells that
 *   it started, once. The expected end is kept, and replaced by a later one an
 *   answer names (maintenance may be extended); an answer that names none
 *   leaves the one kept.
 * - Maintenance that goes on for `overrunSeconds` after its expected end tells
 *   so, once. With no expected end there is nothing to run past.
 * - Maintenance gone, with an address open, ends the episode and tells that it
 *   ended, once, if the start was told. A run where nothing is open leaves
 *   the episode as it was: an end is not claimed over a service that is down.
 * - One notice a run, the earliest owed first, so that none is lost to another.
 */
export function stepMaintenance(
  state: MaintenanceState,
  sight: MaintenanceSight,
  now: number,
  overrunSeconds: number,
): MaintenanceStep {
  if (sight.held) {
    const begun: MaintenanceState = state.active
      ? { ...state, until: sight.until ?? state.until }
      : { ...NO_MAINTENANCE, active: true, until: sight.until }
    if (!begun.told.started) return told(begun, 'started')
    const late = begun.until !== null && now >= begun.until + overrunSeconds
    if (late && !begun.told.overrun) return told(begun, 'overrun')
    return { state: begun, action: null }
  }
  const ended: MaintenanceState =
    state.active && sight.open ? { ...state, active: false } : state
  // An end owed: the episode is over, the start was told, the end was not.
  if (!ended.active && ended.told.started && !ended.told.ended)
    return told(ended, 'ended')
  return { state: ended, action: null }
}

/** The state after a notice failed to get out: it is owed again. */
export const unsent = (
  state: MaintenanceState,
  phase: MaintenancePhase,
): MaintenanceState => ({
  ...state,
  told: { ...state.told, [phase]: false },
})
