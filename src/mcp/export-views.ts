// What export_account answers. Pure: the account file in, the answer out.
import type { accountInfo } from '../exports/account-info'

type AccountInfo = ReturnType<typeof accountInfo>

/**
 * The answer: the account file as `account.json` has it, and the slides as a
 * short list to go through one by one. The list is made from the file's own
 * slides, so the two always name the same slides.
 */
export const exportAccountView = (info: AccountInfo) => ({
  account: info,
  slides: info.slides.map((slide) => ({
    slide: slide.urlName,
    title: slide.title,
    state: slide.state,
    hiddenByOperator: slide.hiddenByOperator,
  })),
  next: 'Write `account` to a file as account.json. Then, for each slide in `slides`, call get_slide_files (until its nextCursor is null) to save its files, and get_article_draft to save its article and related links.',
})

/** One file as get_slide_files lists it. */
export type ListedFile = Readonly<{
  path: string
  size: number
  sha256: string
  mediaType: string
  url: string
}>

export type ListedVersion = Readonly<{
  status: 'listed'
  role: 'published' | 'prepared'
  deploymentId: string
  /** Seconds since the epoch. */
  receivedAt: number
  /** Over the whole version, not only the files of this answer. */
  fileCount: number
  totalBytes: number
  files: readonly ListedFile[]
}>

/** Why a version's files are not listed (see slide-files-api.ts). */
export type UnavailableReason = 'unsafe_path' | 'file_not_stored'

/** A version the slide has, none of whose files can be listed. */
export type UnavailableVersion = Readonly<{
  status: 'unavailable'
  role: 'published' | 'prepared'
  deploymentId: string
  /** Seconds since the epoch. */
  receivedAt: number
  reason: UnavailableReason
}>

const REASON_MESSAGES: Readonly<Record<UnavailableReason, string>> = {
  unsafe_path:
    'A file of this version has a path that is not safe to write to a disk (it climbs out of its folder, is absolute, or has a character no file name may have), so none of its files are listed.',
  file_not_stored:
    'A file of this version is not stored, so none of its files are listed.',
}

const isoOf = (seconds: number) => new Date(seconds * 1000).toISOString()

/**
 * The answer of get_slide_files: the versions that have files in this answer
 * and, when more follow, the cursor to ask again with. No file's bytes are in
 * it, only where each can be fetched from for the next hour.
 */
export function slideFilesView(
  input: Readonly<{
    slide: string
    versions: readonly (ListedVersion | UnavailableVersion)[]
    /** Seconds since the epoch; when the addresses stop working. */
    urlsExpireAt: number
    nextCursor: string | null
    /** Whether the slide has a version to export at all. */
    hasVersions: boolean
  }>,
) {
  return {
    slide: input.slide,
    versions: input.versions.map((version) =>
      version.status === 'listed'
        ? { ...version, receivedAt: isoOf(version.receivedAt) }
        : {
            ...version,
            receivedAt: isoOf(version.receivedAt),
            message: REASON_MESSAGES[version.reason],
          },
    ),
    urlsExpireAt: isoOf(input.urlsExpireAt),
    nextCursor: input.nextCursor,
    next: nextStep({
      ...input,
      hasUnavailable: input.versions.some((v) => v.status === 'unavailable'),
    }),
  }
}

function nextStep(
  input: Readonly<{
    nextCursor: string | null
    hasVersions: boolean
    hasUnavailable: boolean
  }>,
): string {
  if (!input.hasVersions)
    return 'This slide has no version to export yet: nothing was put up. Go on to its article with get_article_draft.'
  const fetching =
    'GET each url as it is (no Authorization header), save the bytes under the file’s path in a folder named for this slide and the version, and check them against sha256. Never write a path that has “..” in it or starts with “/”. The urls are secret and stop working at urlsExpireAt: do not show or log them, and call this tool again if one has run out.'
  const unavailable = input.hasUnavailable
    ? ' A version with status unavailable has no files listed (see its message): tell the author, and do not treat the slide as fully saved.'
    : ''
  return input.nextCursor === null
    ? `That is every file that can be listed. ${fetching}${unavailable} Then read the article with get_article_draft.`
    : `More files follow: call get_slide_files again with cursor set to nextCursor. ${fetching}${unavailable}`
}
