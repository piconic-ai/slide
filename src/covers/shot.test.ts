import { expect, test } from 'vitest'
import {
  coverShotPath,
  coverShotUrl,
  parseCoverFile,
  parseCoverShotUrl,
  shotOptions,
} from './shot'

const ID = '7ae11c67-633f-4f21-b2b1-80af84107428'

test('Given a deployment, When its cover path is parsed back, Then it names the same deployment', () => {
  expect(coverShotPath(ID)).toBe(`/covers/${ID}.jpg`)
  expect(parseCoverFile(`${ID}.jpg`)).toBe(ID)
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

test('Given a deployment, When its internal URL is parsed back, Then it names the same deployment', () => {
  expect(parseCoverShotUrl(coverShotUrl(ID))).toBe(ID)
})

test.each([
  ['another host', `https://content-files.internal/v1/${ID}`],
  ['an old revision', `https://cover-shots.internal/v0/${ID}`],
  ['a query, which would be another cache key', `${coverShotUrl(ID)}?x=1`],
  ['a longer path', `${coverShotUrl(ID)}/x`],
  ['not a deployment ID', 'https://cover-shots.internal/v1/talk'],
  ['no deployment', 'https://cover-shots.internal/v1/'],
])(
  'Given an internal URL with %s, When parsed, Then it names no deployment',
  (_case, url) => {
    expect(parseCoverShotUrl(url)).toBeNull()
  },
)

test('Given a deck URL, When the shot is described, Then it is a 16:9 JPEG of that URL with a bounded wait', () => {
  const options = shotOptions('https://d-x.content.example/')

  expect(options.url).toBe('https://d-x.content.example/')
  expect(options.viewport.width / options.viewport.height).toBe(16 / 9)
  expect(options.screenshotOptions.type).toBe('jpeg')
  expect(options.gotoOptions.timeout).toBeLessThanOrEqual(30000)
})
