import { execFile } from 'node:child_process'
import { createServer } from 'node:http'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const ENTRY = join(dirname(fileURLToPath(import.meta.url)), 'run.mjs')
const run = promisify(execFile)

/** A small local server that answers like the viewer, and counts what it got. */
let server
let origin
const seen = []

beforeAll(async () => {
  server = createServer((request, response) => {
    seen.push({
      path: request.url,
      clientIp: request.headers['cf-connecting-ip'],
    })
    if (request.url === '/@a/b') {
      response.setHeader('Content-Type', 'text/html')
      response.end(
        `<img src="/covers/x.jpg"><iframe src="${origin}/frame/"></iframe>`,
      )
    } else if (request.url === '/frame/') {
      response.setHeader('Content-Type', 'text/html')
      response.end('<script src="/frame/app.js"></script>')
    } else if (request.url === '/covers/x.jpg' && seen.length % 4 === 0) {
      response.statusCode = 429
      response.end()
    } else {
      response.end('ok')
    }
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  origin = `http://127.0.0.1:${server.address().port}`
})
afterAll(() => new Promise((resolve) => server.close(resolve)))

describe('scripts/load/run.mjs as a process', () => {
  it('COST-AC5: Given a short run aimed at a local server, When it ends, Then it prints the latency distribution and the count of each status', async () => {
    const { stdout } = await run('node', [
      ENTRY,
      'hot-slide',
      '--origin',
      origin,
      '--slide',
      '/@a/b',
      '--views-per-minute',
      '120',
      '--duration',
      '2',
      '--client-ip',
      '203.0.113.7',
    ])
    expect(stdout).toContain('Scenario: hot-slide')
    expect(stdout).toMatch(/Status: .*200: \d+/)
    expect(stdout).toMatch(
      /Latency ms: min [\d.]+ {2}p50 [\d.]+ {2}p90 [\d.]+ {2}p95 [\d.]+ {2}p99 [\d.]+ {2}max [\d.]+/,
    )
    expect(stdout).toMatch(/429 share: [\d.]+%/)
    // 4 views, each of the viewer page, the session, the cover, the frame
    // and its script.
    expect(seen.filter((hit) => hit.path === '/@a/b')).toHaveLength(4)
    expect(seen.every((hit) => hit.clientIp === '203.0.113.7')).toBe(true)
  })

  it.each([
    ['https://slide.community'],
    ['http://Slide.Community.:8443'],
    ['https://d-1.slideusercontent.com'],
  ])(
    'COST-AC4: Given the production origin %s, When the script runs as a process, Then it exits 2, says nothing was sent and touches no server',
    async (production) => {
      const before = seen.length
      const result = await run('node', [
        ENTRY,
        'venue-300',
        '--origin',
        production,
        '--slide',
        '/@a/b',
      ]).catch((error) => error)
      expect(result.code).toBe(2)
      expect(result.stderr).toContain('Nothing was sent')
      expect(result.stdout).toBe('')
      expect(seen).toHaveLength(before)
    },
  )
})
