import { expect, test } from 'vitest'
import {
  CONTENT_CACHE_REVISION,
  parseStoredFileUrl,
  storedFileUrl,
} from './stored-file'

const ref = {
  deploymentId: '9a093341-8da7-45ac-89be-db566fecb5a4',
  sha256: 'a'.repeat(64),
  objectKey: '9a093341-8da7-45ac-89be-db566fecb5a4/0/lease',
}

test('Given a stored file, When its internal URL is built, Then the path names revision, deployment, digest and object and parses back', () => {
  const url = new URL(storedFileUrl(ref))
  expect(url.pathname.split('/')[1]).toBe(CONTENT_CACHE_REVISION)
  expect(url.pathname).toContain(ref.deploymentId)
  expect(url.pathname).toContain(ref.sha256)
  expect(parseStoredFileUrl(url.href)).toEqual(ref)
})

test('Given two deployments with the same digest, When URLs are built, Then they differ', () => {
  const other = { ...ref, deploymentId: '00000000-0000-4000-8000-000000000000' }
  expect(storedFileUrl(other)).not.toBe(storedFileUrl(ref))
})

test.each([
  [
    'another host',
    storedFileUrl(ref).replace('content-files.internal', 'd-x.example'),
  ],
  [
    'an old revision',
    storedFileUrl(ref).replace(`/${CONTENT_CACHE_REVISION}/`, '/v0/'),
  ],
  ['a bad digest', storedFileUrl({ ...ref, sha256: 'g'.repeat(64) })],
  ['a non-UUID deployment', storedFileUrl({ ...ref, deploymentId: 'x' })],
  ['an extra segment', `${storedFileUrl(ref)}/more`],
  ['bad escaping', `${storedFileUrl(ref)}%`],
])('Given %s, When parsed, Then it names no file', (_, url) => {
  expect(parseStoredFileUrl(url)).toBeNull()
})
