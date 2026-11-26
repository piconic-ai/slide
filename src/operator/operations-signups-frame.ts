import { html } from 'hono/html'
import { operatorFrame } from './operator-frame'
import { pendingNote } from './not-configured'

/**
 * What the frame shows. Work R adds the kinds it needs (for example one for a
 * missing setting, drawn with `notConfigured`) and fills the frame in.
 */
export type SignupsFrameView = Readonly<{ kind: 'pending' }>

/** The frame "新しい登録" of the operations page. */
export const signupsFrame = (
  view: SignupsFrameView,
): ReturnType<typeof html> => {
  switch (view.kind) {
    case 'pending':
      return operatorFrame(
        { id: 'signups', heading: '新しい登録' },
        pendingNote(),
      )
  }
}
