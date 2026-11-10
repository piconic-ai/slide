import { html } from 'hono/html'

/** The address bar above a mocked screen. */
export const slideUrl = (path: string) =>
  html`<div class="mock-url">slide.example/${path}</div>`

/** The workflow step an author adds; YAML reads the same in every language. */
export const toolsFigure = html`<pre class="mock-yaml">
permissions:
  id-token: write
steps:
  - run: npm run build
  - uses: piconic-ai/slide@&lt;commit-sha&gt;
    with:
      directory: dist
      deck: hono-on-workers</pre>`
