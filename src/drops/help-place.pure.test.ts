import { describe, expect, test } from 'vitest'
import { frameHelpTarget } from '../help/frame-places'
import { failurePlace, refusalPlace } from './help-place'
import type { DropRefusal } from './precheck'
import type { SendFailure } from './send'

const refusals: readonly DropRefusal[] = [
  { reason: 'unsupported_kind' },
  { reason: 'empty' },
  { reason: 'too_many_files', count: 200, limit: 100 },
  { reason: 'file_too_large', path: 'a.png', size: 9, limit: 5 },
  { reason: 'version_too_large', size: 20, limit: 10 },
  { reason: 'unsupported_file', path: 'a.exe' },
  { reason: 'unsupported_path', path: '.env', problem: 'hidden' },
  { reason: 'no_index' },
  { reason: 'invalid_zip' },
  { reason: 'unsupported_zip', feature: 'encrypted' },
  { reason: 'unsafe_path', path: '../a' },
  { reason: 'duplicate_path', path: 'a' },
]

describe('the article that explains why files were not put up', () => {
  test.each(refusals.map((refusal) => [refusal.reason, refusal] as const))(
    'F36-AC46: Given the browser refused a file for %s, When the article is chosen, Then a size or a count leads to the limits and anything else to the accepted files',
    (_, refusal) => {
      const place = refusalPlace(refusal)
      const sizes = ['too_many_files', 'file_too_large', 'version_too_large']
      expect(place).toBe(
        sizes.includes(refusal.reason) ? 'drop-limit' : 'drop-files',
      )
      expect(frameHelpTarget(place, 'ja').href).toMatch(
        /^\/help\/slides\/(limits|accepted-files)$/u,
      )
    },
  )

  test.each([
    ['sign_in', 'drop-sign-in'],
    ['deck_limit', 'drop-limit'],
    ['limit', 'drop-limit'],
    ['invalid', 'drop-files'],
    ['refused', 'suspended'],
    ['invitation_only', null],
    ['not_found', null],
    ['busy', null],
    ['failed', null],
  ] as const satisfies readonly (readonly [SendFailure, string | null])[])(
    'F36-AC46: Given the service did not receive the files because of %s, When the article is chosen, Then it is %s',
    (reason, place) => {
      expect(failurePlace(reason)).toBe(place)
    },
  )
})
