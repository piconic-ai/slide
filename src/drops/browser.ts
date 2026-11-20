// What the drop zone's script (public/drop.js) uses, bundled into one file
// the pages load. The script itself only reads the page and draws; every
// decision is made by the functions exported here, which are tested.
import { isLang, DEFAULT_LANG, type Lang } from '../site/i18n'
import { VERSION_LIMITS } from '../uploads/version-limits'
import { htmlDrop, planUpload, type Plan } from './plan'
import { dropKind } from './precheck'

export { attemptFor, planKey, rememberAfter } from './attempt'
export { sendDrop } from './send'
export { dropText, failureMessage, formatBytes, refusalMessage } from './text'

/** The language a page is written in, from its `<html lang>`. */
export const pageLang = (value: string | null | undefined): Lang =>
  isLang(value) ? value : DEFAULT_LANG

/**
 * Reads a dropped file into what will be sent, or says why it is not taken.
 * `read` gives the file's bytes. It is not called for a file of a kind that
 * is not taken, nor for one too large to be sent whatever it holds.
 */
export async function prepareDrop(
  file: Readonly<{ name: string; size: number }>,
  read: () => Promise<Uint8Array>,
): Promise<Plan> {
  if (dropKind(file.name) !== 'html')
    return { ok: false, refusal: { reason: 'unsupported_kind' } }
  // A file with nothing in it is no slide; said before it is read.
  if (file.size === 0) return { ok: false, refusal: { reason: 'empty' } }
  if (file.size > VERSION_LIMITS.fileBytes)
    return {
      ok: false,
      refusal: {
        reason: 'file_too_large',
        path: file.name,
        size: file.size,
        limit: VERSION_LIMITS.fileBytes,
      },
    }
  return planUpload(htmlDrop(await read()), VERSION_LIMITS)
}
