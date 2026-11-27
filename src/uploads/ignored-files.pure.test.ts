import { describe, expect, it } from 'vitest'
import { isHostingConfigFile, withoutHostingConfig } from './ignored-files'

describe('isHostingConfigFile', () => {
  it.each(['_redirects', '_headers'])(
    'F22-AC48: Given %s at the top, When asked, Then it is a hosting setting the service ignores',
    (path) => {
      expect(isHostingConfigFile(path)).toBe(true)
    },
  )

  it.each([
    ['sub/_redirects', 'in a folder'],
    ['_Redirects', 'in capitals'],
    ['_HEADERS', 'in capitals'],
    ['_redirects.txt', 'with an extension'],
    ['_redirects/', 'as a folder'],
    ['_redirects/index.html', 'as a folder'],
    ['x_redirects', 'with a prefix'],
    ['_worker.js', 'another hosting file'],
    ['_routes.json', 'another hosting file'],
    ['CNAME', 'another hosting file'],
    ['', 'empty'],
  ])(
    'F22-AC51: Given the path %s (%s), When asked, Then it is not ignored',
    (path) => {
      expect(isHostingConfigFile(path)).toBe(false)
    },
  )
})

describe('withoutHostingConfig', () => {
  it('F22-AC48: Given a list with both files at the top, When they are left out, Then the others stay in order and are the same objects', () => {
    const index = { path: 'index.html', size: 1 }
    const css = { path: 'a.css', size: 2 }
    const files = [
      { path: '_redirects', size: 3 },
      index,
      { path: '_headers', size: 4 },
      css,
    ]

    const kept = withoutHostingConfig(files)

    expect(kept).toEqual([index, css])
    expect(kept[0]).toBe(index)
  })

  it('F22-AC51: Given the same names below the top, When they are left out, Then those stay for the checks to refuse', () => {
    const files = [
      { path: 'index.html' },
      { path: 'sub/_redirects' },
      { path: '_Redirects' },
    ]

    expect(withoutHostingConfig(files)).toEqual(files)
  })

  it('Given an empty list, When they are left out, Then it is empty', () => {
    expect(withoutHostingConfig([])).toEqual([])
  })
})
