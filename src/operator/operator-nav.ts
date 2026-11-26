import { html } from 'hono/html'

/** The operator pages, in the order the navigation lists them. */
export const OPERATOR_PAGES = [
  { path: '/', label: '運営' },
  { path: '/metrics', label: '計測' },
  { path: '/operations', label: '運用' },
] as const
export type OperatorPagePath = (typeof OPERATOR_PAGES)[number]['path']

/**
 * The way between the operator pages. `current` is the page being shown; its
 * link says so with `aria-current` and the rest are plain links.
 */
export const operatorNav = (current: OperatorPagePath) =>
  html`<nav class="operator-nav" aria-label="運営の画面">
    <ul>
      ${OPERATOR_PAGES.map((page) =>
        page.path === current
          ? html`<li>
              <a href="${page.path}" aria-current="page">${page.label}</a>
            </li>`
          : html`<li><a href="${page.path}">${page.label}</a></li>`,
      )}
    </ul>
  </nav>`
