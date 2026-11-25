import { describe, expect, it } from 'vitest'
import { parseInventoryStructure } from './inventory'
import {
  fileFolderCollision,
  isUploadPath,
  MAX_UPLOAD_PATH_BYTES,
} from './path-rules'

const accepted = [
  'index.html',
  'assets/site.css',
  'img/写真 1.png',
  'a/b/c/d/e.js',
  'fonts/Inter-Regular.woff2',
  'my.talk.v2.html',
  'img/café.png',
  'a'.repeat(MAX_UPLOAD_PATH_BYTES - 5) + '.html',
]
const refused = [
  '',
  'img/100%.png',
  'img/what?.png',
  'img/a#b.png',
  'C:/talk.html',
  'a\\b.html',
  'line\nbreak.html',
  'nul\u0000.html',
  '._photo.png',
  'img/._photo.png',
  '.keep.txt',
  'assets/.keep.txt',
  '.git/config.json',
  'node_modules/reveal.js/dist/reveal.js',
  'Node_Modules/x.js',
  '__MACOSX/._index.html',
  'credentials.json',
  'secrets.txt',
  'conf/Secrets.json',
  'notes.py.txt',
  'run.sh',
  'cgi/index.php',
  '_preview/pages.js',
  '_worker.js',
  '_routes.json',
  '/absolute.html',
  'double//slash.html',
  'trailing/',
  'family-👨‍👩‍👧.png',
  'a'.repeat(MAX_UPLOAD_PATH_BYTES) + '.html',
  'あ'.repeat(171) + '.html',
]

describe('isUploadPath', () => {
  it.each(accepted)(
    'Given %j, When checked, Then it may name a file of a slide',
    (path) => {
      expect(isUploadPath(path)).toBe(true)
    },
  )

  it.each(refused)('Given %j, When checked, Then it may not', (path) => {
    expect(isUploadPath(path)).toBe(false)
  })

  it.each([...accepted, ...refused].filter((path) => path !== ''))(
    'Given %j, When the service parses an inventory that lists it, Then it decides as the shared rule does',
    (path) => {
      const parses = () =>
        parseInventoryStructure({
          entry: 'index.html',
          files: [
            { path: 'index.html', size: 1, sha256: 'a'.repeat(64) },
            ...(path === 'index.html'
              ? []
              : [{ path, size: 1, sha256: 'a'.repeat(64) }]),
          ],
        })
      // A kind of file that is not taken is another rule's refusal.
      const known = /\.(html|css|js|png|woff2|json|txt|php|sh)$/.test(path)

      if (isUploadPath(path) && known) expect(parses).not.toThrow()
      if (!isUploadPath(path)) expect(parses).toThrow()
    },
  )
})

describe('fileFolderCollision', () => {
  it('Given a file and a folder of the same path, When checked, Then that path is named', () => {
    expect(fileFolderCollision(new Set(['index.html', 'a', 'a/b.css']))).toBe(
      'a',
    )
    expect(fileFolderCollision(new Set(['x/y', 'x/y/z/deep.js']))).toBe('x/y')
  })

  it.each([
    [['index.html', 'a/b.css', 'a/c.css']],
    [['a.css', 'a.css.map']],
    [['ab/c.js', 'a/c.js']],
    [[]],
  ])('Given %j, When checked, Then nothing collides', (paths) => {
    expect(fileFolderCollision(new Set(paths))).toBeNull()
  })
})
