import { html } from 'hono/html'

/** People in a row each, with one button that lets them go. */
export function peopleList(
  handles: readonly string[],
  action: '/follows' | '/mutes',
  release: { label: string; name: (handle: string) => string },
  empty: string,
) {
  if (!handles.length) return html`<p>${empty}</p>`
  return html`<ul class="settings-rows" role="list">
    ${handles.map(
      (handle) =>
        html`<li>
          <form method="post" action="${action}/${handle}/release">
            <a href="/@${handle}">@${handle}</a>
            <button
              class="button-secondary"
              type="submit"
              aria-label="${release.name(handle)}"
            >
              ${release.label}
            </button>
          </form>
        </li>`,
    )}
  </ul>`
}
