import { expect, test } from 'vitest'
import type { Handle } from '../share/handle'
import { movedPath } from './moved'

const from = 'old' as Handle
const to = 'new-name' as Handle

test.each([
  ['/@old', '', '/@new-name'],
  ['/@old/followers', '?page=2', '/@new-name/followers?page=2'],
  ['/@old/talk', '', '/@new-name/talk'],
  ['/@old/talk/3', '?lang=en', '/@new-name/talk/3?lang=en'],
  ['/@old/edit', '', '/@new-name/edit'],
])(
  'F30-AC7: Given %s%s under a changed handle, When it moves, Then it is %s',
  (pathname, search, expected) => {
    expect(movedPath(pathname, search, from, to)).toBe(expected)
  },
)

test.each(['/@older', '/@older/talk', '/@ol', '/my/slides'])(
  'F30-AC7: Given %s, which is not under the changed handle, When it moves, Then it stays',
  (pathname) => {
    expect(movedPath(pathname, '', from, to)).toBe(pathname)
  },
)
