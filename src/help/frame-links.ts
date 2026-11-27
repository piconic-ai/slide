import { html } from 'hono/html'
import {
  frameHelpTarget,
  frameMarkTarget,
  type FrameMark,
  type FramePlace,
} from './frame-places'
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

/**
 * The `?` in the top right corner of a block, which leads to the help of the
 * block. The block is a `.panel-with-help`, which places it. Its name for a
 * screen reader is the label, not the mark.
 */
export const frameHelpMark = (mark: FrameMark, lang: Lang) => {
  const { href, label } = frameMarkTarget(mark, lang)
  return html`<a
    class="help-mark"
    href="${href}"
    aria-label="${label}"
    title="${label}"
    ><span aria-hidden="true">?</span></a
  >`
}
