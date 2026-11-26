import { html } from 'hono/html'
import { frameHelpTarget, type FramePlace } from './frame-places'
import type { Lang } from '../site/i18n'

/**
 * The link of a place, as a note under its heading or description. It stands
 * alone and is tall enough to press.
 */
export const frameHelpLink = (place: FramePlace, lang: Lang) => {
  const { href, label } = frameHelpTarget(place, lang)
  return html`<p class="field-note">
    <a class="help-link" href="${href}">${label}</a>
  </p>`
}
