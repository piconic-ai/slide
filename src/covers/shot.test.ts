import { expect, test } from 'vitest'
import {
  COVER_SHOT_REVISION,
  coverShotPath,
  isJpegShot,
  MAX_SHOT_PAGE,
  PAGE_SHOT_REVISION,
  pageShotPath,
  parseCoverFile,
  parsePageFile,
  parseShotUrl,
  shotHeaders,
  shotLocation,
  shotOptions,
  shotTag,
  shotUrl,
  type ShotTarget,
} from './shot'

const ID = '7ae11c67-633f-4f21-b2b1-80af84107428'
const OTHER = '0b0f0d7e-3c62-4d0c-9a51-5a4b3f1c2d10'
const cover: ShotTarget = { kind: 'cover', deploymentId: ID }
const page = (number: number, deploymentId = ID): ShotTarget => ({
  kind: 'page',
  deploymentId,
  page: number,
})

test('Given a deployment, When its cover path is parsed back, Then it names the same deployment', () => {
  expect(coverShotPath(ID)).toBe(`/covers/${ID}.jpg`)
  expect(parseCoverFile(`${ID}.jpg`)).toEqual(cover)
})

test.each([
  ['no extension', ID],
  ['another extension', `${ID}.png`],
  ['not a deployment ID', 'talk.jpg'],
  ['an empty name', '.jpg'],
  ['a longer path', `x/${ID}.jpg`],
  ['a doubled extension', `${ID}.jpg.jpg`],
  ['nothing', ''],
])(
  'Given a cover file with %s, When parsed, Then it names no deployment',
  (_case, file) => {
    expect(parseCoverFile(file)).toBeNull()
  },
)

test.each([1, 6, 99, 100, MAX_SHOT_PAGE])(
  'F05-AC5: Given page %i of a deployment, When the path of its image is parsed back, Then it names the same page',
  (number) => {
    expect(pageShotPath(ID, number)).toBe(`/covers/${ID}/${number}.jpg`)
    expect(parsePageFile(ID, `${number}.jpg`)).toEqual(page(number))
  },
)

test.each([
  ['the page after the last one taken', '201.jpg'],
  ['a page of four digits', '1000.jpg'],
  ['page zero', '0.jpg'],
  ['a negative page', '-6.jpg'],
  ['a signed page', '+6.jpg'],
  ['a fraction', '1.5.jpg'],
  ['a zero-padded page', '06.jpg'],
  ['a huge page', '99999999999999999999.jpg'],
  ['an exponent', '1e2.jpg'],
  ['a hexadecimal page', '0x6.jpg'],
  ['full-width digits', '６.jpg'],
  ['a word', 'six.jpg'],
  ['spaces', ' 6 .jpg'],
  ['no page', '.jpg'],
  ['no extension', '6'],
  ['another extension', '6.png'],
  ['a doubled extension', '6.jpg.jpg'],
  ['nothing', ''],
])(
  'F05-AC9: Given the image file of %s, When parsed, Then it names no page',
  (_case, file) => {
    expect(parsePageFile(ID, file)).toBeNull()
  },
)

test.each([
  ['a name that is no deployment ID', 'talk'],
  ['a deployment ID with an extension', `${ID}.jpg`],
  ['nothing', ''],
])(
  'Given %s as the deployment, When the image file of a page is parsed, Then it names no page',
  (_case, deployment) => {
    expect(parsePageFile(deployment, '6.jpg')).toBeNull()
  },
)

test.each([
  ['a cover', cover],
  ['the first page', page(1)],
  ['a page', page(6)],
  ['the last page taken', page(MAX_SHOT_PAGE)],
])(
  'Given %s, When its internal URL is parsed back, Then it names the same image',
  (_case, target) => {
    expect(parseShotUrl(shotUrl(target))).toEqual(target)
  },
)

