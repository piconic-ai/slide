import { expect, test } from 'vitest'
import { loginCodeMail } from './login-code-mail'

test.each(['ja', 'en'] as const)(
  'F28-AC2: Given the %s mail, When it is made, Then only the code and the service name are in it and nothing links or tracks',
  (lang) => {
    const mail = loginCodeMail('a@example.com', '123456', lang)
    expect(mail.to).toBe('a@example.com')
    expect(mail.subject).toContain('123456')
    expect(mail.subject).toContain('Slide')
    expect(mail.text).toContain('123456')
    expect(mail.text).toContain('10')
    expect(`${mail.subject}${mail.text}`).not.toMatch(
      /https?:|www\.|<|\.(png|gif)/i,
    )
  },
)
