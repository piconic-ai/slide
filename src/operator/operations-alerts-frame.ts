import { html } from 'hono/html'
import { operatorFrame } from './operator-frame'
import { pendingNote } from './not-configured'

/**
 * What the frame shows. Work M adds the kinds it needs (for example one for a
 * missing setting, drawn with `notConfigured`) and fills the frame in.
 */
export type AlertsFrameView = Readonly<{ kind: 'pending' }>

/** The frame "通知" of the operations page. */
export const alertsFrame = (view: AlertsFrameView): ReturnType<typeof html> => {
  switch (view.kind) {
    case 'pending':
      return operatorFrame({ id: 'alerts', heading: '通知' }, pendingNote())
  }
}
