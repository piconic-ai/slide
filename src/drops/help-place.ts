import type { FramePlace } from '../help/frame-places'
import type { DropRefusal } from './precheck'
import type { SendFailure } from './send'

/**
 * Which article of the help explains why the browser did not take a file
 * (F36-AC46). A refusal over a size or a count leads to the limits; any other
 * refusal of the file itself, to the files that can be put up.
 */
export function refusalPlace(refusal: DropRefusal): FramePlace {
  switch (refusal.reason) {
    case 'too_many_files':
    case 'file_too_large':
    case 'version_too_large':
      return 'drop-limit'
    case 'unsupported_kind':
    case 'empty':
    case 'unsupported_file':
    case 'unsupported_path':
    case 'no_index':
    case 'invalid_zip':
    case 'unsupported_zip':
    case 'unsafe_path':
    case 'duplicate_path':
      return 'drop-files'
  }
}

/**
 * Which article explains why the service did not receive the files, or null
 * when the reason passes by itself (a busy moment, a lost page) or has no
 * article of its own.
 */
export function failurePlace(reason: SendFailure): FramePlace | null {
  switch (reason) {
    case 'sign_in':
      return 'drop-sign-in'
    case 'deck_limit':
    case 'limit':
      return 'drop-limit'
    case 'invalid':
      return 'drop-files'
    case 'refused':
      return 'suspended'
    case 'invitation_only':
    case 'not_found':
    case 'busy':
    case 'failed':
      return null
  }
}
