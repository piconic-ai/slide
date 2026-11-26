import type { Context, ErrorHandler, NotFoundHandler } from 'hono'
import { HTTPException } from 'hono/http-exception'
import {
  ERROR_PAGE_POLICY,
  errorJson,
  errorPage,
  errorStatus,
  loggedPath,
  type ErrorKind,
} from './error-pages'
import { langOf } from './lang'

function respond(c: Context, kind: ErrorKind) {
  const status = errorStatus(kind)
  const common = { 'Cache-Control': 'no-store' }
  if (c.req.path.startsWith('/api/'))
    return c.json(errorJson(kind), status, common)
  return c.html(errorPage(kind, langOf(c), new URL(c.req.url)), status, {
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
      path: loggedPath(c.req.path),
      name: error.name,
      message: error.message.slice(0, 200),
    }),
  )
  return respond(c, 'server_error')
}
