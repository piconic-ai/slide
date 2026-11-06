import { afterAll, expect, test } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import {
  CONTENT_CACHE_REVISION,
  parseStoredFileUrl,
  serveStoredFile,
  storedFileUrl,
} from './stored-file'

const platform = await getPlatformProxy<Env>({ persist: false })
afterAll(() => platform.dispose())

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

test('Given a stored object, When served, Then its bytes are cacheable and tagged by deployment', async () => {
  await platform.env.UPLOADS.put(ref.objectKey, 'bytes')
  const response = await serveStoredFile(
    platform.env.UPLOADS,
    new Request(storedFileUrl(ref)),
  )
  expect(await response.text()).toBe('bytes')
  expect(response.headers.get('Cache-Control')).toBe(
    'public, max-age=31536000, immutable',
  )
  expect(response.headers.get('Cache-Tag')).toBe(
    `deployment-${ref.deploymentId}`,
  )
})

test.each([
  [
    'a missing object',
    new Request(storedFileUrl({ ...ref, objectKey: 'none' })),
  ],
  ['a POST', new Request(storedFileUrl(ref), { method: 'POST' })],
  ['an unknown URL', new Request('https://content-files.internal/other')],
])(
  'Given %s, When served, Then it is 404 and not cached',
  async (_, request) => {
    const response = await serveStoredFile(platform.env.UPLOADS, request)
    expect(response.status).toBe(404)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
  },
)
