import { mediaTypeOfPath } from '../uploads/media-types'
import { fileFolderCollision, isUploadPath } from '../uploads/path-rules'
import type { VersionLimits } from '../uploads/version-limits'
import type { ZipRefusal } from './zip'

/** What was dropped: one HTML file, or a zip of a built slide. */
export type DropKind = 'html' | 'zip'

/** The kind of a dropped file by its name, or null for one that is not taken. */
export function dropKind(fileName: string): DropKind | null {
  if (/\.html?$/i.test(fileName)) return 'html'
  if (/\.zip$/i.test(fileName)) return 'zip'
  return null
}

/** Why a drop is not sent, in enough detail to say which limit it is over. */
export type DropRefusal =
  | Readonly<{ reason: 'unsupported_kind' }>
  | Readonly<{ reason: 'empty' }>
  | Readonly<{ reason: 'too_many_files'; count: number; limit: number }>
  | Readonly<{
      reason: 'file_too_large'
      path: string
      size: number
      limit: number
    }>
  | Readonly<{ reason: 'version_too_large'; size: number; limit: number }>
  | Readonly<{ reason: 'unsupported_file'; path: string }>
  /** A name the service does not take, whatever the file holds. */
  | Readonly<{ reason: 'unsupported_path'; path: string }>
  /** A zip with no index.html at its top or at the top of its one folder. */
  | Readonly<{ reason: 'no_index' }>
  | ZipRefusal

export type SizedFile = Readonly<{ path: string; size: number }>

/**
 * Checks the files of one version against the limits, before anything is
 * sent. The first thing wrong is the one reported: the number of files, a
 * name or a kind of file the service does not take, a single file's size,
 * then the total.
 */
export function checkFiles(
  files: readonly SizedFile[],
  limits: VersionLimits,
): DropRefusal | null {
  if (files.length === 0) return { reason: 'empty' }
  if (files.length > limits.files)
    return {
      reason: 'too_many_files',
      count: files.length,
      limit: limits.files,
    }
  // The same rule the service applies to a path, on the name it stores.
  const named = files.find(({ path }) => !isUploadPath(path.normalize('NFC')))
  if (named) return { reason: 'unsupported_path', path: named.path }
  const both = fileFolderCollision(
    new Set(files.map(({ path }) => path.normalize('NFC'))),
  )
  if (both !== null) return { reason: 'unsupported_path', path: both }
  const unsupported = files.find(({ path }) => mediaTypeOfPath(path) === null)
  if (unsupported) return { reason: 'unsupported_file', path: unsupported.path }
  const large = files.find(({ size }) => size > limits.fileBytes)
  if (large)
    return {
      reason: 'file_too_large',
      path: large.path,
      size: large.size,
      limit: limits.fileBytes,
    }
  const total = files.reduce((sum, { size }) => sum + size, 0)
  if (total > limits.deploymentBytes)
    return {
      reason: 'version_too_large',
      size: total,
      limit: limits.deploymentBytes,
    }
  return null
}
