import { html } from 'hono/html'

/**
 * The styles of the pages of communities: their own page, the forms that
 * make and edit one, and the logo. They come with each page's markup, so a
 * move between pages carries them; every value is a token.
 */
export const communityStyle = html`<style>
  .community-logo {
    display: grid;
    place-items: center;
    flex: none;
    box-sizing: border-box;
    border-radius: 22%;
    font-weight: 700;
    line-height: 1;
    object-fit: cover;
    overflow: hidden;
  }
  .community-logo-96 {
    width: 96px;
    height: 96px;
    font-size: 44px;
  }
  .community-logo-48 {
    width: 48px;
    height: 48px;
    font-size: 22px;
  }
  .community-logo-28 {
    width: 28px;
    height: 28px;
    font-size: 14px;
  }
  .community-head {
    margin-top: 0;
  }
  .community-head .profile-body h1 {
    overflow-wrap: anywhere;
  }
  .community-description {
    margin: 8px 0 0;
    max-width: 40em;
    white-space: pre-line;
    overflow-wrap: anywhere;
  }
  .community-places {
    display: flex;
    flex-wrap: wrap;
    gap: 0 16px;
    margin: 8px 0 0;
    padding: 0;
    list-style: none;
    color: var(--muted-foreground);
    font-size: 14px;
  }
  .community-places > li {
    display: inline-flex;
    align-items: center;
    min-height: 44px;
  }
  .community-places a {
    color: var(--foreground);
  }
  .community-page > .cover-pattern,
  .community-page > .cover-image {
    margin-top: 40px;
  }
  .community-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .community-event {
    padding: 24px 0;
  }
  .community-event + .community-event {
    border-top: 1px solid var(--border);
  }
  .community-event-head {
    display: flex;
    align-items: flex-start;
    gap: 16px;
  }
  .community-event-head > div {
    flex: 1;
    min-width: 0;
  }
  .community-event h2 {
    margin: 0;
    font-size: 18px;
    overflow-wrap: anywhere;
  }
  .community-event h2 a {
    color: var(--foreground);
  }
  .community-event-count {
    margin: 4px 0 16px;
    color: var(--muted-foreground);
    font-size: 13px;
  }
  .carousel-buttons {
    display: flex;
    gap: 8px;
  }
  .carousel-buttons[hidden] {
    display: none;
  }
  .carousel-buttons button {
    width: 44px;
    height: 44px;
    padding: 0;
    border: 1px solid var(--input);
    border-radius: var(--radius-full);
    background: var(--background);
    color: var(--foreground);
    font-size: 20px;
    cursor: pointer;
  }
  .carousel-buttons button:disabled {
    opacity: 0.4;
    cursor: default;
  }
  /* The slides of one event, sent sideways: the page itself never widens. */
  .carousel {
    overflow-x: auto;
    overscroll-behavior-x: contain;
    scroll-snap-type: x proximity;
    scrollbar-width: thin;
  }
  .carousel:focus-visible {
    outline: 2px solid var(--ring);
    outline-offset: 2px;
  }
  .carousel > ul {
    display: flex;
    gap: 20px;
    margin: 0;
    padding: 0 0 8px;
    list-style: none;
  }
  .carousel .deck-card,
  .carousel-more {
    flex: 0 0 240px;
    scroll-snap-align: start;
  }
  .carousel-more a {
    display: grid;
    place-items: center;
    box-sizing: border-box;
    aspect-ratio: 16 / 9;
    min-height: 44px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    color: var(--foreground);
    font-weight: 600;
  }
  /* The forms that make and edit a community. */
  .community-form-page {
    max-width: 40em;
    margin: 40px auto 0;
  }
  .community-form-page h1 {
    margin: 0 0 8px;
  }
  .community-form .field {
    margin: 0 0 24px;
  }
  .community-form .field-error,
  .community-links .field-error {
    margin: 6px 0 0;
    color: var(--destructive);
    font-size: 14px;
  }
  .community-form [aria-invalid='true'] {
    border-color: var(--destructive);
  }
  .community-form .prefixed-field:has([aria-invalid='true']) {
    border-color: var(--destructive);
  }
  .community-form .prefixed-field input,
  .community-form .prefixed-field input:focus {
    border: 0;
    max-width: none;
  }
  .community-form input,
  .community-form textarea,
  .community-form .prefixed-field {
    max-width: none;
  }
  .community-links {
    margin: 0 0 24px;
    padding: 0;
    border: 0;
  }
  .community-links > legend {
    padding: 0;
  }
  .community-link-forms {
    display: grid;
    grid-template-columns: max-content minmax(0, 1fr);
    gap: 4px 16px;
    margin: 12px 0 16px;
    font-size: 13px;
  }
  .community-link-forms dt {
    font-weight: 600;
  }
  .community-link-forms dd {
    margin: 0;
    color: var(--muted-foreground);
    overflow-wrap: anywhere;
  }
  .community-link-row {
    margin: 0 0 12px;
  }
  .community-link-line {
    display: flex;
    gap: 8px;
  }
  .community-link-line > input {
    flex: 1;
    min-width: 0;
  }
  .community-link-line > button {
    flex: none;
  }
  .community-image-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 12px;
  }
  .community-cover-preview > .cover-pattern,
  .community-cover-preview > .cover-image {
    margin: 0 0 12px;
  }
  .community-form-buttons,
  .community-rename {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .community-rename {
    margin: 12px 0 0;
  }
  .community-rename > input {
    flex: 1 1 16em;
    min-width: 0;
  }
  .community-form-page .panel {
    margin-top: 40px;
  }
  .community-form-page [role='status'] {
    margin: 0 0 24px;
  }
  .community-admin {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 8px 0;
    border-top: 1px solid var(--border);
  }
  .community-admin > a {
    display: flex;
    flex-direction: column;
    min-width: 0;
    color: var(--foreground);
  }
  .community-admin form,
  .community-admin-add {
    margin: 0;
  }
  .community-admin-add {
    padding-top: 16px;
    border-top: 1px solid var(--border);
  }
  .community-admin-add .prefixed-field {
    flex: 1;
    min-width: 0;
    max-width: none;
  }
  .community-admin-add .prefixed-field input {
    border: 0;
    max-width: none;
  }
  .community-scope {
    margin: 24px 0 0;
    max-width: 40em;
  }
  .community-delete input {
    max-width: none;
    margin-bottom: 16px;
  }
  .field-error[hidden] {
    display: none;
  }
  /* The hidden first button that Enter presses. */
  .default-submit {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    border: 0;
    padding: 0;
  }
</style>`