test('F05-AC12: Given a cover, pages and deployments, When their internal URLs and tags are compared, Then the same image has one of each and different images share none', () => {
  const targets = [cover, page(1), page(6), page(16), page(6, OTHER)]

  expect(shotUrl(page(6))).toBe(shotUrl({ ...page(6) }))
  expect(new Set(targets.map(shotUrl)).size).toBe(targets.length)
  expect(new Set(targets.map(shotTag)).size).toBe(targets.length)
})

test('Given the pages’ revision, When a page’s key is made, Then the cover’s key keeps its own revision and is as it was', () => {
  expect(PAGE_SHOT_REVISION).not.toBe(COVER_SHOT_REVISION)
  expect(shotUrl(cover)).toBe(`https://cover-shots.internal/v1/${ID}`)
  expect(shotTag(cover)).toBe(`cover-v1-${ID}`)
  expect(shotUrl(page(6))).toBe(`https://cover-shots.internal/p1/${ID}/6`)
  expect(shotTag(page(6))).toBe(`page-p1-${ID}-6`)
})

test.each([
  ['another host', `https://content-files.internal/v1/${ID}`],
  ['an old revision', `https://cover-shots.internal/v0/${ID}`],
  ['a query, which would be another cache key', `${shotUrl(cover)}?x=1`],
  ['a longer path', `${shotUrl(cover)}/x`],
  ['not a deployment ID', 'https://cover-shots.internal/v1/talk'],
  ['no deployment', 'https://cover-shots.internal/v1/'],
  ['a page under the cover’s revision', `${shotUrl(cover)}/6`],
  [
    'a cover under the pages’ revision',
    `https://cover-shots.internal/p1/${ID}`,
  ],
  ['an old revision of a page', `https://cover-shots.internal/p0/${ID}/6`],
  [
    'a page past the last one taken',
    `https://cover-shots.internal/p1/${ID}/201`,
  ],
  ['page zero', `https://cover-shots.internal/p1/${ID}/0`],
  ['a zero-padded page', `https://cover-shots.internal/p1/${ID}/06`],
  ['a page with a query', `${shotUrl(page(6))}?x=1`],
  ['a path past the page', `${shotUrl(page(6))}/x`],
  ['a trailing slash after the page', `${shotUrl(page(6))}/`],
  [
    'a page of something that is no deployment',
    'https://cover-shots.internal/p1/talk/6',
  ],
])(
  'Given an internal URL with %s, When parsed, Then it names no image',
  (_case, url) => {
    expect(parseShotUrl(url)).toBeNull()
  },
)

test('Given a cover and a page, When the address to open is chosen, Then the cover is the deck’s root and the page is its number in the fragment', () => {
  expect(shotLocation(cover)).toBe('/')
  expect(shotLocation(page(6))).toBe('/#6')
})

test('Given a deck URL, When the shot is described, Then it is a 16:9 JPEG of that URL with a bounded wait', () => {
  const options = shotOptions('https://d-x.content.example/')

  expect(options.url).toBe('https://d-x.content.example/')
  expect(options.viewport.width / options.viewport.height).toBe(16 / 9)
  expect(options.screenshotOptions.type).toBe('jpeg')
  expect(options.gotoOptions.timeout).toBeLessThanOrEqual(30000)
})

test.each([
  [true, 'image/jpeg', true],
  [false, 'image/jpeg', false],
  [true, 'image/png', false],
  [true, 'image/jpeg; charset=x', false],
  [true, null, false],
  [false, null, false],
])(
  'Given the browser answered ok=%s with %s, When judged, Then the shot is usable: %s',
  (ok, contentType, usable) => {
    expect(isJpegShot(ok, contentType)).toBe(usable)
  },
)

test('Given a deployment, When its shot is kept, Then it is immutable and tagged with that deployment', () => {
  expect(shotHeaders(ID)).toEqual({
    'Content-Type': 'image/jpeg',
    'Cache-Control': 'public, max-age=31536000, immutable',
    'Cache-Tag': `deployment-${ID}`,
  })
})
