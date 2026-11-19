import { withPageScript } from '../../scripts/page-script.mjs'
import type { VersionLimits } from '../uploads/version-limits'
import { checkFiles, type DropRefusal } from './precheck'
import { chooseRoot } from './root'
import { readZipDirectory, unpackEntry } from './zip'

/** A file of the slide as it was dropped. */
export type DropFile = Readonly<{ path: string; bytes: Uint8Array }>

/** A file as it will be sent, with what the inventory says of it. */
export type PlannedFile = Readonly<{
  path: string
  size: number
  sha256: string
  bytes: Uint8Array
}>

export type Plan =
  | Readonly<{ ok: true; files: readonly PlannedFile[] }>
  | Readonly<{ ok: false; refusal: DropRefusal }>

const hex = (digest: ArrayBuffer) =>
  Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('')

/**
 * What to send for a slide: each HTML document gets the page script, as the
 * uploader script adds it, and the inventory lists the bytes as sent. The
 * version is checked against the limits with those bytes, so nothing is
 * sent that the service would refuse for its size.
 */
export async function planUpload(
  files: readonly DropFile[],
  limits: VersionLimits,
): Promise<Plan> {
  const sent = files.map(({ path, bytes }) => ({
    path: path.normalize('NFC'),
    bytes: withPageScript(path, bytes),
  }))
  const refusal = checkFiles(
    sent.map(({ path, bytes }) => ({ path, size: bytes.byteLength })),
    limits,
  )
  if (refusal) return { ok: false, refusal }
  return {
    ok: true,
    files: await Promise.all(
      sent.map(async ({ path, bytes }) => ({
        path,
        size: bytes.byteLength,
        sha256: hex(
          await crypto.subtle.digest('SHA-256', new Uint8Array(bytes)),
        ),
        bytes,
      })),
    ),
  }
}

/** The files of a dropped HTML file: it becomes the slide's index.html. */
export const htmlDrop = (bytes: Uint8Array): readonly DropFile[] => [
  { path: 'index.html', bytes },
]

const refused = (refusal: DropRefusal): Plan => ({ ok: false, refusal })

/**
 * The files of a dropped zip, unpacked: those below its root, with what
 * macOS added left out. The zip's own list is checked against the limits
 * before anything is unpacked, and each file is unpacked only up to the
 * size the list gives it, so a zip that unpacks to more than it says cannot
 * fill the browser's memory.
 */
export async function zipDrop(
  bytes: Uint8Array,
  limits: VersionLimits,
): Promise<
  | Readonly<{ ok: true; files: readonly DropFile[] }>
  | Readonly<{ ok: false; refusal: DropRefusal }>
> {
  const directory = readZipDirectory(bytes)
  if (!directory.ok) return directory
  const root = chooseRoot(directory.entries.map(({ path }) => path))
  if (!root.ok) return { ok: false, refusal: { reason: 'no_index' } }
  const below = new Set(root.paths)
  const listed = directory.entries.flatMap((entry) => {
    const path = entry.path.startsWith(root.prefix)
      ? entry.path.slice(root.prefix.length)
      : null
    return path !== null && below.has(path) ? [{ entry, path }] : []
  })
  const refusal = checkFiles(
    listed.map(({ entry, path }) => ({ path, size: entry.size })),
    limits,
  )
  if (refusal) return { ok: false, refusal }
  const files: DropFile[] = []
  for (const { entry, path } of listed) {
    const unpacked = await unpackEntry(bytes, entry)
    if (!unpacked) return { ok: false, refusal: { reason: 'invalid_zip' } }
    files.push({ path, bytes: unpacked })
  }
  return { ok: true, files }
}

/** Plans a dropped zip: unpacks it, then plans its files as any slide's. */
export async function planZip(
  bytes: Uint8Array,
  limits: VersionLimits,
): Promise<Plan> {
  const unpacked = await zipDrop(bytes, limits)
  return unpacked.ok
    ? planUpload(unpacked.files, limits)
    : refused(unpacked.refusal)
}
