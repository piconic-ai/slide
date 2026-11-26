import { expect, test } from 'vitest'
import {
  FRESH_STATE,
  step,
  unsent,
  type Observation,
  type Rules,
  type TargetState,
} from './watch-step'

const rules: Rules = { failuresToTell: 2, throttleSeconds: 3600 }
const T = 1_000_000

/** Plays checks one after another, five minutes apart, from a fresh state. */
function play(seen: Observation[], from: TargetState = FRESH_STATE) {
  let state = from
  const actions = seen.map((observation, i) => {
    const next = step(state, observation, T + i * 300, rules)
    state = next.state
    return next.action
  })
  return { actions, state }
}

test('F39-AC13: Given one failed check, When it is judged, Then nothing is told', () => {
  expect(play(['failed']).actions).toEqual([null])
})

test('F39-AC13: Given one failed check and then an open one, When they are judged, Then nothing is told, now or after', () => {
  expect(play(['failed', 'ok']).actions).toEqual([null, null])
})

test('F39-AC14: Given two failed checks in a row, When they are judged, Then "down" is told once, at the second', () => {
  expect(play(['failed', 'failed']).actions).toEqual([null, 'down'])
})

test('F39-AC14: Given many failed checks in a row, When they are judged, Then "down" is told once only', () => {
  expect(
    play(['failed', 'failed', 'failed', 'failed', 'failed']).actions,
  ).toEqual([null, 'down', null, null, null])
})

test('F39-AC15: Given a notice told and then an open check, When they are judged, Then "recovered" is told once', () => {
  expect(play(['failed', 'failed', 'ok', 'ok']).actions).toEqual([
    null,
    'down',
    'recovered',
    null,
  ])
})

test('F39-AC13: Given failures that are not in a row, When they are judged, Then they do not add up', () => {
  expect(play(['failed', 'ok', 'failed', 'ok', 'failed']).actions).toEqual([
    null,
    null,
    null,
    null,
    null,
  ])
})

test('F39-AC14: Given a threshold of 3, When two and then three checks fail, Then it is told at the third only', () => {
  let state = FRESH_STATE
  const strict: Rules = { failuresToTell: 3, throttleSeconds: 3600 }
  const actions = [0, 1, 2].map((i) => {
    const next = step(state, 'failed', T + i, strict)
    state = next.state
    return next.action
  })
  expect(actions).toEqual([null, null, 'down'])
})

test('F39-AC16: Given an address that fails, recovers and fails again within the hour, When it is judged, Then the second "down" waits and, silent, so does its recovery', () => {
  const first = play(['failed', 'failed', 'ok'])
  expect(first.actions).toEqual([null, 'down', 'recovered'])
  // The same address fails again twenty minutes after the first notice.
  const second = play(['failed', 'failed', 'ok'], first.state)
  expect(second.actions).toEqual([null, null, null])
})

test('F39-AC16: Given an address that fails again after the hour, When it is judged, Then "down" is told again', () => {
  const first = play(['failed', 'failed', 'ok'])
  const later = step(
    step(first.state, 'failed', T + 4000, rules).state,
    'failed',
    T + 4300,
    rules,
  )
  expect(later.action).toBe('down')
})

test('F39-AC14: Given a notice that did not get out, When the next check fails, Then it is tried again, and once it is sent not again', () => {
  const told = step(
    step(FRESH_STATE, 'failed', T, rules).state,
    'failed',
    T + 300,
    rules,
  )
  expect(told.action).toBe('down')
  const lost = unsent(told.state)
  const retry = step(lost, 'failed', T + 600, rules)
  expect(retry.action).toBe('down')
  expect(step(retry.state, 'failed', T + 900, rules).action).toBeNull()
})

test('Given a notice that did not get out and the address then opens, When it is judged, Then nothing is told, as nothing was down for the operator', () => {
  const told = step(
    step(FRESH_STATE, 'failed', T, rules).state,
    'failed',
    T + 300,
    rules,
  )
  expect(step(unsent(told.state), 'ok', T + 600, rules).action).toBeNull()
})

test('D-120: Given maintenance among failed checks, When they are judged, Then maintenance changes nothing and tells nothing', () => {
  const one = step(FRESH_STATE, 'failed', T, rules)
  const held = step(one.state, 'maintenance', T + 300, rules)
  expect(held).toEqual({ state: one.state, action: null })
  // The failure before maintenance and the one after make two in a row.
  expect(step(held.state, 'failed', T + 600, rules).action).toBe('down')
})

test('D-120: Given a "down" told and then maintenance, When the address opens after it, Then "recovered" is told', () => {
  const down = play(['failed', 'failed', 'maintenance', 'maintenance'])
  expect(down.actions).toEqual([null, 'down', null, null])
  expect(step(down.state, 'ok', T + 2000, rules).action).toBe('recovered')
})
