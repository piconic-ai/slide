/**
 * Whether the viewer has a column beside the article. It has one only when
 * there is something for it besides the author: a description, related
 * links, or citations. Otherwise the author's row alone sits under the title
 * and the column is not made.
 */
export const hasSideColumn = (parts: {
  description: string | null
  links: number
  citations: number
}): boolean =>
  (parts.description ?? '').trim() !== '' ||
  parts.links > 0 ||
  parts.citations > 0
