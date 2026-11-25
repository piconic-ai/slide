import type { Handle } from '../share/handle'

/**
 * Where a canonical share path under a handle an operator changed moves:
 * the same path and query under the new handle, such as `/@old/talk/3?lang=en`
 * to `/@new/talk/3?lang=en`. A path not under `from` is left as it is.
 */
export function movedPath(
  pathname: string,
  search: string,
  from: Handle,
  to: Handle,
): string {
  const prefix = `/@${from}`
  const rest = pathname.slice(prefix.length)
  if (!pathname.startsWith(prefix) || (rest !== '' && !rest.startsWith('/')))
    return `${pathname}${search}`
  return `/@${to}${rest}${search}`
}
