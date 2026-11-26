// What the drop zone's script (public/drop.js) uses, bundled into one file
// the pages load. The script itself only reads the page and draws; every
// decision is made by the functions exported here, which are tested.
import { isLang, DEFAULT_LANG, type Lang } from '../site/i18n'
import { VERSION_LIMITS } from '../uploads/version-limits'
import { htmlDrop, planUpload, planZip, type Plan } from './plan'
import { frameHelpTarget } from '../help/frame-places'
import { failurePlace, refusalPlace } from './help-place'
import { dropKind, type DropRefusal } from './precheck'
import type { SendFailure } from './send'

export { attemptFor, planKey, rememberAfter } from './attempt'
export { sendDrop } from './send'
export {
  freshStash,
  continueMark,
  isContinuing,
  STASH_CONTINUE_KEY,
  STASH_RETURN_PARAM,
  stashSignInPath,
} from './stash'
export { dropText, failureMessage, formatBytes, refusalMessage } from './text'

/** The link to the help that goes with a refusal of the file (F36-AC46). */
export const refusalHelp = (refusal: DropRefusal, lang: Lang) =>
  frameHelpTarget(refusalPlace(refusal), lang)

/** The link to the help that goes with a failed send; null when it has none. */
export const failureHelp = (
  failure: Readonly<{ reason: SendFailure }>,
  lang: Lang,
) => {
  const place = failurePlace(failure.reason)
  return place === null ? null : frameHelpTarget(place, lang)
}

/** The language a page is written in, from its `<html lang>`. */
export const pageLang = (value: string | null | undefined): Lang =>
  isLang(value) ? value : DEFAULT_LANG

/**
 * Reads a dropped file into what will be sent, or says why it is not taken:
 * an HTML file becomes the slide's index.html, a zip is unpacked. `read`
 * gives the file's bytes. It is not called for a file of a kind that is not
 * taken, nor for one too large to be sent whatever it holds.
 */
export async function prepareDrop(
  file: Readonly<{ name: string; size: number }>,
  read: () => Promise<Uint8Array>,
): Promise<Plan> {
  const kind = dropKind(file.name)
  if (kind === null)
    return { ok: false, refusal: { reason: 'unsupported_kind' } }
  // A file with nothing in it is no slide; said before it is read.
  if (file.size === 0) return { ok: false, refusal: { reason: 'empty' } }
  if (kind === 'html') {
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
  // Packing rarely makes files larger, so a zip well over what one version
  // may hold is over it unpacked as well.
  if (file.size > 2 * VERSION_LIMITS.deploymentBytes)
    return {
      ok: false,
      refusal: {
        reason: 'version_too_large',
        size: file.size,
        limit: VERSION_LIMITS.deploymentBytes,
      },
    }
  return planZip(await read(), VERSION_LIMITS)
}
