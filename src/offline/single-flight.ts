/**
 * Makes a job that must never run twice at once. A call made while the job
 * runs does not start another run beside it: it is answered by the run in
 * progress, and one more run follows it (with the latest argument), because what the caller just wrote
 * may have come after the running job read it. Any number of calls made
 * during one run share that one follow-up run.
 */
export function singleFlight<Arg>(
  job: (arg: Arg) => Promise<void>,
): (arg: Arg) => Promise<void> {
  let running: Promise<void> | null = null
  let again = false
  let latest: Arg
  const loop = async () => {
    do {
      again = false
      await job(latest)
    } while (again)
  }
  return (arg) => {
    latest = arg
    if (running) {
      again = true
      return running
    }
    running = loop().finally(() => {
      running = null
    })
    return running
  }
}
