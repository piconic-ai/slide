import { helpArticlePath } from '../help/paths'
import { toolResult, type ToolResult } from './tools'

/**
 * The article of the help that explains a refusal, by the refusal's code
 * (F36-AC47). A code with no article of its own is not here: its answer
 * already says what to do. The agent passes the address on to the author.
 */
const HELP_PATHS: Readonly<Record<string, string>> = {
  reconnect_required: helpArticlePath('agent', 'reconnect'),
  invalid_cursor: helpArticlePath('agent', 'export-with-agent'),
  stale_cursor: helpArticlePath('agent', 'export-with-agent'),
  not_allowed: helpArticlePath('safety', 'appeal'),
  too_many_files: helpArticlePath('slides', 'limits'),
  file_too_large: helpArticlePath('slides', 'limits'),
  deployment_too_large: helpArticlePath('slides', 'limits'),
  author_bytes_exceeded: helpArticlePath('slides', 'limits'),
  daily_starts_exceeded: helpArticlePath('slides', 'limits'),
  deck_limit: helpArticlePath('slides', 'limits'),
}

/** The address of the article for a refusal's code, or null when it has none. */
export const helpUrlOf = (code: string, origin: string): string | null => {
  const path = Object.hasOwn(HELP_PATHS, code) ? HELP_PATHS[code]! : null
  return path === null ? null : new URL(path, origin).href
}

/**
 * A refusal with the address of its article added as `help`; anything else,
 * and a refusal with no article, as it was. The words of the refusal do not
 * change.
 */
export function withHelpUrl(result: ToolResult, origin: string): ToolResult {
  const code = result.structuredContent.error
  if (result.isError !== true || typeof code !== 'string') return result
  const help = helpUrlOf(code, origin)
  if (help === null) return result
  return {
    ...toolResult({ ...result.structuredContent, help }),
    isError: true,
  }
}
