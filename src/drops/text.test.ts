import { describe, expect, it } from 'vitest'
import { LANGS } from '../site/i18n'
import { pageLang } from './browser'
import type { DropRefusal } from './precheck'
import type { SendFailure } from './send'
import { dropText, failureMessage, formatBytes, refusalMessage } from './text'

describe('formatBytes', () => {
  it.each([
    [0, '1 KB'],
    [1, '1 KB'],
    [1536, '2 KB'],
    [1024 * 1024 - 1, '1024 KB'],
    [1024 * 1024, '1.0 MB'],
    [5 * 1024 * 1024, '5.0 MB'],
    [10.25 * 1024 * 1024, '10.3 MB'],
  ])(
    'Given %d bytes, When written out, Then it reads %s',
    (bytes, expected) => {
      expect(formatBytes(bytes)).toBe(expected)
    },
  )
})

describe('refusalMessage', () => {
  const refusals: readonly DropRefusal[] = [
    { reason: 'unsupported_kind' },
    { reason: 'empty' },
    { reason: 'too_many_files', count: 120, limit: 100 },
    {
      reason: 'file_too_large',
      path: 'video.mp4',
      size: 6 * 1048576,
      limit: 5 * 1048576,
    },
    { reason: 'version_too_large', size: 12 * 1048576, limit: 10 * 1048576 },
    { reason: 'unsupported_file', path: 'notes.md' },
  ]

  it.each(LANGS)(
    'Given each refusal in %s, When worded, Then every one has words of its own',
    (lang) => {
      const words = refusals.map((refusal) => refusalMessage(refusal, lang))

      expect(new Set(words).size).toBe(refusals.length)
      for (const word of words) expect(word.length).toBeGreaterThan(5)
    },
  )

  it('F22-AC6: Given a version with too many files, When worded, Then the count and the limit are both said', () => {
    expect(
      refusalMessage(
        { reason: 'too_many_files', count: 120, limit: 100 },
        'ja',
      ),
    ).toBe('ファイルが 120 個あります。1 つの版に置けるのは 100 個までです。')
  })

  it('F22-AC6: Given a file that is too large, When worded, Then the file, its size and the limit for one file are said', () => {
    expect(
      refusalMessage(
        {
          reason: 'file_too_large',
          path: 'video.mp4',
          size: 6 * 1048576,
          limit: 5 * 1048576,
        },
        'ja',
      ),
    ).toBe('video.mp4 は 6.0 MB あります。1 つのファイルは 5.0 MB までです。')
  })

  it('F22-AC6: Given a version that is too large in total, When worded, Then the total and the limit for one version are said', () => {
    expect(
      refusalMessage(
        {
          reason: 'version_too_large',
          size: 12 * 1048576,
          limit: 10 * 1048576,
        },
        'en',
      ),
    ).toBe('The files are 12.0 MB together. One version may be up to 10.0 MB.')
  })
})

describe('failureMessage', () => {
  const failures: readonly SendFailure[] = [
    'sign_in',
    'invitation_only',
    'deck_limit',
    'not_found',
    'refused',
    'invalid',
    'busy',
    'failed',
  ]

  it.each(LANGS)(
    'Given each failure in %s, When worded, Then every one has words of its own',
    (lang) => {
      const words = failures.map((reason) => failureMessage({ reason }, lang))

      expect(new Set(words).size).toBe(failures.length)
    },
  )

  it('F22-AC16: Given a start refused as invitation-only, When worded, Then it says the service is by invitation', () => {
    expect(failureMessage({ reason: 'invitation_only' }, 'ja')).toContain(
      '招待制',
    )
    expect(failureMessage({ reason: 'invitation_only' }, 'en')).toContain(
      'by invitation',
    )
  })

  it('F22-AC6: Given the limit on slides is reached, When worded, Then it names the number of slides', () => {
    expect(failureMessage({ reason: 'deck_limit' }, 'ja')).toContain(
      'スライドの本数の上限',
    )
  })

  it.each([
    ['too_many_files', 'ファイル数が一版の上限を超えています'],
    ['file_too_large', '一ファイルの上限を超えるファイルがあります'],
    ['deployment_too_large', '一版の合計サイズが上限を超えています'],
    ['author_bytes_exceeded', '保存できる合計サイズの上限を超えています'],
    ['daily_starts_exceeded', '24時間のアップロード開始回数の上限に達しました'],
  ])(
    'F22-AC6: Given the service refused for %s, When worded, Then that limit is named',
    (limit, expected) => {
      expect(failureMessage({ reason: 'limit', limit }, 'ja')).toBe(expected)
    },
  )

  it('Given a limit refusal that names no limit, When worded, Then it still says something', () => {
    expect(failureMessage({ reason: 'limit' }, 'ja').length).toBeGreaterThan(5)
  })
})

describe('the words of a working zone', () => {
  it.each(LANGS)(
    'Given %s, When read, Then receiving, its note and the progress are worded',
    (lang) => {
      const t = dropText(lang)

      for (const words of [
        t.picked,
        t.signInToContinue,
        t.pickAnother,
        t.pickedNote,
        t.notKept,
      ])
        expect(words.length).toBeGreaterThan(3)
      expect(t.pickedFile('talk.html', '1.0 MB')).toContain('talk.html')
      expect(t.pickedFile('talk.html', '1.0 MB')).toContain('1.0 MB')
      expect(t.receiving.length).toBeGreaterThan(3)
      expect(t.receivingNote.length).toBeGreaterThan(3)
      expect(t.progress(2, 5)).toMatch(/2/)
      expect(t.progress(2, 5)).toMatch(/5/)
    },
  )

  it.each([
    ['ja', 'ja'],
    ['en', 'en'],
    ['fr', 'ja'],
    ['', 'ja'],
    [null, 'ja'],
    [undefined, 'ja'],
  ])(
    'Given a page in %j, When its language is read, Then it is %s',
    (value, lang) => {
      expect(pageLang(value)).toBe(lang)
    },
  )
})
