// The one place a tool call is counted (D-71, D-72: the agent's tools, call
// by call). Work A fills it with the write to Analytics Engine; until its
// `src/metrics/` is here it does nothing, so a call is told in one line and
// nothing else changes. Now `src/metrics/` is here, and the write is made by
// `record` next to the call of `recordToolUse`.
import type { TOOL_DESCRIPTIONS } from './tools'

/** The tools an agent may call; the names are those the server registers. */
export type ToolName = keyof typeof TOOL_DESCRIPTIONS

/**
 * What is counted of a call: which tool, and whether it answered or why it
 * refused (a fixed code such as `unknown_slide`, never text the agent or the
 * author wrote). No slide, title, path, address or person can be given: the
 * type has no place for them (D-71).
 */
export type ToolUse = Readonly<{
  tool: ToolName
  outcome: 'ok' | Readonly<{ refusedAs: string }>
}>

/** Counts a tool call. Never throws and never waits: a count is not an answer. */
export function recordToolUse(_env: Env, _use: ToolUse): void {
  // The write to Analytics Engine is made beside the call of this function,
  // in `guarded` of src/mcp/server-routes.ts (work A, F40-AC9): this file is
  // in the pure layer and may not reach the binding.
}

/**
 * The outcome of an answer: its refusal code when it is a refusal, else ok.
 * A refusal's `error` is always a fixed code of this server.
 */
export function outcomeOf(result: {
  isError?: true
  structuredContent: Record<string, unknown>
}): ToolUse['outcome'] {
  if (!result.isError) return 'ok'
  const code = result.structuredContent.error
  return { refusedAs: typeof code === 'string' ? code : 'unknown' }
}
