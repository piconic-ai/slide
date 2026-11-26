import type { Operator } from './access'

/** The operator app's Hono types: the bindings, and who is signed in. */
export type OperatorEnv = {
  Bindings: Env
  Variables: { operator: Operator }
}
