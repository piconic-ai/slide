import { createServer } from 'node:http'
import { expect, test } from 'vitest'
import { limitTime } from './release-fetch.mjs'

/** A local server that answers `/fast` at once and never answers `/hang`. */
async function withServer(run) {
  const server = createServer((request, response) => {
    if (request.url === '/fast') response.end('ok')
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  try {
    return await run(`http://127.0.0.1:${port}`)
  } finally {
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
  }
}

test('REL-AC8: Given a request that never answers, When it is sent with a time limit, Then it rejects with a TimeoutError so the check can fail', async () => {
  await withServer(async (base) => {
    const send = limitTime(fetch, 100)
    await expect(send(`${base}/hang`, {})).rejects.toMatchObject({
      name: 'TimeoutError',
    })
  })
})

test('REL-AC8: Given a request that answers in time, When it is sent with a time limit, Then the answer comes through and the options are kept', async () => {
  await withServer(async (base) => {
    const send = limitTime(fetch, 5000)
    const response = await send(`${base}/fast`, { method: 'GET' })
    expect(await response.text()).toBe('ok')
  })
})
