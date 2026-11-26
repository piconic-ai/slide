import { html } from 'hono/html'
import { operatorFrame } from './operator-frame'
import { pendingNote } from './not-configured'

/**
 * What the frame shows. Work C adds the kinds it needs (for example one for a
 * missing setting, drawn with `notConfigured`) and fills the frame in.
 */
export type EmailFrameView = Readonly<{ kind: 'pending' }>

/** The frame "メールアドレスの暗号化" of the operations page. */
export const emailFrame = (view: EmailFrameView): ReturnType<typeof html> => {
  switch (view.kind) {
    case 'pending':
      return operatorFrame(
        { id: 'email', heading: 'メールアドレスの暗号化' },
        pendingNote(),
      )
  }
}
