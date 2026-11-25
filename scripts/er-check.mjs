// Pure: whether the committed document matches the generated one, and what to say.

/** The shell command that regenerates the document. */
export const REGENERATE = 'pnpm db:er'

/**
 * @param {string | null} committed the file's text, or null when it is missing
 * @param {string} generated
 * @returns {{ ok: true } | { ok: false, message: string }}
 */
export function compareDocument(committed, generated) {
  if (committed === generated) return { ok: true }
  const reason =
    committed === null
      ? 'docs/dev/er-diagram.md does not exist'
      : 'docs/dev/er-diagram.md is out of date with migrations/'
  return {
    ok: false,
    message: `${reason}. Run \`${REGENERATE}\` and commit the result.`,
  }
}
