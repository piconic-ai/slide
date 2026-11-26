import { html } from 'hono/html'
import { operatorFrame } from './operator-frame'
import { pendingNote } from './not-configured'

/**
 * What the frame shows. Work B adds the kinds it needs (for example one for a
 * missing setting, drawn with `notConfigured`) and fills the frame in.
 */
export type BackupsFrameView = Readonly<{ kind: 'pending' }>

/** The frame "バックアップ" of the operations page. */
export const backupsFrame = (
  view: BackupsFrameView,
): ReturnType<typeof html> => {
  switch (view.kind) {
    case 'pending':
      return operatorFrame(
        { id: 'backups', heading: 'バックアップ' },
        pendingNote(),
      )
  }
}
