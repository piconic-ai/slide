/** How many people one page of a following or followers list shows. */
export const PEOPLE_PER_PAGE = 50

/** The last page a list can name: far past any list, and safe to multiply. */
const MAX_PEOPLE_PAGE = 100_000

/**
 * The page a list's `?page=` names, counted from 1. No value is the first
 * page. Anything but a plain number in range names no page.
 */
export function parsePeoplePage(input: string | null): number | null {
  if (input === null) return 1
  if (!/^[1-9][0-9]{0,5}$/.test(input)) return null
  const page = Number(input)
  return page <= MAX_PEOPLE_PAGE ? page : null
}

/** Where the pages before and after this one are, when there are any. */
export function neighbourPages(
  page: number,
  total: number,
): Readonly<{ previous: number | null; next: number | null }> {
  const last = Math.max(1, Math.ceil(total / PEOPLE_PER_PAGE))
  return {
    // A page past the end leads back to the last page that has people.
    previous: page > 1 ? Math.min(page - 1, last) : null,
    next: page < last ? page + 1 : null,
  }
}

/** The letter that stands for a person who has no picture. */
export const initialOf = (name: string): string =>
  (Array.from(name.trim())[0] ?? '?').toUpperCase()
