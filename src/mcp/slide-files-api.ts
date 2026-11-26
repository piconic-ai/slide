import { zipNameProblem } from '../exports/zip-name'
import {
  readExportDeck,
  readVersionFiles,
  type ExportVersionFiles,
} from '../exports/deck-export-store'
import { authSecret } from '../auth/auth-store'
import {
  decodeCursor,
  encodeCursor,
  pageOf,
  type ExportRole,
} from './files-page'
import {
  fileUrlKey,
  fileUrlOf,
  FILE_URL_SECONDS,
  signFileUrl,
} from './file-url'
import {
  slideFilesView,
  type ListedVersion,
  type UnavailableReason,
  type UnavailableVersion,
} from './export-views'
import { toolError, toolResult, type ToolResult } from './tools'

/** What the tool needs of the request it serves. */
type Session = Readonly<{ env: Env; ownerUserId: string; grantId: string }>

const now = () => Math.floor(Date.now() / 1000)
const ROLES = ['published', 'prepared'] as const

type Read = Extract<ExportVersionFiles, { kind: 'files' }>

/**
 * Why a version cannot be saved as it was put up, or null when it can: one
 * of its files has a path that is not safe to write to someone's disk, or is
 * not stored. The version is then left out as a whole (a part of it would
 * not be what was put up) and the other version is not touched by it.
 */
const unsavableReason = (version: Read): UnavailableReason | null => {
  if (version.files.some((file) => zipNameProblem(file.path) !== null))
    return 'unsafe_path'
  if (version.files.some((file) => file.objectKey === null))
    return 'file_not_stored'
  return null
}

/**
 * Lists the files of one of the author's slides, with an address for each
 * that opens it for an hour. The slide, its versions and its files are read
 * with the author as a condition of every query, so another author's slide
 * is the same answer as no slide at all.
 */
export async function getSlideFiles(
  { env, ownerUserId, grantId }: Session,
  slug: string,
  cursorText: string | undefined,
): Promise<ToolResult> {
  const secret = authSecret(env)
  if (!secret) return toolError('unavailable')
  const cursor = cursorText === undefined ? null : decodeCursor(cursorText)
  if (cursorText !== undefined && cursor === null)
    return toolError('invalid_cursor')
  const deck = await readExportDeck(env.DB, ownerUserId, slug)
  if (!deck) return toolError('unknown_slide')
  const reads = await Promise.all(
    ROLES.map(async (role) => {
      const version = deck.versions[role]
      if (!version) return null
      const read = await readVersionFiles(env.DB, {
        ownerUserId,
        deckId: deck.id,
        version,
      })
      return read.kind === 'files' ? { role, read } : null
    }),
  )
  const present = reads.flatMap((entry) => (entry ? [entry] : []))
  const reasons = new Map(
    present.map(({ role, read }) => [role, unsavableReason(read)] as const),
  )
  const listable = present.filter(({ role }) => reasons.get(role) === null)
  const page = pageOf(
    listable.map(({ role, read }) => ({
      role,
      deploymentId: read.version.deploymentId,
      files: read.files,
    })),
    cursor,
  )
  if (page.kind === 'stale') return toolError('stale_cursor')
  const key = await fileUrlKey(secret)
  const expiresAt = now() + FILE_URL_SECONDS
  const listed: ListedVersion[] = await Promise.all(
    page.slices.map(async (slice) => {
      const whole = present.find(({ role }) => role === slice.role)!.read
      return {
        status: 'listed' as const,
        role: slice.role satisfies ExportRole,
        deploymentId: slice.deploymentId,
        receivedAt: whole.version.readyAt,
        fileCount: whole.files.length,
        totalBytes: whole.totalBytes,
        files: await Promise.all(
          slice.files.map(async (file) => ({
            path: file.path,
            size: file.size,
            sha256: file.sha256,
            mediaType: file.mediaType,
            url: fileUrlOf(
              env.PUBLIC_ORIGIN,
              await signFileUrl(key, {
                grantId,
                deploymentId: slice.deploymentId,
                fileId: file.id,
                expiresAt,
              }),
            ),
          })),
        ),
      }
    }),
  )
  // A version that cannot be listed is named with its reason, in its place.
  const versions: (ListedVersion | UnavailableVersion)[] = present.flatMap(
    ({ role, read }): (ListedVersion | UnavailableVersion)[] => {
      const reason = reasons.get(role)
      if (reason)
        return [
          {
            status: 'unavailable' as const,
            role,
            deploymentId: read.version.deploymentId,
            receivedAt: read.version.readyAt,
            reason,
          },
        ]
      const slice = listed.find((one) => one.role === role)
      return slice ? [slice] : []
    },
  )
  return toolResult(
    slideFilesView({
      slide: deck.slug,
      versions,
      urlsExpireAt: expiresAt,
      nextCursor: page.next === null ? null : encodeCursor(page.next),
      hasVersions: present.length > 0,
    }),
  )
}
