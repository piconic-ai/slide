import { describe, expect, it } from 'vitest'
import { chooseRoot } from './root'

describe('chooseRoot', () => {
  it('F22-AC3: Given index.html at the top of the zip, When the root is chosen, Then it is the top and every file keeps its path', () => {
    expect(chooseRoot(['index.html', 'css/site.css', 'img/a.png'])).toEqual({
      ok: true,
      prefix: '',
      paths: ['index.html', 'css/site.css', 'img/a.png'],
    })
  })

  it('F22-AC4: Given everything inside one folder with index.html at its top, When the root is chosen, Then it is that folder and paths are below it', () => {
    expect(
      chooseRoot([
        'my-talk/index.html',
        'my-talk/css/site.css',
        'my-talk/img/a.png',
      ]),
    ).toEqual({
      ok: true,
      prefix: 'my-talk/',
      paths: ['index.html', 'css/site.css', 'img/a.png'],
    })
  })

  it('Given index.html at the top and also in a folder, When the root is chosen, Then the top wins', () => {
    expect(chooseRoot(['index.html', 'deck/index.html'])).toMatchObject({
      prefix: '',
    })
  })

  it.each([
    [
      '__MACOSX next to the folder',
      [
        'deck/index.html',
        'deck/a.css',
        '__MACOSX/deck/._index.html',
        '__MACOSX/._deck',
      ],
    ],
    ['.DS_Store at the top', ['.DS_Store', 'deck/index.html', 'deck/a.css']],
    [
      '.DS_Store inside the folder',
      ['deck/index.html', 'deck/a.css', 'deck/.DS_Store', 'deck/img/.DS_Store'],
    ],
  ])(
    'F22-AC5: Given %s, When the root is chosen, Then what macOS added is treated as not there',
    (_name, paths) => {
      expect(chooseRoot(paths)).toEqual({
        ok: true,
        prefix: 'deck/',
        paths: ['index.html', 'a.css'],
      })
    },
  )

  it('F22-AC5: Given __MACOSX and .DS_Store beside index.html at the top, When the root is chosen, Then they are left out of the slide', () => {
    expect(
      chooseRoot(['index.html', '.DS_Store', '__MACOSX/._index.html']),
    ).toEqual({
      ok: true,
      prefix: '',
      paths: ['index.html'],
    })
  })

  it.each([
    ['no files at all', []],
    ['only what macOS added', ['__MACOSX/._x', '.DS_Store']],
    ['no index.html anywhere', ['slides.html', 'css/site.css']],
    ['index.html two folders down', ['a/b/index.html']],
    [
      'two folders, each with an index.html',
      ['one/index.html', 'two/index.html'],
    ],
    [
      'a folder with index.html beside a file at the top',
      ['deck/index.html', 'readme.txt'],
    ],
    [
      'a folder without index.html at its top',
      ['deck/slides.html', 'deck/sub/index.html'],
    ],
    ['an index of another name', ['Index.html']],
    ['index.htm', ['index.htm']],
    ['a file at the top named like the folder', ['deck', 'deck/index.html']],
  ])(
    'F22-AC5: Given %s, When the root is chosen, Then there is none',
    (_name, paths) => {
      expect(chooseRoot(paths)).toEqual({ ok: false })
    },
  )
})

describe('AppleDouble files', () => {
  it('Given `._name` files beside the real ones, as macOS adds on some disks, When the root is chosen, Then they are treated as not there', () => {
    expect(
      chooseRoot([
        'index.html',
        '._index.html',
        'img/photo.png',
        'img/._photo.png',
      ]),
    ).toEqual({ ok: true, prefix: '', paths: ['index.html', 'img/photo.png'] })
  })

  it('Given a folder whose only other file at the top is `._folder`, When the root is chosen, Then the folder is still the root', () => {
    expect(
      chooseRoot(['._deck', 'deck/index.html', 'deck/._index.html']),
    ).toEqual({
      ok: true,
      prefix: 'deck/',
      paths: ['index.html'],
    })
  })

  it('Given a file whose name only holds `._` later, When the root is chosen, Then it is kept', () => {
    expect(
      chooseRoot(['index.html', 'a._b.css']).ok &&
        chooseRoot(['index.html', 'a._b.css']),
    ).toMatchObject({
      paths: ['index.html', 'a._b.css'],
    })
  })
})
