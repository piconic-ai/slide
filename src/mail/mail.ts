/** One plain-text message to one person. It holds no HTML and no links. */
export type Mail = Readonly<{
  to: string
  subject: string
  text: string
}>

/** The name mail readers show beside the sender address. */
export const SENDER_NAME = 'slide.community'

/** Hands a message to whatever delivers it. Rejects when it cannot. */
export type Mailer = (mail: Mail) => Promise<void>
