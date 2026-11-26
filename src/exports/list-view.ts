// What the settings page lists of a person's slides for export (02-PAGES 09).
// Pure: summaries in, rows and page numbers out.
import type { DownloadLink } from '../site/download-links'
import type { Lang } from '../site/i18n'
import { slideDownloadLinks } from './links'
import type { SlideSummary } from './slide-rows'

/** How many slides one page of the export list shows (F35-AC16). */
export const EXPORT_SLIDES_PER_PAGE = 20

/** One slide's row: its name, its state, and what can be taken of it. */
export type ExportSlideRow = Readonly<{
  slug: string
  name: string
  state: SlideSummary['publication']
  hiddenByOperator: boolean
  links: readonly DownloadLink[]
}>

export const exportSlideRows = (
  summaries: readonly SlideSummary[],
  lang: Lang,
): readonly ExportSlideRow[] =>
  summaries.map((slide) => ({
    slug: slide.slug,
    name: slide.title ?? slide.slug,
    state: slide.publication,
    hiddenByOperator: slide.hiddenByOperator,
    links: slideDownloadLinks(
      {
        slug: slide.slug,
        versions: slide.versions,
        hasArticle: slide.hasArticle,
      },
      lang,
    ),
  }))

/** How many pages `total` slides make; one even for none. */
export const exportPageCount = (total: number): number =>
  Math.max(1, Math.ceil(total / EXPORT_SLIDES_PER_PAGE))

/**
 * The page a `?export=` names, counted from 1. Anything but a plain number
 * names the first page; a number past the end names the last.
 */
export function exportPageOf(input: string | undefined, total: number): number {
  const last = exportPageCount(total)
  if (input === undefined || !/^[1-9][0-9]{0,5}$/.test(input)) return 1
  return Math.min(Number(input), last)
}

/** The row range a page shows, for a query's limit and offset. */
export const exportWindow = (page: number) => ({
  limit: EXPORT_SLIDES_PER_PAGE,
  offset: (page - 1) * EXPORT_SLIDES_PER_PAGE,
})

/** The settings address of an export page, keeping the page's other query. */
export function exportPageHref(url: URL, page: number): string {
  const params = new URLSearchParams(url.search)
  params.delete('saved')
  if (page <= 1) params.delete('export')
  else params.set('export', String(page))
  const query = params.toString()
  return `/settings${query ? `?${query}` : ''}#export`
}
