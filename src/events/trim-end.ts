/**
 * The text without the given characters at its end. A loop rather than a
 * pattern such as `/x+$/`, which a search engine retries from every start
 * and so takes quadratic time on a long run that does not reach the end.
 */
export function trimEnd(text: string, characters: string): string {
  let end = text.length
  while (end > 0 && characters.includes(text.charAt(end - 1))) end -= 1
  return text.slice(0, end)
}
