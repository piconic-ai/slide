// The information file of one slide (D-33). Pure: facts in, the JSON value out.
import type { Publication } from '../publication/state'
import type { ExportRole } from './versions'

/**
 * The shape version of the file. A reader that finds a number it does not
 * know should not guess. Raised when a field changes meaning or is removed;
 * adding a field does not raise it.
 */
export const SLIDE_INFO_SCHEMA_VERSION = 1

export type SlideInfoFile = Readonly<{
  path: string
  size: number
  sha256: string
  mediaType: string
}>

export type SlideInfoInput = Readonly<{
  exportedAt: number
  slide: Readonly<{
    urlName: string
    title: string | null
    publication: Publication['kind']
    hiddenByOperator: boolean
    createdAt: number
    firstPublishedAt: number | null
    /** The slide's share URL, or null before its author has a handle. */
    shareUrl: string | null
  }>
  links: readonly Readonly<{
    kind: string
    url: string
    title: string | null
  }>[]
  events: readonly Readonly<{
    service: string
    name: string | null
    ref: string
  }>[]
  article: Readonly<{
    status: 'draft' | 'published'
    updatedAt: number
    hasUnpublishedEdit: boolean
  }> | null
  versions: readonly Readonly<{
    role: ExportRole
    deploymentId: string
    title: string | null
    description: string | null
    receivedAt: number
    totalBytes: number
    files: readonly SlideInfoFile[]
  }>[]
}>

const iso = (seconds: number) => new Date(seconds * 1000).toISOString()
const isoOrNull = (seconds: number | null) =>
  seconds === null ? null : iso(seconds)

/**
 * The file as a value to print as JSON. Times are ISO 8601 in UTC. Nothing
 * here names a user, an object key in storage, or an internal ID except the
 * version's, which names the version in the zip's file name.
 */
export function slideInfo(input: SlideInfoInput) {
  const { slide } = input
  return {
    schemaVersion: SLIDE_INFO_SCHEMA_VERSION,
    kind: 'slide',
    exportedAt: iso(input.exportedAt),
    slide: {
      urlName: slide.urlName,
      title: slide.title,
      state: slide.publication,
      hiddenByOperator: slide.hiddenByOperator,
      createdAt: iso(slide.createdAt),
      firstPublishedAt: isoOrNull(slide.firstPublishedAt),
      shareUrl: slide.shareUrl,
    },
    relatedLinks: input.links.map(({ kind, url, title }) => ({
      kind,
      url,
      title,
    })),
    events: input.events.map(({ service, name, ref }) => ({
      service,
      name,
      ref,
    })),
    article: input.article && {
      status: input.article.status,
      updatedAt: iso(input.article.updatedAt),
      hasUnpublishedEdit: input.article.hasUnpublishedEdit,
    },
    versions: input.versions.map((version) => ({
      role: version.role,
      deploymentId: version.deploymentId,
      title: version.title,
      description: version.description,
      receivedAt: iso(version.receivedAt),
      totalBytes: version.totalBytes,
      files: version.files.map(({ path, size, sha256, mediaType }) => ({
        path,
        size,
        sha256,
        mediaType,
      })),
    })),
  }
}

/** The JSON text of a file: indented, ending in a newline. */
export const jsonText = (value: unknown) =>
  `${JSON.stringify(value, null, 2)}\n`
