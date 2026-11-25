import { expect, it } from 'vitest'
import { mediaTypeOfPath } from './media-types'

it.each([
  ['index.html', 'text/html; charset=utf-8'],
  ['assets/app.JS', 'text/javascript; charset=utf-8'],
  ['a/b/photo.jpeg', 'image/jpeg'],
  ['fonts/x.woff2', 'font/woff2'],
  ['archive.tar.png', 'image/png'],
])('Given %j, When its type is asked, Then it is %j', (path, type) => {
  expect(mediaTypeOfPath(path)).toBe(type)
})

it.each([
  'notes.md',
  'talk.pptx',
  'README',
  'folder.html/file',
  'run.sh',
  'trailing.',
  '',
  'constructor',
  'x.__proto__',
])(
  'Given %j, When its type is asked, Then it is not a kind that is taken',
  (path) => {
    expect(mediaTypeOfPath(path)).toBeNull()
  },
)
