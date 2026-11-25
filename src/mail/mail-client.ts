import { SENDER_NAME, type Mail, type Mailer } from './mail'

export type CloudflareMailConfig = Readonly<{
  accountId: string
  apiToken: string
  /** The sender address, on a domain onboarded to Email Sending. */
  from: string
}>

/**
 * Sends through Cloudflare Email Service's REST API
 * (`POST /accounts/{id}/email/sending/send`). The body is plain text: no
 * HTML, no links, so nothing in the mail can track the reader.
 */
export function cloudflareMailer(config: CloudflareMailConfig): Mailer {
  return async (mail: Mail) => {
    const response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(config.accountId)}/email/sending/send`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.apiToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          to: mail.to,
          from: { address: config.from, name: SENDER_NAME },
          subject: mail.subject,
          text: mail.text,
        }),
        signal: AbortSignal.timeout(8000),
      },
    )
    // The address is not logged: only the status says what went wrong.
    if (!response.ok)
      throw new Error(`Mail service answered ${response.status}`)
  }
}
