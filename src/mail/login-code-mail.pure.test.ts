import { expect, test } from 'vitest'
import { loginCodeMail } from './login-code-mail'

test.each(['ja', 'en'] as const)(
  'F28-AC2: Given the %s mail, When it is made, Then only the code and the service name are in it and nothing links or tracks',
  (lang) => {
    const mail = loginCodeMail('a@example.com', '123456', lang)
    expect(mail.to).toBe('a@example.com')
    expect(mail.subject).toContain('123456')
    expect(mail.subject).toContain('slide.community')
    expect(mail.text).toContain('slide.community')
    expect(mail.text).toContain('123456')
    expect(mail.text).toContain('10')
    expect(`${mail.subject}${mail.text}`).not.toMatch(
      /https?:|www\.|<|\.(png|gif)/i,
    )
  },
)

test.each(['ja', 'en'] as const)(
  'F41-AC1: Given the %s mail, When it is made for an address, Then neither the subject nor the body holds the address',
  (lang) => {
    const mail = loginCodeMail('person.name@mail.example', '123456', lang)
    expect(`${mail.subject}\n${mail.text}`.toLowerCase()).not.toContain(
      'person',
    )
    expect(`${mail.subject}\n${mail.text}`).not.toContain('mail.example')
  },
)
