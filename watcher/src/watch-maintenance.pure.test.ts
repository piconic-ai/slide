import { describe, expect, test } from 'vitest'
import {
  NO_MAINTENANCE,
  sightOf,
  stepMaintenance,
  unsent,
  type MaintenancePhase,
  type MaintenanceSight,
  type MaintenanceState,
} from './watch-maintenance'

const END = 10_000
const LATE = 1800
const held = (until: number | null = END): MaintenanceSight => ({
  held: true,
  open: false,
  until,
})
const open: MaintenanceSight = { held: false, open: true, until: null }
const down: MaintenanceSight = { held: false, open: false, until: null }

/** Runs a story of sights, one a run, and says what was told in each. */
function run(story: readonly (readonly [number, MaintenanceSight])[]) {
  let state: MaintenanceState = NO_MAINTENANCE
  const told: (MaintenancePhase | null)[] = []
  for (const [now, sight] of story) {
    const next = stepMaintenance(state, sight, now, LATE)
    state = next.state
    told.push(next.action)
  }
  return { state, told }
}

describe('F38-AC25: started and ended, once each', () => {
  test('Given a service that is open, When it is checked again and again, Then nothing is told', () => {
    expect(
      run([
        [0, open],
        [300, open],
        [600, open],
      ]).told,
    ).toEqual([null, null, null])
  })

  test('Given maintenance that begins, goes on and ends, When the runs follow, Then it is told once that it started and once that it ended', () => {
    const { told } = run([
      [0, open],
      [300, held()],
      [600, held()],
      [900, held()],
      [1200, open],
      [1500, open],
    ])
    expect(told).toEqual([null, 'started', null, null, 'ended', null])
  })

  test('Given an end told, When another maintenance begins later, Then it is a new episode and tells its start again', () => {
    const { told } = run([
      [0, held()],
      [300, open],
      [600, held()],
      [900, open],
    ])
    expect(told).toEqual(['started', 'ended', 'started', 'ended'])
  })

  test('Given maintenance that is met on one address only, When the others are open, Then it is held all the same', () => {
    expect(
      sightOf([
        { seen: 'maintenance', until: null },
        { seen: 'ok', until: null },
        { seen: 'ok', until: null },
      ]),
    ).toEqual({ held: true, open: true, until: null })
    // Held wins over open: the service is held while any address says so.
    expect(run([[0, { held: true, open: true, until: null }]]).told).toEqual([
      'started',
    ])
  })
})

describe('F38-AC25: an end is not claimed over a service that is down', () => {
  test('Given maintenance and then runs where every address fails, When they follow, Then the end is not told until an address is open', () => {
    const { told } = run([
      [0, held()],
      [300, down],
      [600, down],
      [900, open],
      [1200, open],
    ])
    expect(told).toEqual(['started', null, null, 'ended', null])
  })

  test('Given maintenance, then failures, then maintenance again, When the runs follow, Then it is still the one episode: no second start', () => {
    const { told } = run([
      [0, held()],
      [300, down],
      [600, held()],
    ])
    expect(told).toEqual(['started', null, null])
  })
})

describe('F38-AC26: past the expected end by half an hour', () => {
  test.each([
    ['one second before', END + LATE - 1, null],
    ['exactly', END + LATE, 'overrun'],
    ['a day after', END + 86_400, 'overrun'],
  ])(
    'Given maintenance that began before its end, When a run is made %s the limit, Then %s',
    (_, now, action) => {
      const { told } = run([
        [0, held()],
        [now, held()],
      ])
      expect(told).toEqual(['started', action])
    },
  )

  test('Given an overrun told, When the maintenance goes on, Then it is not told again, and when it ends the end is told', () => {
    const { told } = run([
      [0, held()],
      [END + LATE, held()],
      [END + LATE + 300, held()],
      [END + LATE + 600, held()],
      [END + LATE + 900, open],
    ])
    expect(told).toEqual(['started', 'overrun', null, null, 'ended'])
  })

  test('Given maintenance that ends before the limit, When it ends, Then no overrun is told', () => {
    expect(
      run([
        [0, held()],
        [END + LATE - 300, open],
      ]).told,
    ).toEqual(['started', 'ended'])
  })

  test('Given maintenance with no end named, When it goes on for days, Then there is nothing to run past and no overrun is told', () => {
    const { told } = run([
      [0, held(null)],
      [86_400, held(null)],
      [999_999, held(null)],
    ])
    expect(told).toEqual(['started', null, null])
  })

  test('Given the end named at first and not later (it has passed), When the runs follow, Then the end that was kept is the one that counts', () => {
    const { told } = run([
      [0, held(END)],
      [END + 300, held(null)],
      [END + LATE, held(null)],
    ])
    expect(told).toEqual(['started', null, 'overrun'])
  })

  test('Given an end that is put later while the maintenance runs, When the runs follow, Then the later end counts and no overrun is told at the first', () => {
    const { told } = run([
      [0, held(END)],
      [END - 300, held(END + 7200)],
      [END + LATE, held(END + 7200)],
      [END + 7200 + LATE, held(END + 7200)],
    ])
    expect(told).toEqual(['started', null, null, 'overrun'])
  })

  test('Given maintenance first seen long after its end, When the run is made, Then the start is told first and the overrun in the next run', () => {
    expect(
      run([
        [END + 5 * LATE, held()],
        [END + 5 * LATE + 300, held()],
      ]).told,
    ).toEqual(['started', 'overrun'])
  })
})

describe('F38-AC25: a notice that did not get out is told again', () => {
  test.each(['started', 'overrun', 'ended'] as const)(
    'Given the notice %s was taken back, When the next run is made, Then it is owed and told again',
    (phase) => {
      const story: [number, MaintenanceSight][] = [[0, held()]]
      if (phase !== 'started') story.push([END + LATE, held()])
      if (phase === 'ended') story.push([END + LATE + 300, open])
      let state: MaintenanceState = NO_MAINTENANCE
      let last: MaintenancePhase | null = null
      for (const [now, sight] of story) {
        const next = stepMaintenance(state, sight, now, LATE)
        state = next.state
        last = next.action
      }
      expect(last).toBe(phase)
      state = unsent(state, phase)
      const again = stepMaintenance(
        state,
        phase === 'ended' ? open : held(),
        END + LATE + 600,
        LATE,
      )
      expect(again.action).toBe(phase)
    },
  )

  test('Given the start never got out, When the maintenance ends, Then no end is told over a start that was not', () => {
    let state: MaintenanceState = NO_MAINTENANCE
    state = stepMaintenance(state, held(), 0, LATE).state
    state = unsent(state, 'started')
    // Still held: the start is told now.
    const retried = stepMaintenance(state, held(), 300, LATE)
    expect(retried.action).toBe('started')
  })

  test('Given a start that was taken back and then the maintenance ended, When the run is made, Then the end is not told', () => {
    let state = stepMaintenance(NO_MAINTENANCE, held(), 0, LATE).state
    state = unsent(state, 'started')
    expect(stepMaintenance(state, open, 300, LATE).action).toBeNull()
  })
})

describe('the sight of one run', () => {
  test('Given no address checked, When the sight is made, Then it is neither held nor open', () => {
    expect(sightOf([])).toEqual({ held: false, open: false, until: null })
  })

  test('Given ends named by several addresses, When the sight is made, Then the latest counts', () => {
    expect(
      sightOf([
        { seen: 'maintenance', until: 5 },
        { seen: 'maintenance', until: 9 },
        { seen: 'failed', until: null },
      ]).until,
    ).toBe(9)
  })
})
