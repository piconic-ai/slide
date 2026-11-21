import { html } from 'hono/html'

/** The user-id shape the service issues; anything else names nobody. */
const USER_ID = /^[A-Za-z0-9_-]{1,64}$/

export const isUserId = (value: string) => USER_ID.test(value)

/** Where a person's picture is served from, by their id (F28-AC49). */
export const avatarPath = (userId: string) => `/avatars/${userId}`

/**
 * The picture laid over a person's initial, which every place that shows a
 * face draws the same way. While it loads, and when it cannot be read (a
 * person with no picture answers 404), the initial under it shows:
 * /share.js hides an image that fails, so no broken-image mark appears.
 */
export const faceImage = (src: string, className = '') =>
  html`<img
    data-cover
    ${className ? html`class="${className}"` : ''}
    src="${src}"
    alt=""
    loading="lazy"
    referrerpolicy="no-referrer"
  />`
