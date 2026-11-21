import { jsxRenderer } from 'hono/jsx-renderer'
import { BfScripts } from '@barefootjs/hono/scripts'

declare module 'hono' {
  interface ContextRenderer {
    (children: unknown, props?: { title?: string }): Response
  }
}

export const renderer = jsxRenderer(({ children, title }) => (
  <html lang="en">
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>{title ?? 'BarefootJS app'}</title>
      <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
      {/* Link all three sheets so the browser fetches them in
          parallel — chaining via styles.css @import would defer
          tokens/uno to a second round-trip and flash unstyled DOM.
          tokens.css first so CSS variables are defined before any
          rule references them. */}
      <link rel="stylesheet" href="/tokens.css" />
      <link rel="stylesheet" href="/styles.css" />
      <link rel="stylesheet" href="/uno.css" />
    </head>
    <body>
      {children}
      <BfScripts />
    </body>
  </html>
))
