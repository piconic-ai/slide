import { html } from 'hono/html'
import { operatorFrame } from './operator-frame'
import { pendingNote } from './not-configured'

/**
 * What the frame shows. Work N adds the kinds it needs (for example one for a
 * missing setting, drawn with `notConfigured`) and fills the frame in.
 */
export type MaintenanceFrameView = Readonly<{ kind: 'pending' }>

/** The frame "メンテナンスの予定" of the operations page. */
export const maintenanceFrame = (
  view: MaintenanceFrameView,
): ReturnType<typeof html> => {
  switch (view.kind) {
    case 'pending':
      return operatorFrame(
        { id: 'maintenance', heading: 'メンテナンスの予定' },
        pendingNote(),
      )
  }
}
