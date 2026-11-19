import { html } from 'hono/html'
import { designTokensCssRaw } from './design-tokens'

/** The styles every service page shares: the frame, type, controls and parts. */
export const pageStyle = html`<style>
  ${designTokensCssRaw} body {
    font: 16px/1.8 var(--font-sans);
    margin: 0;
    color: var(--foreground);
    background: var(--background);
    /* Handles and deck IDs are long unbroken words on narrow screens. */
    overflow-wrap: anywhere;
  }
  /* One column holds every page's own markup; see DESIGN.md for the widths. */
  main {
    max-width: 960px;
    margin: 0 auto;
    padding: 0 16px 64px;
  }
  /* Help and legal pages are read at length. */
  main.page-reading {
    max-width: 720px;
    line-height: 1.9;
  }
  main.page-narrow {
    max-width: 640px;
  }
  /* Headings and paragraphs set their own space; no browser default stays. */
  h1 {
    margin: 40px 0 16px;
    font-size: 32px;
    font-weight: 700;
    line-height: 1.35;
  }
  h2 {
    margin: 56px 0 16px;
    font-size: 24px;
    font-weight: 700;
    line-height: 1.4;
  }
  h3 {
    margin: 32px 0 8px;
    font-size: 18px;
    font-weight: 700;
    line-height: 1.5;
  }
  p,
  ul,
  ol {
    margin: 0 0 16px;
  }
  main > p,
  main > section > p,
  main form {
    max-width: 40em;
  }
  a {
    color: var(--foreground);
    text-decoration: underline;
  }
  .back-link {
    display: inline-flex;
    align-items: center;
    min-height: 44px;
    margin-top: 16px;
  }
  :focus-visible {
    outline: 2px solid var(--ring);
    outline-offset: 2px;
  }
  /*
   * Outline sits outside the control on the page canvas. On a white page keep
   * --ring (ink). White outlines belong only on truly dark surrounds (navy
   * color-blocks), which stage 4 can scope.
   */
  table {
    width: 100%;
    border-collapse: collapse;
    background: var(--card);
  }
  th,
  td {
    text-align: left;
    padding: 8px;
    border-bottom: 1px solid var(--border);
    vertical-align: top;
  }
  code {
    overflow-wrap: anywhere;
    font-family: var(--font-mono);
    font-size: 13px;
  }
  pre {
    background: var(--card);
    border: 1px solid var(--border);
    padding: 12px;
    overflow-x: auto;
  }
  pre code {
    overflow-wrap: normal;
  }
  form {
    margin: 16px 0;
  }
  button,
  input,
  textarea,
  select {
    font: inherit;
  }
  .text-input,
  input:not(
    [type='checkbox'],
    [type='radio'],
    [type='file'],
    [type='hidden'],
    [type='submit'],
    [type='button'],
    [type='reset'],
    [type='image'],
    [type='range'],
    [type='color']
  ),
  textarea,
  select {
    box-sizing: border-box;
    width: 100%;
    max-width: 28em;
    min-height: 44px;
    padding: 6px 12px;
    border: 1px solid var(--input);
    border-radius: var(--radius);
    background: var(--background);
    color: var(--foreground);
    font: 16px/1.8 var(--font-sans);
  }
  /* A label sits above its field, a note under it. */
  label,
  .field-label {
    display: block;
    margin: 0 0 4px;
    font-size: 14px;
    font-weight: 600;
    line-height: 1.7;
  }
  label > input,
  label > textarea,
  label > select {
    display: block;
    margin-top: 4px;
    font-weight: 400;
  }
  .field-note {
    margin: 4px 0 0;
    color: var(--muted-foreground);
    font-size: 13px;
    line-height: 1.6;
  }
  form > p,
  form > label {
    margin-bottom: 20px;
  }
  form > button:last-child {
    margin-top: 4px;
  }
  .text-input:focus,
  input:not(
      [type='checkbox'],
      [type='radio'],
      [type='file'],
      [type='hidden'],
      [type='submit'],
      [type='button'],
      [type='reset'],
      [type='image'],
      [type='range'],
      [type='color']
    ):focus,
  textarea:focus,
  select:focus {
    border: 2px solid var(--foreground);
    outline: none;
  }
  input[type='checkbox'],
  input[type='radio'] {
    accent-color: var(--foreground);
  }
  .button-primary,
  .cta,
  .button-secondary,
  .site-header > noscript a,
  .site-header .account > a.sign-in,
  .button-danger {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    box-sizing: border-box;
    min-height: 44px;
    border-radius: var(--radius-full);
    font: 600 15px/1.2 var(--font-sans);
    text-align: center;
    text-decoration: none;
    cursor: pointer;
  }
  .button-primary,
  .cta {
    padding: 10px 20px;
    border: 0;
    background: var(--primary);
    color: var(--primary-foreground);
  }
  .button-primary:hover,
  .cta:hover {
    opacity: 0.85;
  }
  .button-secondary,
  .site-header > noscript a,
  .site-header .account > a.sign-in {
    padding: 9px 19px;
    border: 1px solid var(--input);
    background: var(--background);
    color: var(--foreground);
  }
  .button-secondary:hover,
  .site-header > noscript a:hover,
  .site-header .account > a.sign-in:hover {
    background: var(--secondary);
  }
  .button-danger {
    padding: 9px 19px;
    border: 1px solid var(--destructive);
    background: var(--background);
    color: var(--destructive);
  }
  .button-danger:disabled {
    opacity: 0.5;
  }
  .reason {
    color: var(--destructive);
  }
  .site-header {
    display: flex;
    align-items: center;
    gap: 16px;
    box-sizing: border-box;
    min-height: 68px;
    padding: 12px 32px;
    border-bottom: 1px solid var(--border);
    background: var(--background);
    color: var(--foreground);
    font-size: 14px;
    line-height: 1.7;
  }
  .site-header .brand {
    display: inline-flex;
    align-items: center;
    min-height: 44px;
    font-weight: 700;
    font-size: 20px;
    color: inherit;
    text-decoration: none;
    margin-right: auto;
  }
  /* Holds its height while empty, so the header does not move when filled. */
  .site-header .account {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 44px;
  }
  .site-header .manage {
    display: inline-flex;
    align-items: center;
    min-height: 44px;
    padding: 0 8px;
    white-space: nowrap;
  }
  /* The circle is 36px to the eye; the area that takes a press is 44px. */
  .button-icon,
  .site-header .bell,
  .site-header .avatar {
    display: grid;
    place-items: center;
    box-sizing: border-box;
    width: 44px;
    height: 44px;
    padding: 0;
    border: 0;
    background: none;
    color: var(--foreground);
    text-decoration: none;
    cursor: pointer;
  }
  .button-icon > span,
  .site-header .bell > span,
  .site-header .avatar > span {
    position: relative;
    display: grid;
    place-items: center;
    box-sizing: border-box;
    width: 36px;
    height: 36px;
    border-radius: var(--radius-full);
    background: var(--secondary);
    font-weight: 700;
    font-size: 15px;
    line-height: 1.2;
    text-transform: uppercase;
  }
  .site-header .bell > span {
    border: 1px solid var(--input);
    background: var(--background);
  }
  .site-header .bell svg {
    width: 18px;
    height: 18px;
  }
  .site-header .bell .unread-dot {
    position: absolute;
    top: 0;
    right: 0;
    margin: 0;
  }
  .site-header .avatar {
    list-style: none;
  }
  .site-header .avatar > span {
    overflow: hidden;
  }
  /* The author's picture covers their initial, which stays if it fails. */
  .site-header .avatar img {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .site-header .avatar::-webkit-details-marker {
    display: none;
  }
  .site-header .menu {
    position: relative;
  }
  .site-header .menu-items {
    position: absolute;
    right: 0;
    top: 48px;
    z-index: 10;
    min-width: 200px;
    padding: 6px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--card);
    box-shadow: var(--shadow-menu);
  }
  .site-header .menu-items form {
    max-width: none;
    margin: 0;
    border-top: 1px solid var(--border-soft);
  }
  .site-header .menu-items a,
  .site-header .menu-items button {
    display: flex;
    align-items: center;
    box-sizing: border-box;
    width: 100%;
    min-height: 44px;
    padding: 8px 12px;
    border: 0;
    border-radius: var(--radius-sm);
    background: none;
    color: inherit;
    font: inherit;
    text-align: left;
    text-decoration: none;
    cursor: pointer;
  }
  .site-header .menu-items a:hover,
  .site-header .menu-items button:hover {
    background: var(--secondary);
  }
  /* Links in a row, the language choice at the row's right end. */
  .site-footer {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0 20px;
    margin-top: 24px;
    padding: 24px 32px;
    border-top: 1px solid var(--border);
    color: var(--muted-foreground);
    font-size: 14px;
    line-height: 1.7;
  }
  .site-footer nav {
    display: flex;
    flex-wrap: wrap;
    gap: 0 20px;
  }
  .site-footer p {
    margin: 0 0 0 auto;
  }
  .site-footer a {
    display: inline-flex;
    align-items: center;
    min-height: 44px;
    color: inherit;
    text-decoration: none;
  }
  .site-footer a:hover {
    text-decoration: underline;
  }
  .site-footer strong {
    color: var(--foreground);
  }
  @media (max-width: 599px) {
    .site-header,
    .site-footer {
      padding-left: 16px;
      padding-right: 16px;
    }
    .site-footer p {
      flex-basis: 100%;
      margin-left: 0;
    }
  }
  .cards {
    list-style: none;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
    gap: 16px;
  }
  .card {
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: var(--radius-card);
    padding: 16px;
  }
  .card-title {
    font-weight: 600;
    font-size: 17px;
    color: inherit;
    overflow-wrap: anywhere;
  }
  .notification-list,
  .settings-rows {
    list-style: none;
    padding: 0;
    display: grid;
  }
  .notification-item {
    position: relative;
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    column-gap: 8px;
    padding: 12px 0;
    border-bottom: 1px solid var(--border);
    line-height: 1.6;
    color: inherit;
    text-decoration: none;
  }
  .notification-list .unread .notification-item {
    grid-template-columns: 12px minmax(0, 1fr);
  }
  .notification-item:is(:hover, :focus-visible) .notification-message {
    text-decoration: underline;
  }
  .unread-dot {
    grid-row: 1 / span 2;
    align-self: start;
    width: 8px;
    height: 8px;
    margin-top: 0.55em;
    border-radius: var(--radius-full);
    background: var(--unread);
  }
  @keyframes unread-pop {
    0% {
      transform: scale(0);
    }
    70% {
      transform: scale(1.4);
    }
  }
  @media (prefers-reduced-motion: no-preference) {
    .unread-dot {
      animation: unread-pop 300ms var(--ease-spring);
    }
    .deck-card:hover .deck-cover {
      transform: translateY(-2px);
    }
  }
  .notification-list .unread .notification-message {
    font-weight: 600;
  }
  .notification-message,
  .notification-meta {
    grid-column: 1;
  }
  .notification-list .unread .notification-message,
  .notification-list .unread .notification-meta {
    grid-column: 2;
  }
  .notification-meta {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 6px;
    color: var(--muted-foreground);
    font-size: 13px;
    font-weight: 400;
    line-height: 1.6;
  }
  /* The word stays for screen readers. The dot is the visual mark. */
  .new-badge {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }
  .settings-rows {
    grid-template-columns: minmax(0, 1fr) auto;
    column-gap: 16px;
  }
  .settings-rows li,
  .settings-rows form {
    display: grid;
    grid-column: 1 / -1;
    grid-template-columns: subgrid;
    align-items: center;
  }
  .settings-rows li {
    padding: 12px 0;
    border-bottom: 1px solid var(--border);
  }
  .settings-rows form {
    margin: 0;
    row-gap: 6px;
  }
  .preference-state {
    color: var(--muted-foreground);
  }
  @media (width > 600px) {
    #notifications .settings-rows {
      grid-template-columns: minmax(0, 1fr) auto auto;
    }
  }
  @media (max-width: 600px) {
    .preference-kind {
      grid-column: 1 / -1;
    }
  }
  .profile h1,
  .card-meta {
    overflow-wrap: anywhere;
  }
  .color-block {
    position: relative;
    overflow: hidden;
    border-radius: var(--radius-block);
    padding: var(--space-block);
    color: var(--foreground);
  }
  .color-block-purple {
    background: var(--block-purple);
  }
  .profile-head h1 {
    margin: 0;
    font-size: 32px;
    font-weight: 700;
    line-height: 1.35;
  }
  .profile-head .card-meta {
    margin: 4px 0 0;
    color: var(--foreground);
    font-size: 16px;
    font-weight: 400;
    line-height: 1.8;
  }
  .profile-heading {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    column-gap: 12px;
    row-gap: 8px;
  }
  .profile-heading form {
    margin: 0;
  }
  .profile-heading button:focus-visible {
    outline: 2px solid var(--ring);
    outline-offset: 2px;
  }
  /*
   * Pressing "following" unfollows; hover and focus say so before the press.
   * Both labels share one grid cell, so the button keeps the width of the
   * longer one and the pointer never falls off it when the label changes.
   */
  .profile-heading button.following {
    display: inline-grid;
  }
  .profile-heading button.following .state,
  .profile-heading button.following .act {
    grid-area: 1 / 1;
  }
  .profile-heading button.following .act,
  .profile-heading button.following:hover .state,
  .profile-heading button.following:focus-visible .state {
    visibility: hidden;
  }
  .profile-heading button.following:hover .act,
  .profile-heading button.following:focus-visible .act {
    visibility: visible;
  }
  .profile-heading button.following:hover,
  .profile-heading button.following:focus-visible {
    border-color: var(--destructive);
    color: var(--destructive);
  }
  .profile .portrait {
    display: block;
    width: 96px;
    height: 96px;
    border-radius: var(--radius-full);
    background: var(--border);
  }
  .profile .profile-head .portrait {
    margin: 0 0 16px;
    background: var(--block-purple-deep);
    object-fit: cover;
  }
  .profile .facts {
    list-style: none;
    margin: 12px 0;
    padding: 0;
    display: flex;
    flex-wrap: wrap;
    gap: 4px 20px;
    overflow-wrap: anywhere;
  }
  .profile .fact-name {
    color: var(--muted-foreground);
    font-size: 14px;
    margin-right: 4px;
  }
  .card-meta,
  .empty {
    color: var(--muted-foreground);
    font-size: 14px;
    margin: 8px 0 0;
  }
  .published h2 {
    font-size: 24px;
    font-weight: 700;
    line-height: 1.4;
  }
  /* Cards wrap and never run sideways: 2 across on a phone, 3 or 4 wider. */
  .deck-grid {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 24px 16px;
  }
  @media (min-width: 760px) {
    .deck-grid {
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 24px;
    }
    .deck-grid-4 {
      grid-template-columns: repeat(4, minmax(0, 1fr));
    }
  }
  .deck-card {
    min-width: 0;
    background: none;
    border: 0;
    padding: 0;
  }
  .deck-cover {
    position: relative;
    display: block;
    aspect-ratio: 16 / 9;
    margin-bottom: 8px;
    border-radius: var(--radius);
    background: var(--stage);
    overflow: hidden;
    transition: transform var(--duration-fast);
  }
  /* The lower layer: the name, shown until the image covers it. */
  .deck-cover-name {
    position: absolute;
    inset: 0;
    display: -webkit-box;
    box-sizing: border-box;
    margin: auto;
    height: fit-content;
    padding: 0 12px;
    overflow: hidden;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    color: var(--primary-foreground);
    font-size: 13px;
    font-weight: 700;
    line-height: 1.5;
    text-align: center;
  }
  .deck-cover img {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .deck-cover img[hidden] {
    display: none;
  }
  .deck-card .card-title {
    display: block;
    min-height: 44px;
    font-size: 16px;
    font-weight: 700;
    line-height: 1.5;
    text-decoration: none;
  }
  .deck-card .deck-name {
    display: -webkit-box;
    overflow: hidden;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
  }
  .deck-card .card-meta {
    margin: 4px 0 0;
    color: var(--muted-foreground);
    font-size: 13px;
    font-weight: 400;
    line-height: 1.6;
  }
  .deck-card .card-meta a {
    color: inherit;
  }
  .recent-message {
    color: var(--muted-foreground);
  }
  /*
   * Where slides are dropped. The dashed line turns solid while a file is
   * held over the frame, to say it will be taken.
   */
  .drop-zone {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
    box-sizing: border-box;
    margin: 40px 0 0;
    padding: 24px 16px;
    border: 2px dashed var(--input);
    border-radius: var(--radius-block);
    text-align: center;
  }
  .drop-zone[data-over] {
    border-style: solid;
    border-color: var(--foreground);
  }
  .drop-zone-large {
    padding: 56px 16px;
  }
  .drop-zone p {
    max-width: 40em;
    margin: 0;
  }
  .drop-title {
    font-size: 18px;
    font-weight: 700;
    line-height: 1.5;
  }
  .drop-zone-large .drop-title {
    font-size: 24px;
    line-height: 1.4;
  }
  .drop-note {
    color: var(--muted-foreground);
    font-size: 13px;
    line-height: 1.6;
  }
  button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .empty-state {
    border-radius: var(--radius-block);
    padding: 24px;
    background: var(--block-ecru);
    color: var(--foreground);
  }
  .empty-state p {
    margin: 0 0 16px;
    color: var(--foreground);
    font-size: 16px;
    font-weight: 400;
    line-height: 1.8;
  }
  .empty-state p:last-child {
    margin-bottom: 0;
  }
  .narrow {
    max-width: 640px;
  }
  .narrow h1 {
    font-size: 32px;
    font-weight: 700;
    line-height: 1.35;
  }
  .field-label {
    display: block;
    font-size: 14px;
    font-weight: 600;
    line-height: 1.7;
  }
  .notice-success,
  .notice-warning,
  .notice-danger {
    border-radius: var(--radius);
    padding: 12px 16px;
    border: 1px solid;
  }
  .notice-success {
    background: var(--success-soft);
    color: var(--success);
    border-color: var(--success);
  }
  .notice-warning {
    background: var(--warning-soft);
    color: var(--warning);
    border-color: var(--warning);
  }
  .notice-danger {
    background: var(--destructive-soft);
    color: var(--destructive);
    border-color: var(--destructive);
  }
  .preserve-lines {
    white-space: pre-wrap;
  }
  .color-block-ecru {
    background: var(--block-ecru);
  }
  .error-block {
    margin-top: 40px;
  }
  .color-block-ecru h1 {
    margin: 0 0 16px;
    font-size: 32px;
    font-weight: 700;
    line-height: 1.35;
  }
  .color-block-ecru h2 {
    font-size: 24px;
    font-weight: 700;
    line-height: 1.4;
  }
  .status-chip {
    display: inline-block;
    width: fit-content;
    max-width: 100%;
    margin: 8px 0;
    padding: 2px 10px;
    border-radius: var(--radius-full);
    font-size: 13px;
    font-weight: 600;
    line-height: 1.6;
  }
  .status-draft {
    background: var(--secondary);
    color: var(--foreground);
  }
  .status-public {
    background: var(--success-soft);
    color: var(--success);
  }
  .status-paused {
    background: var(--warning-soft);
    color: var(--warning);
  }
  .status-hidden {
    background: var(--destructive-soft);
    color: var(--destructive);
  }
  .data-table {
    width: 100%;
    border-collapse: collapse;
    background: var(--background);
  }
  .data-table th {
    color: var(--muted-foreground);
    font-size: 13px;
    font-weight: 600;
    line-height: 1.6;
  }
  .cell-label {
    display: none;
  }
  pre.code-block {
    border: 0;
    border-radius: var(--radius);
    background: var(--secondary);
    padding: 12px;
    overflow-x: auto;
  }
  pre.code-block code {
    font: 13px/1.6 var(--font-mono);
    background: none;
    padding: 0;
  }
  p code {
    padding: 0 4px;
    border-radius: var(--radius-sm);
    background: var(--secondary);
  }
  .step-heading {
    display: grid;
    grid-template-columns: 24px minmax(0, 1fr);
    gap: 12px;
    align-items: center;
    font-size: 18px;
    font-weight: 700;
    line-height: 1.5;
  }
  .step-index {
    display: grid;
    place-items: center;
    width: 24px;
    height: 24px;
    border-radius: var(--radius-full);
    background: var(--foreground);
    color: var(--background);
    font-size: 13px;
    font-weight: 700;
    line-height: 1;
  }
  .steps {
    list-style: none;
    margin: 0;
    padding: 0;
    counter-reset: step;
  }
  .steps > li {
    display: grid;
    grid-template-columns: 24px minmax(0, 1fr);
    gap: 12px;
    align-items: center;
    margin: 12px 0;
    font-size: 18px;
    font-weight: 700;
    line-height: 1.5;
    counter-increment: step;
  }
  .steps > li::before {
    content: counter(step);
    display: grid;
    place-items: center;
    width: 24px;
    height: 24px;
    border-radius: var(--radius-full);
    background: var(--foreground);
    color: var(--background);
    font-size: 13px;
    font-weight: 700;
    line-height: 1;
  }
  @media (max-width: 599px) {
    .button-primary,
    .cta {
      display: flex;
      width: 100%;
      align-items: center;
      justify-content: center;
    }
    .data-table th {
      position: absolute;
      width: 1px;
      height: 1px;
      padding: 0;
      overflow: hidden;
      clip: rect(0, 0, 0, 0);
      white-space: nowrap;
      border: 0;
    }
    .data-table,
    .data-table tbody,
    .data-table tr,
    .data-table td {
      display: block;
      width: auto;
    }
    .data-table tr {
      padding: 8px 0 12px;
      border-bottom: 1px solid var(--border);
    }
    .data-table td {
      border: 0;
      padding: 4px 0;
    }
    .cell-label {
      display: block;
      color: var(--muted-foreground);
      font-size: 13px;
      font-weight: 600;
      line-height: 1.6;
    }
  }
</style>`
