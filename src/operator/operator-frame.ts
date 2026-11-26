import { html } from 'hono/html'

/**
 * One frame of an operator page: a section with its own heading, so that a
 * link can name it by `id`. The heading is an `h2`; the body goes under it.
 */
export const operatorFrame = (
  frame: Readonly<{ id: string; heading: string }>,
  body: ReturnType<typeof html>,
) =>
  html`<section id="${frame.id}">
    <h2>${frame.heading}</h2>
    ${body}
  </section>`
