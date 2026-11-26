// One row per slide of a person, as the list of their slides reads it, and
// what is made of a row. Pure.
import { z } from 'zod'
import { parseDeckPublication } from '../publication/state'
import type { Publication } from '../publication/state'
import type { PointedVersion } from '../publication/store'
import { exportVersions, type ExportVersions } from './versions'

/** A row of the slide list query. */
export const slideRowSchema = z.object({
  slug: z.string(),
  created_at: z.number().int(),
  first_published_at: z.number().int().nullable(),
  paused_at: z.number().int().nullable(),
  hidden_at: z.number().int().nullable(),
  public_deployment_id: z.string().nullable(),
  resume_deployment_id: z.string().nullable(),
  pointed_id: z.string().nullable(),
  pointed_ready_at: z.number().int().nullable(),
  pointed_order: z.number().int().nullable(),
  pointed_title: z.string().nullable(),
  latest_id: z.string().nullable(),
  latest_ready_at: z.number().int().nullable(),
  latest_order: z.number().int().nullable(),
  latest_title: z.string().nullable(),
  has_article: z.number().int(),
})
export type SlideRow = z.infer<typeof slideRowSchema>

export type SlideSummary = Readonly<{
  slug: string
  /** The title of the version shown, or null while none was received. */
  title: string | null
  publication: Publication['kind']
  hiddenByOperator: boolean
  createdAt: number
  firstPublishedAt: number | null
  versions: ExportVersions
  hasArticle: boolean
}>

function versionOf(row: SlideRow, name: 'pointed' | 'latest') {
  const id = row[`${name}_id`]
  const readyAt = row[`${name}_ready_at`]
  const order = row[`${name}_order`]
  return id === null || readyAt === null || order === null
    ? null
    : ({ deploymentId: id, readyAt, order } satisfies PointedVersion)
}

/** What a list needs of a slide, from its row. */
export function summarizeSlide(row: SlideRow): SlideSummary {
  const { publication } = parseDeckPublication({
    paused_at: row.paused_at,
    public_deployment_id: row.public_deployment_id,
    resume_deployment_id: row.resume_deployment_id,
    revision: 0,
  })
  const versions = exportVersions(
    publication,
    versionOf(row, 'pointed'),
    versionOf(row, 'latest'),
  )
  return {
    slug: row.slug,
    title: row.pointed_title ?? row.latest_title,
    publication: publication.kind,
    hiddenByOperator: row.hidden_at !== null,
    createdAt: row.created_at,
    firstPublishedAt: row.first_published_at,
    versions,
    hasArticle: row.has_article > 0,
  }
}
