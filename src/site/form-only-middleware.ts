import type { MiddlewareHandler } from 'hono'

const formType =
  /^(?:application\/x-www-form-urlencoded|multipart\/form-data)[ \t]*(?:;|$)/i

export const formOnly: MiddlewareHandler = async (c, next) => {
  if (!formType.test(c.req.header('Content-Type') ?? ''))
    return c.text('Unsupported Media Type', 415)
  await next()
}
