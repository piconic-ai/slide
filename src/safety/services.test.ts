import { expect, test } from 'vitest'
import { serviceOf } from './services'

test.each([
  ['fonts.gstatic.com', 'Google Fonts'],
  ['cdn.jsdelivr.net', 'jsDelivr'],
  ['api.github.com', 'GitHub'],
])('Given the host %s, When looked up, Then it is named %s', (host, name) => {
  expect(serviceOf(host)).toBe(name)
})

test.each([
  ['a host nobody listed', 'collect.metrics-hub.example'],
  ['a name under a listed host', 'evil.fonts.gstatic.com'],
  ['a listed host as a prefix', 'fonts.gstatic.com.evil.example'],
  ['a parent of a listed host', 'gstatic.com'],
  ['a listed host in upper case', 'FONTS.GSTATIC.COM'],
  ['a listed host with a trailing dot', 'fonts.gstatic.com.'],
  ['an empty host', ''],
  ['a key every object has', 'constructor'],
])('Given %s, When looked up, Then it has no name', (_, host) => {
  expect(serviceOf(host)).toBeNull()
})
