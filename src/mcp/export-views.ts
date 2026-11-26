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
  role: 'published' | 'prepared'
  deploymentId: string
  /** Seconds since the epoch. */
  receivedAt: number
  /** Over the whole version, not only the files of this answer. */
  fileCount: number
  totalBytes: number
  files: readonly ListedFile[]
}>

const isoOf = (seconds: number) => new Date(seconds * 1000).toISOString()

/**
 * The answer of get_slide_files: the versions that have files in this answer
 * and, when more follow, the cursor to ask again with. No file's bytes are in
 * it, only where each can be fetched from for the next hour.
 */
export function slideFilesView(
  input: Readonly<{
    slide: string
    versions: readonly ListedVersion[]
    /** Seconds since the epoch; when the addresses stop working. */
    urlsExpireAt: number
    nextCursor: string | null
    /** Whether the slide has a version to export at all. */
    hasVersions: boolean
  }>,
) {
  return {
    slide: input.slide,
    versions: input.versions.map((version) => ({
      ...version,
      receivedAt: isoOf(version.receivedAt),
    })),
    urlsExpireAt: isoOf(input.urlsExpireAt),
    nextCursor: input.nextCursor,
    next: nextStep(input),
  }
}

function nextStep(
  input: Readonly<{ nextCursor: string | null; hasVersions: boolean }>,
): string {
  if (!input.hasVersions)
    return 'This slide has no version to export yet: nothing was put up. Go on to its article with get_article_draft.'
  const fetching =
    'GET each url as it is (no Authorization header), save the bytes under the file’s path in a folder named for this slide and the version, and check them against sha256. Never write a path that has “..” in it or starts with “/”. The urls are secret and stop working at urlsExpireAt: do not show or log them, and call this tool again if one has run out.'
  return input.nextCursor === null
    ? `That is every file. ${fetching} Then read the article with get_article_draft.`
    : `More files follow: call get_slide_files again with cursor set to nextCursor. ${fetching}`
}
