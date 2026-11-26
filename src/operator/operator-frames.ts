/** Reads what one frame shows; each frame has a reader of its own. */
export type FrameReader<View> = (env: Env) => Promise<View>

/** Runs every reader of a table and keeps each answer under its name. */
export async function readFrames<
  Readers extends Record<string, FrameReader<unknown>>,
>(
  readers: Readers,
  env: Env,
): Promise<{ [K in keyof Readers]: Awaited<ReturnType<Readers[K]>> }> {
  const names = Object.keys(readers) as (keyof Readers)[]
  const views = await Promise.all(names.map((name) => readers[name]!(env)))
  return Object.fromEntries(names.map((name, i) => [name, views[i]])) as {
    [K in keyof Readers]: Awaited<ReturnType<Readers[K]>>
  }
}
