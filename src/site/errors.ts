import type {
  Context,
  ErrorHandler,
  MiddlewareHandler,
  NotFoundHandler,
} from 'hono'
import { HTTPException } from 'hono/http-exception'
import {
  ERROR_PAGE_POLICY,
  errorJson,
  errorPage,
  errorStatus,
  isMaintenance,
  MAINTENANCE_RETRY_AFTER_SECONDS,
  type ErrorKind,
} from './error-pages'

function respond(
  c: Context,
  kind: ErrorKind,
  headers: Record<string, string> = {},
) {
  const status = errorStatus(kind)
  const common = { 'Cache-Control': 'no-store', ...headers }
  if (c.req.path.startsWith('/api/'))
    return c.json(errorJson(kind), status, common)
  return c.html(errorPage(kind), status, {
    ...common,
    'Content-Security-Policy': ERROR_PAGE_POLICY,
  })
}

export const notFound: NotFoundHandler = (c) => respond(c, 'not_found')

/**
 * Deliberate HTTP errors keep their own response, with headers set before the
 * throw. Anything else is logged with a bounded message and shown as a 500
 * that reveals nothing about the cause.
 */
export const onError: ErrorHandler = (error, c) => {
  if (error instanceof HTTPException) {
    const response = error.getResponse()
    return c.newResponse(response.body, response)
  }
  console.error(
    JSON.stringify({
      event: 'unhandled_error',
      path: c.req.path,
      name: error.name,
      message: error.message.slice(0, 200),
    }),
  )
  return respond(c, 'server_error')
}

/** Set the MAINTENANCE secret to "on" to answer every request with 503. */
export const maintenance: MiddlewareHandler<{ Bindings: Env }> = (c, next) =>
  isMaintenance(c.env.MAINTENANCE)
    ? Promise.resolve(
        respond(c, 'maintenance', {
          'Retry-After': String(MAINTENANCE_RETRY_AFTER_SECONDS),
        }),
      )
    : next()
