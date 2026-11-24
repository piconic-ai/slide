// Lets one inline script through an author's Content Security Policy, and
// nothing else. Pure: a policy and a hash source in, a policy out. The rules
// follow CSP Level 3: a directive's name is matched without regard to case,
// only the first directive of a name counts, and a script element is
// governed by script-src-elem, else script-src, else default-src.

const DIRECTIVE_NAME = /^[A-Za-z0-9-]+$/
const SPACE = /[\t\n\f\r ]+/
const BASE64_VALUE = '[A-Za-z0-9+/_-]+={0,2}'
const HASH_SOURCE = new RegExp(`^'sha(?:256|384|512)-${BASE64_VALUE}'$`, 'i')
const NONCE_SOURCE = new RegExp(`^'nonce-${BASE64_VALUE}'$`, 'i')

type Directive = Readonly<{
  /** The lowercase name. */
  name: string
  /** The name as written. */
  written: string
  sources: readonly string[]
  /** Which `;`-separated part of the policy holds it. */
  part: number
}>

/** The directives a policy enforces: the first of each valid name. */
function directivesOf(policy: string): Directive[] {
  const directives: Directive[] = []
  for (const [part, text] of policy.split(';').entries()) {
    const [name = '', ...sources] = text.trim().split(SPACE)
    const key = name.toLowerCase()
    if (!DIRECTIVE_NAME.test(name)) continue
    if (directives.some((directive) => directive.name === key)) continue
    directives.push({ name: key, written: name, sources, part })
  }
  return directives
}

/**
 * Whether a source list lets every inline script run: it has
 * 'unsafe-inline', and no nonce, hash or 'strict-dynamic', any of which
 * makes a browser ignore 'unsafe-inline'.
 */
export function allowsAllInline(sources: readonly string[]): boolean {
  const lower = sources.map((source) => source.toLowerCase())
  if (sources.some((s) => HASH_SOURCE.test(s) || NONCE_SOURCE.test(s)))
    return false
  if (lower.includes("'strict-dynamic'")) return false
  return lower.includes("'unsafe-inline'")
}

/**
 * The sources with the hash added. 'none' goes: next to another source it
 * allows nothing more, and browsers warn about the pair.
 */
const withHash = (sources: readonly string[], hash: string) => [
  ...sources.filter((source) => source.toLowerCase() !== "'none'"),
  hash,
]

/** The policy with one `;`-separated part written anew, its spacing kept. */
function replacePart(policy: string, part: number, text: string) {
  const parts = policy.split(';')
  const [, before = '', after = ''] = /^(\s*)[\s\S]*?(\s*)$/.exec(parts[part])!
  parts[part] = `${before}${text}${after}`
  return parts.join(';')
}

/** The policy with a directive added at its end. */
function appendDirective(policy: string, text: string) {
  const kept = policy.trimEnd()
  if (kept === '') return text
  return kept.endsWith(';') ? `${kept} ${text}` : `${kept}; ${text}`
}

/**
 * The policy changed so that an inline script with `hash` (a hash source,
 * `'sha256-…'`) runs, and allowing nothing else that it did not allow.
 * The policy comes back as it was when such a script already runs: no
 * directive governs scripts, or the governing one has 'unsafe-inline' that
 * a browser honors (a hash added there would make it ignore 'unsafe-inline'
 * and stop the author's own inline scripts), or it names the hash already.
 * Otherwise the hash joins the governing directive. When that is
 * default-src, a script-src with default-src's sources and the hash is
 * added, so default-src keeps governing everything else.
 */
export function withInlineScript(policy: string, hash: string): string {
  const directives = directivesOf(policy)
  const named = (name: string) =>
    directives.find((directive) => directive.name === name)
  const governing =
    named('script-src-elem') ?? named('script-src') ?? named('default-src')
  if (!governing || allowsAllInline(governing.sources)) return policy
  if (governing.sources.includes(hash)) return policy
  const sources = withHash(governing.sources, hash).join(' ')
  if (governing.name === 'default-src')
    return appendDirective(policy, `script-src ${sources}`)
  return replacePart(policy, governing.part, `${governing.written} ${sources}`)
}
