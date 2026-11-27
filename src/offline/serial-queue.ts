/**
 * A queue that runs its tasks one at a time, in the order they were added:
 * a task starts only after the one before it has settled, whether that one
 * succeeded or failed. A failure reaches the caller of that task only; the
 * tasks after it still run.
 */
export function serialQueue(): <T>(task: () => Promise<T>) => Promise<T> {
  let tail: Promise<unknown> = Promise.resolve()
  return (task) => {
    const result = tail.then(task)
    tail = result.catch(() => {})
    return result
  }
}
