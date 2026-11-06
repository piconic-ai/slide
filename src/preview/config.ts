import { parseContentBase } from './origin'

/**
 * The configured content origin, or null when delivery is off. A broken
 * setting is logged and disables content delivery, not the management app.
 */
export function contentBaseOf(env: Env): URL | null {
  try {
    return parseContentBase(env.CONTENT_ORIGIN, env.PUBLIC_ORIGIN)
  } catch (error) {
    console.error(
      JSON.stringify({
        event: 'content_origin_invalid',
        message: error instanceof Error ? error.message : 'unknown',
      }),
    )
    return null
  }
}
