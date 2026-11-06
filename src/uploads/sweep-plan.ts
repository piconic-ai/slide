/** An R2 object under a deployment prefix, with its upload time in seconds. */
export type ListedObject = Readonly<{ key: string; uploaded: number }>

export type SweepTarget = Readonly<{
  id: string
  state: 'ready' | 'failed' | 'expired'
}>

export type SweepPlan = Readonly<{
  /** Keys that can be deleted now. */
  delete: readonly string[]
  /** False when a young object was kept, so the deployment is visited again. */
  complete: boolean
}>

/**
 * Plans which objects under one deployment prefix to delete. A ready
 * deployment keeps every object its file map references; a closed one keeps
 * nothing. Objects younger than the grace period are kept because a receive
 * may still be writing them.
 */
export function planSweep(
  target: SweepTarget,
  listed: readonly ListedObject[],
  referenced: ReadonlySet<string>,
  now: number,
  graceSeconds: number,
): SweepPlan {
  const removable = listed.filter(
    ({ key }) => target.state !== 'ready' || !referenced.has(key),
  )
  const old = removable.filter(({ uploaded }) => uploaded <= now - graceSeconds)
  return {
    delete: old.map(({ key }) => key),
    complete: old.length === removable.length,
  }
}
