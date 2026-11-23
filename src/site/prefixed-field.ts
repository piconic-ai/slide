import { html } from 'hono/html'
import type { HtmlEscapedString } from 'hono/utils/html'

type Markup = HtmlEscapedString | Promise<HtmlEscapedString> | string

/**
 * A field that goes on from an address: `prefix` is shown in front of it
 * (`slide.community/@`), and only `control` (the input) is typed into. The
 * prefix is for the eyes; the label and the note name the field to a reader
 * who cannot see it. The one part for the handle of the first sign-in and
 * the URL of a slide.
 */
export const prefixedField = (prefix: string, control: Markup) =>
  html`<div class="prefixed-field">
    <span aria-hidden="true">${prefix}</span>${control}
  </div>`
