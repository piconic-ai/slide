import { html } from 'hono/html'

/**
 * What an operator frame says when a binding or secret it needs is missing
 * (D-08): which names are unset, and where the steps to set them are. It goes
 * right under the frame's heading. `missing` is never empty, since a frame
 * with nothing missing has nothing to say. `doc` is a path in the repository,
 * shown as text.
 */
export const notConfigured = (
  missing: readonly [string, ...string[]],
  doc: string,
) =>
  html`<p class="not-configured" role="status">
    未設定:
    ${missing.map((name, i) => html`${i > 0 ? '、' : ''}<code>${name}</code>`)}
    が設定されていません。設定の手順は <code>${doc}</code> を見てください。
  </p>`

/** The one line of a frame whose work has not been built yet. */
export const pendingNote = () => html`<p class="pending-note">準備中です。</p>`
