import { describe, expect, it } from 'vitest'
import { DEFAULT_UPLOAD_LIMITS } from '../uploads/limits'
import { VERSION_LIMITS } from '../uploads/version-limits'
import { checkFiles, dropKind } from './precheck'

const limits = { files: 3, fileBytes: 10, deploymentBytes: 15 }
const file = (path: string, size = 1) => ({ path, size })

describe('dropKind', () => {
  it.each([
    ['talk.html', 'html'],
    ['TALK.HTML', 'html'],
    ['index.htm', 'html'],
    ['my.talk.v2.html', 'html'],
    ['deck.zip', 'zip'],
    ['Deck.ZIP', 'zip'],
  ])('Given %j, When its kind is read, Then it is %s', (name, kind) => {
    expect(dropKind(name)).toBe(kind)
  })

  it.each([
    'talk.pdf',
    'talk.pptx',
    'talk.md',
    'talk.tar.gz',
    'talk.html.txt',
    'html',
    'zip',
    '',
    'folder',
    'talk.zip ',
    'talk.html\n.exe',
  ])(
    'F22-AC6: Given %j, When its kind is read, Then it is not taken',
    (name) => {
      expect(dropKind(name)).toBeNull()
    },
  )
})

describe('checkFiles', () => {
  it('Given the default limits of the sender, When compared with the service’s, Then they are the same numbers', () => {
    expect(VERSION_LIMITS).toEqual({
      deploymentBytes: DEFAULT_UPLOAD_LIMITS.deploymentBytes,
      fileBytes: DEFAULT_UPLOAD_LIMITS.fileBytes,
      files: DEFAULT_UPLOAD_LIMITS.files,
    })
  })

  it('F22-AC6: Given files at every limit, When checked, Then they are accepted', () => {
    expect(
      checkFiles(
        [file('index.html', 10), file('a.css', 5), file('b.png', 0)],
        limits,
      ),
    ).toBeNull()
  })

  it('F22-AC6: Given one file more than a version holds, When checked, Then the number of files is named with the count and the limit', () => {
    expect(
      checkFiles(
        [file('index.html'), file('a.css'), file('b.css'), file('c.css')],
        limits,
      ),
    ).toEqual({ reason: 'too_many_files', count: 4, limit: 3 })
  })

  it('F22-AC6: Given a file one byte over the limit for one file, When checked, Then that file is named with its size and the limit', () => {
    expect(
      checkFiles([file('index.html'), file('big.png', 11)], limits),
    ).toEqual({
      reason: 'file_too_large',
      path: 'big.png',
      size: 11,
      limit: 10,
    })
  })

  it('F22-AC6: Given files that fit one by one but not together, When checked, Then the total is named with its size and the limit', () => {
    expect(
      checkFiles([file('index.html', 8), file('a.png', 8)], limits),
    ).toEqual({ reason: 'version_too_large', size: 16, limit: 15 })
  })

  it('Given a version over several limits at once, When checked, Then the number of files is reported first', () => {
    expect(
      checkFiles(
        [
          file('a.png', 99),
          file('b.png', 99),
          file('c.png', 99),
          file('d.png', 99),
        ],
        limits,
      ),
    ).toMatchObject({ reason: 'too_many_files' })
  })

  it.each(['notes.md', 'talk.pptx', 'Makefile'])(
    'Given a file of a kind that is not taken (%s), When checked, Then that file is named',
    (path) => {
      expect(checkFiles([file('index.html'), file(path)], limits)).toEqual({
        reason: 'unsupported_file',
        path,
      })
    },
  )

  it('Given no files, When checked, Then it is refused as empty', () => {
    expect(checkFiles([], limits)).toEqual({ reason: 'empty' })
  })
})

describe('names the service does not take', () => {
  it.each([
    ['img/100%.png', 'character'],
    ['img\\a.png', 'character'],
    ['node_modules/reveal.js/dist/reveal.js', 'reserved_name'],
    ['credentials.json', 'reserved_name'],
    ['secrets.env', 'reserved_name'],
    ['notes.py.txt', 'program'],
    ['api/build.py', 'program'],
    ['assets/.keep.txt', 'hidden'],
    ['assets//a.png', 'hidden'],
    ['_preview/pages.js', 'reserved_folder'],
    ['family-👨‍👩‍👧.png', 'character'],
    [`${'あ'.repeat(170)}.png`, 'length'],
  ])(
    'Given a file named %j, When checked, Then it is refused naming that file and what is wrong with the name (%s), before anything is sent',
    (path, problem) => {
      expect(checkFiles([file('index.html'), file(path)], limits)).toEqual({
        reason: 'unsupported_path',
        path,
        problem,
      })
    },
  )

  it('Given a file and a folder of the same name, When checked, Then that name is refused', () => {
    expect(
      checkFiles(
        [file('index.html'), file('a.css'), file('a.css/b.css')],
        limits,
      ),
    ).toEqual({
      reason: 'unsupported_path',
      path: 'a.css',
      problem: 'file_and_folder',
    })
  })

  it('Given a name in decomposed letters that is fine once composed, When checked, Then it is accepted', () => {
    expect(
      checkFiles([file('index.html'), file('cafe\u0301.png')], limits),
    ).toBeNull()
  })
})
