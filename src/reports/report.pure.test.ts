import { expect, test } from 'vitest'
import { parseReport } from './report'

test.each(['nuisance', 'rights', 'other'])(
  'F17-AC16: Given reason %s and a note, When parsed, Then the reason and trimmed note are accepted',
  (reason) => {
    expect(parseReport({ reason, note: '  page 3\n' })).toEqual({
      kind: 'valid',
      reason,
      note: 'page 3',
    })
  },
)

test.each(['nuisance', 'rights'])(
  'F17-AC16: Given reason %s, When the note is empty or missing, Then an empty note is accepted',
  (reason) => {
    for (const fields of [
      {},
      { note: undefined },
      { note: '' },
      { note: ' \t\n' },
    ]) {
      expect(parseReport({ reason, ...fields })).toEqual({
        kind: 'valid',
        reason,
        note: '',
      })
    }
  },
)

test.each([{}, { note: undefined }, { note: '' }, { note: ' \t\n' }])(
  'F17-AC16: Given other and empty note fields %j, When parsed, Then a note is required',
  (fields) => {
    expect(parseReport({ reason: 'other', ...fields })).toEqual({
      kind: 'note_required',
    })
  },
)

test.each(['nuisance', 'rights', 'other'])(
  'F17-AC16: Given reason %s, When a trimmed note has 500 characters, Then it is accepted',
  (reason) => {
    const note = 'あ'.repeat(500)
    expect(parseReport({ reason, note: `  ${note}\n` })).toEqual({
      kind: 'valid',
      reason,
      note,
    })
  },
)

test.each(['nuisance', 'rights', 'other'])(
  'F17-AC16: Given reason %s, When a trimmed note has 501 characters, Then it is too long',
  (reason) => {
    expect(parseReport({ reason, note: ` ${'a'.repeat(501)} ` })).toEqual({
      kind: 'note_too_long',
    })
  },
)

test.each([
  'unknown',
  '',
  ' nuisance ',
  null,
  undefined,
  1,
  false,
  [],
  {},
  new File(['x'], 'reason.txt'),
])(
  'Given invalid reason %j, When parsed with an invalid note, Then the reason is rejected first',
  (reason) => {
    expect(parseReport({ reason, note: 123 })).toEqual({
      kind: 'invalid_reason',
    })
  },
)

test('Given no fields, When parsed, Then the missing reason is rejected', () => {
  expect(parseReport({})).toEqual({ kind: 'invalid_reason' })
})

test('Given an invalid reason and an overlong note, When parsed, Then the reason is rejected first', () => {
  expect(parseReport({ reason: 'invalid', note: 'a'.repeat(501) })).toEqual({
    kind: 'invalid_reason',
  })
})

test.each([123, false, null, [], {}, new File(['x'], 'note.txt')])(
  'Given a present non-string note %j, When parsed, Then the note is invalid',
  (note) => {
    for (const reason of ['nuisance', 'rights', 'other']) {
      expect(parseReport({ reason, note })).toEqual({ kind: 'invalid_note' })
    }
  },
)

test.each(['<script>alert(1)</script>', '問題のページ😀'])(
  'F17-AC16: Given note %s, When parsed, Then its content is preserved as text',
  (note) => {
    expect(parseReport({ reason: 'other', note })).toEqual({
      kind: 'valid',
      reason: 'other',
      note,
    })
  },
)
