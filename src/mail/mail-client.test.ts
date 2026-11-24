import { afterEach, expect, test, vi } from 'vitest'
import { cloudflareMailer } from './mail-client'

afterEach(() => {
  vi.unstubAllGlobals()
})

const config = {
  accountId: 'account-1',
  apiToken: 'token-1',
  from: 'noreply@slide.community',
}

const mail = { to: 'a@example.com', subject: 'Code: 123456', text: '123456' }

/** Records what goes to the mail service, and answers with `status`. */
function stubService(status: number) {
  const sent: { url: string; init: RequestInit }[] = []
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    sent.push({ url: String(url), init })
    return new Response('{}', { status })
  })
  return sent
}

test('F28-AC92: Given the real mail service, When a code mail is sent, Then the sender shows the name slide.community beside the MAIL_FROM address', async () => {
  const sent = stubService(200)
  await cloudflareMailer(config)(mail)
  expect(sent).toHaveLength(1)
  expect(sent[0].url).toBe(
    'https://api.cloudflare.com/client/v4/accounts/account-1/email/sending/send',
  )
  const body = JSON.parse(String(sent[0].init.body))
  expect(body.from).toEqual({
    address: 'noreply@slide.community',
    name: 'slide.community',
  })
  expect(body).toMatchObject({
    to: 'a@example.com',
    subject: 'Code: 123456',
    text: '123456',
  })
  expect(body).not.toHaveProperty('html')
})

test('F28-AC23: Given the mail service refuses, When a code mail is sent, Then the send fails with the status and without the address', async () => {
  stubService(403)
  const failure = cloudflareMailer(config)(mail)
  await expect(failure).rejects.toThrow('Mail service answered 403')
  await expect(failure).rejects.not.toThrow('a@example.com')
})
