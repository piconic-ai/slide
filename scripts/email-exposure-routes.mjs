// Which of an app's GET routes a list of sample paths covers. Pure. A route
// is written as Hono writes it: `/a/:id`, `/a/:id{(?:x|y)}`, `/a/*`.

const escape = (text) => text.replace(/[.+?^${}()|[\]\\]/g, '\\$&')

/** The expression a path must match to be answered by this route. */
export function routePattern(route) {
  const segments = route
    .split('/')
    .slice(1)
    .map((segment) => {
      if (segment === '*') return '.*'
      const parameter = /^:[A-Za-z0-9_]+(?:\{(.+)\})?$/.exec(segment)
      if (parameter) return parameter[1] ? `(?:${parameter[1]})` : '[^/]+'
      return escape(segment)
    })
  return new RegExp(`^/${segments.join('/')}$`)
}

/** The sample paths of a list, without their query and fragment. */
const pathOf = (sample) => sample.replace(/[?#].*$/, '')

/** The GET routes that no sample path is answered by, sorted. */
export function uncovered(routes, samples) {
  const paths = samples.map(pathOf)
  return routes
    .filter((route) => !paths.some((path) => routePattern(route).test(path)))
    .toSorted()
}
