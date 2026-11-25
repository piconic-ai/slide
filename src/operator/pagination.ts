/** How many hidden decks one page of the operator's list shows. */
export const PAGE_SIZE = 50

/** A page number from a query, counted from 1; anything else is page 1. */
export function parsePage(value: string | undefined): number {
  if (value === undefined || !/^[1-9][0-9]{0,5}$/.test(value)) return 1
  return Number(value)
}
