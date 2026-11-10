/**
 * Test helper: the Japanese text an English page still shows. Text inside an
 * element marked `lang="ja"` is meant to be Japanese (the switcher's own
 * label, text that exists only in Japanese) and is skipped. Scripts and
 * styles are not shown, so they are skipped too.
 */
const JAPANESE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u
const VOID = new Set(['meta', 'link', 'input', 'br', 'img', 'hr', 'source'])
const SHOWN_ATTRIBUTES = ['title', 'aria-label', 'placeholder', 'alt', 'value']
const TOKEN =
  /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][\w-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>|([^<]+)/g

const attribute = (attributes: string, name: string) =>
  new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i')
    .exec(attributes)
    ?.slice(1)
    .find((value) => value !== undefined)

type Element = Readonly<{ name: string; ja: boolean }>

/** Japanese in the attributes a reader sees or hears, as for a button. */
const shownAttributes = (attributes: string) =>
  SHOWN_ATTRIBUTES.map((name) => attribute(attributes, name)).filter(
    (value): value is string => !!value && JAPANESE.test(value),
  )

const opens = (name: string, attributes: string) =>
  !VOID.has(name) && !attributes.trimEnd().endsWith('/')

/** The open elements once `name` closes, dropping any left unclosed. */
function close(open: readonly Element[], name: string) {
  const at = open.findLastIndex((element) => element.name === name)
  return at === -1 ? open : open.slice(0, at)
}

type State = {
  found: string[]
  /** Each open element and whether it is, or sits inside, Japanese text. */
  open: readonly Element[]
  /** The script or style whose content is being skipped. */
  hidden: string | null
}

const inJapanese = (state: State) => state.open.at(-1)?.ja ?? false

function openTag(state: State, name: string, attributes: string) {
  const lang = attribute(attributes, 'lang')
  const ja = lang === undefined ? inJapanese(state) : lang === 'ja'
  if (!ja) state.found.push(...shownAttributes(attributes))
  if (name === 'script' || name === 'style') state.hidden = name
  else if (opens(name, attributes)) state.open = [...state.open, { name, ja }]
}

function step(state: State, [, closing, rawName, attributes, text]: string[]) {
  const name = rawName?.toLowerCase()
  if (state.hidden) {
    if (closing && name === state.hidden) state.hidden = null
  } else if (text !== undefined) {
    if (!inJapanese(state) && JAPANESE.test(text)) state.found.push(text.trim())
  } else if (name && closing) state.open = close(state.open, name)
  else if (name) openTag(state, name, attributes ?? '')
}

export function japaneseOutside(page: string): string[] {
  const state: State = { found: [], open: [], hidden: null }
  for (const token of page.matchAll(TOKEN)) step(state, token)
  return state.found
}
