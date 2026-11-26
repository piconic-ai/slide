// Runs tasks at the moments of a schedule, at most `maxInFlight` at once. It
// does not wait for one to end before starting the next on time (an open
// loop), except when `maxInFlight` is reached: then the next one waits for a
// place and the run reports how many started late.

/**
 * @param {{
 *   starts: number[],
 *   task: (index: number) => Promise<void>,
 *   maxInFlight: number,
 *   now: () => number,
 *   sleep: (ms: number) => Promise<void>,
 * }} options
 * @returns {Promise<{ seconds: number, started: number, late: number }>}
 */
export async function runSchedule({ starts, task, maxInFlight, now, sleep }) {
  const begun = now()
  const running = new Set()
  const waiting = []
  let late = 0
  let fatal = null
  const release = () => waiting.shift()?.()
  for (const [index, offset] of starts.entries()) {
    // A refusal or a spent budget ends the run: nothing more is started.
    if (fatal) break
    const wait = begun + offset - now()
    if (wait > 0) await sleep(wait)
    if (running.size >= maxInFlight) {
      late++
      await new Promise((resolve) => waiting.push(resolve))
    }
    const promise = task(index)
      .catch((error) => {
        fatal ??= error
      })
      .finally(() => {
        running.delete(promise)
        release()
      })
    running.add(promise)
  }
  await Promise.all(running)
  if (fatal) throw fatal
  return { seconds: (now() - begun) / 1000, started: starts.length, late }
}
