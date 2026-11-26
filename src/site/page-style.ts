import { html, raw } from 'hono/html'
import { toneCss } from '../communities/community-card'
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
    /* A short page still ends at the screen's bottom: the footer sits there. */
    display: flex;
    flex-direction: column;
    min-height: 100vh;
    min-height: 100dvh;
  }
  /* One column holds every page's own markup; see DESIGN.md for the widths. */
  main {
    flex: 1 0 auto;
    box-sizing: border-box;
    width: 100%;
    max-width: 960px;
    margin: 0 auto;
    padding: 0 16px 64px;
  }
  /*
   * The page itself sits inside main, which a move to another page keeps:
   * only its children are replaced, so what differs per page (the width,
   * the reading line height) hangs on this element, not on main.
   */
  .page-reading {
    max-width: 720px;
    margin: 0 auto;
    line-height: 1.9;
  }
  .page-narrow {
    max-width: 640px;
    margin: 0 auto;
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
  .page > p,
  .page > section > p,
  .page form {
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
  /*
   * A link on its own whose drawn box is shorter than 44px keeps its look and
   * gets a 44px-tall touch area, centred on it, from an invisible layer.
   */
  .tap-area {
    position: relative;
  }
  .tap-area::after {
    content: '';
    position: absolute;
    top: min(0px, calc(50% - 22px));
    bottom: min(0px, calc(50% - 22px));
    left: -4px;
    right: -4px;
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
  /* A link to the help that stands alone: tall enough to press. */
  .help-link {
    display: inline-flex;
    align-items: center;
    min-height: 44px;
    font-size: 13px;
  }
  form > p,
  form > label {
    margin-bottom: 20px;
  }
  /* The button that sends a form sits 24px under its last field. */
  form > button:last-child {
    margin-top: 4px;
  }
  form > .field-note + button,
  form > input + button {
    margin-top: 24px;
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
  /* The icon alone: a 44px square to press, no underline on a mark. */
  .site-footer a.github-link {
    justify-content: center;
    min-width: 44px;
  }
  .site-footer a.github-link:hover {
    text-decoration: none;
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
    .preference-kind,
    .agent-name {
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
  .profile-heading {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    column-gap: 12px;
    row-gap: 8px;
  }
  .follow-form {
    margin: 0;
  }
  /*
   * The modal that asks a reader who is not signed in to sign in, and the
   * one that shows the address a link leads to before it is followed. Each
   * is a plain panel over the page; no color of its own, no shape cut out.
   */
  .login-prompt,
  .link-check {
    position: fixed;
    inset: 0;
    z-index: 100;
    display: grid;
    place-items: center;
    padding: 16px;
    box-sizing: border-box;
    background: color-mix(in oklch, var(--foreground) 40%, transparent);
  }
  .login-prompt-panel,
  .link-check-panel {
    box-sizing: border-box;
    width: min(100%, 440px);
    max-height: 100%;
    overflow-y: auto;
    padding: 24px;
    border: 1px solid var(--border);
    border-radius: var(--radius-xl);
    background: var(--card);
    color: var(--card-foreground);
  }
  .login-prompt-panel h2,
  .link-check-panel h2 {
    margin: 0 0 12px;
    font-size: 20px;
    line-height: 1.4;
  }
  .login-prompt-panel p,
  .link-check-panel p {
    margin: 0 0 20px;
  }
  /* The whole address, wrapped anywhere: it is checked, not read as words. */
  .link-check-panel .link-check-url {
    padding: 8px 12px;
    border-radius: var(--radius);
    background: var(--muted);
    font-family: var(--font-mono);
    font-size: 13px;
    line-height: 1.6;
    overflow-wrap: anywhere;
    word-break: break-all;
  }
  .login-prompt-actions,
  .link-check-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
  }
  /* Over the row's stretched link, so the button takes its own presses. */
  .people-list .follow-form {
    position: relative;
    z-index: 1;
  }
  .profile-heading button:focus-visible,
  .people-list button:focus-visible {
    outline: 2px solid var(--ring);
    outline-offset: 2px;
  }
  /*
   * Pressing "following" unfollows; hover and focus say so before the press.
   * Both labels share one grid cell, so the button keeps the width of the
   * longer one and the pointer never falls off it when the label changes.
   */
  button.following {
    display: inline-grid;
  }
  button.following .state,
  button.following .act {
    grid-area: 1 / 1;
  }
  button.following .act,
  button.following:hover .state,
  button.following:focus-visible .state {
    visibility: hidden;
  }
  button.following:hover .act,
  button.following:focus-visible .act {
    visibility: visible;
  }
  button.following:hover,
  button.following:focus-visible {
    border-color: var(--destructive);
    color: var(--destructive);
  }
  .profile .portrait {
    position: relative;
    display: block;
    width: 96px;
    height: 96px;
    overflow: hidden;
    border-radius: var(--radius-full);
    background: var(--border);
  }
  .profile .portrait {
    flex: none;
    margin: 0;
  }
  /* The picture covers the initial, which stays if it cannot be read. */
  .profile .portrait-image {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  /* The picture beside the name and facts; the button at the far right. */
  .profile-head {
    display: flex;
    align-items: flex-start;
    gap: 24px;
    margin-top: 40px;
  }
  .profile-body {
    flex: 1;
    min-width: 0;
  }
  .profile-body h1 {
    margin: 0 0 4px;
  }
  .profile-action {
    flex: none;
    align-self: center;
    margin-left: auto;
  }
  /* Follow, then the ⋯ menu; a refused follow keeps its note under it. */
  .profile-buttons {
    display: flex;
    align-items: flex-start;
    gap: 8px;
  }
  .follow-refused {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
  }
  .follow-refused .field-note {
    margin-top: 8px;
  }
  @media (max-width: 599px) {
    .follow-refused {
      align-items: flex-start;
    }
  }
  @media (max-width: 599px) {
    .profile-head {
      flex-direction: column;
      gap: 16px;
    }
    .profile-action {
      align-self: flex-start;
      margin-left: 0;
    }
  }
  .profile .portrait-initial {
    display: grid;
    place-items: center;
    color: var(--muted-foreground);
    font-size: 40px;
    font-weight: 700;
    line-height: 1;
  }
  .profile .profile-bio {
    margin: 8px 0 0;
    max-width: 60ch;
    overflow-wrap: anywhere;
    /* The author's own line breaks stay. */
    white-space: pre-line;
  }
  .profile .facts {
    list-style: none;
    margin: 12px 0;
    padding: 0;
    display: flex;
    flex-wrap: wrap;
    /* Rows 44px apart, so the touch areas of the links on them do not overlap. */
    gap: 26px 20px;
    overflow-wrap: anywhere;
  }
  /* Links in one row keep a space between them. */
  .profile .facts li a + a {
    margin-left: 14px;
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
  /*
   * The switch between a profile's slides and its lists, each with its count.
   * The tabs stay on one row: where they are wider than the page, the row
   * alone slides sideways, and the page does not.
   */
  .profile-tabs {
    display: flex;
    flex-wrap: nowrap;
    gap: 0 24px;
    margin: 32px 0 24px;
    border-bottom: 1px solid var(--border);
    overflow-x: auto;
    overscroll-behavior-x: contain;
    scrollbar-width: thin;
  }
  .profile-tabs a {
    flex: none;
    white-space: nowrap;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-height: 44px;
    padding: 0 4px;
    border-bottom: 3px solid transparent;
    color: var(--foreground);
    font-size: 15px;
    text-decoration: none;
  }
  .profile-tabs a[aria-current='page'] {
    border-bottom-color: var(--foreground);
    font-weight: 700;
  }
  .profile-tabs .count {
    color: var(--muted-foreground);
    font-size: 13px;
    font-weight: 400;
  }
  .people-list {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  /* The name's link is stretched over the row, so the whole row opens it. */
  .people-list li {
    position: relative;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 16px;
    padding: 14px 0;
    border-bottom: 1px solid var(--border);
  }
  .person-face {
    position: relative;
    flex: none;
    display: grid;
    place-items: center;
    width: 48px;
    height: 48px;
    border-radius: var(--radius-full);
    background: var(--border);
    font-weight: 700;
    overflow: hidden;
  }
  .person-face img {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .person-names {
    flex: 1 1 120px;
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .person-name {
    color: var(--foreground);
    font-weight: 600;
    text-decoration: none;
  }
  .person-name::after {
    content: '';
    position: absolute;
    inset: 0;
  }
  .people-list li:hover .person-name {
    text-decoration: underline;
  }
  .person-handle {
    display: block;
    color: var(--muted-foreground);
    font-size: 14px;
  }
  .people-none {
    color: var(--muted-foreground);
  }
  .people-pages {
    display: flex;
    gap: 24px;
    margin-top: 16px;
  }
  .people-pages a {
    display: inline-flex;
    align-items: center;
    min-height: 44px;
  }
  /* A profile's citations: the cover, then who and what, then the day. */
  .citation-list {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .citation-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 16px;
    padding: 16px 0;
    border-bottom: 1px solid var(--border);
  }
  .citation-cover {
    flex: none;
    width: 160px;
    max-width: 100%;
  }
  .citation-cover .deck-cover {
    margin-bottom: 0;
  }
  .citation-body {
    flex: 1 1 280px;
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .citation-deck,
  .citation-line {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px 8px;
    margin: 0;
  }
  .citation-deck {
    font-size: 14px;
  }
  .citation-deck a {
    color: var(--foreground);
    text-decoration: none;
  }
  .citation-deck .citation-title {
    font-weight: 600;
  }
  .citation-deck a:hover {
    text-decoration: underline;
  }
  .citation-face {
    display: grid;
    place-items: center;
    width: 20px;
    height: 20px;
    border-radius: var(--radius-full);
    background: var(--border);
    font-size: 11px;
    font-weight: 700;
  }
  .citation-line {
    margin-top: 8px;
    color: var(--muted-foreground);
    font-size: 13px;
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
  /*
   * A white first slide on the white page has no visible edge. A faint line
   * drawn over the cover (not a border, so the 16:9 box does not change)
   * marks it.
   */
  .deck-cover::after {
    content: '';
    position: absolute;
    inset: 0;
    border-radius: inherit;
    box-shadow: inset 0 0 0 1px rgb(0 0 0 / 0.08);
    pointer-events: none;
  }
  @media (forced-colors: active) {
    .deck-cover::after {
      box-shadow: none;
      outline: 1px solid CanvasText;
      outline-offset: -1px;
    }
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
  /*
   * The top page's cards hold the same height whether they are placeholders,
   * real or spares (F03-AC80, F03-AC83): the name takes two lines, the
   * line under it one.
   */
  .home .deck-card .deck-name {
    min-height: 48px;
  }
  .home .deck-card .card-meta {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  /* Room kept for cards that did not come, and for a visitor who is no one. */
  .home-spare {
    visibility: hidden;
  }
  .visually-hidden {
    position: absolute;
    width: 1px;
    height: 1px;
    margin: -1px;
    padding: 0;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }
  /*
   * The tabs of the top page's lists (F03-AC158), drawn as a profile's are.
   * They stay on one row: where they are wider than the page, the row alone
   * slides sideways, and the page does not (F03-AC171).
   */
  .home-tab-row {
    display: flex;
    flex-wrap: nowrap;
    gap: 0 24px;
    margin: 40px 0 24px;
    border-bottom: 1px solid var(--border);
    overflow-x: auto;
    overscroll-behavior-x: contain;
    scrollbar-width: thin;
  }
  .home-tab-row [role='tab'] {
    flex: none;
    white-space: nowrap;
    display: inline-flex;
    align-items: center;
    min-height: 44px;
    margin: 0;
    padding: 0 4px;
    border: 0;
    border-bottom: 3px solid transparent;
    background: none;
    color: var(--foreground);
    font: inherit;
    font-size: 15px;
    cursor: pointer;
  }
  .home-tab-row [role='tab'][aria-selected='true'] {
    border-bottom-color: var(--foreground);
    font-weight: 700;
  }
  .home-tabs [role='tabpanel'][hidden] {
    display: none;
  }
  /* On a narrow screen a tab's slides stand one across (F03-AC171). */
  @media (max-width: 599px) {
    .home-tabs .deck-grid {
      grid-template-columns: minmax(0, 1fr);
    }
  }
  /*
   * In a tab, a note stands at the top of the room it holds: one across on
   * a narrow screen, that room is tall, and a note in its middle would sit
   * far below the tabs. The room keeps its height (F03-AC175).
   */
  .home-tabs .home-room-note {
    justify-content: flex-start;
    padding-top: 48px;
  }
  /* With no card to show, the note stands alone in place of the room. */
  .home-tabs .home-room-empty {
    position: static;
    padding: 48px 16px 0;
  }
  /*
   * "Show more" under a tab's cards, and the note that takes its place
   * when the next cards could not be read (F03-AC162, F03-AC165).
   */
  .home-tabs .home-more,
  .home-more-note {
    display: flex;
    margin: 32px auto 0;
  }
  .home-more-note {
    flex-direction: column;
    gap: 12px;
    align-items: center;
    color: var(--muted-foreground);
    text-align: center;
  }
  .home-more-note p {
    margin: 0;
  }
  /* What following does, for a visitor who is not signed in (F03-AC167). */
  .home-prompt .home-prompt-title {
    color: var(--foreground);
    font-weight: 700;
  }
  .home-room {
    position: relative;
  }
  .home-room-note p {
    margin: 0;
  }
  .home-room-note {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    gap: 12px;
    align-items: center;
    justify-content: center;
    margin: 0;
    padding: 0 16px;
    color: var(--muted-foreground);
    text-align: center;
  }
  .recent-message {
    color: var(--muted-foreground);
  }
  /*
   * Under each card's author in the "followed communities" tab, the
   * community, after a small mark of its color (F31-AC4). The mark is the
   * only place the community's color reaches on a card (D-45).
   */
  .card-community {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
  }
  .card-community a {
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .community-mark {
    flex: none;
    width: 10px;
    height: 10px;
    border-radius: 3px;
  }
  .community-mark-red {
    background: var(--community-red);
  }
  .community-mark-orange {
    background: var(--community-orange);
  }
  .community-mark-yellow {
    background: var(--community-yellow);
  }
  .community-mark-green {
    background: var(--community-green);
  }
  .community-mark-navy {
    background: var(--community-navy);
  }
  /*
   * A list of communities (F30-AC46): one card across on a phone, two or
   * three wider. Each card is its cover, its logo beside its name, and its
   * description cut at two lines, and every card is as tall as the others:
   * the cover is 4:1, the name takes two lines beside the logo, and the
   * description holds two lines even when it is short or empty.
   */
  .community-grid {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 24px;
  }
  @media (min-width: 600px) {
    .community-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 24px 16px;
    }
  }
  @media (min-width: 760px) {
    .community-grid {
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 24px;
    }
  }
  .community-card {
    min-width: 0;
  }
  .community-card > a,
  .community-card > div {
    display: block;
    color: var(--foreground);
    text-decoration: none;
  }
  .community-card-cover {
    display: grid;
    aspect-ratio: 4 / 1;
    margin-bottom: 12px;
    border-radius: var(--radius);
    background: var(--muted);
    overflow: hidden;
  }
  .community-card-cover img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  /* The squares stay square inside the 4:1 frame, none cut at the edge. */
  .community-card-cover-pattern {
    grid-template-columns: repeat(8, minmax(0, 1fr));
    align-content: center;
    gap: 4px;
    background: none;
  }
  .community-card-cover-pattern > span {
    aspect-ratio: 1;
    border-radius: 18%;
  }
  .community-card-head {
    display: flex;
    align-items: center;
    gap: 12px;
    min-height: 48px;
  }
  .community-card-logo {
    display: grid;
    place-items: center;
    flex: none;
    box-sizing: border-box;
    width: 48px;
    height: 48px;
    border-radius: 22%;
    font-size: 22px;
    font-weight: 700;
    line-height: 1;
    object-fit: cover;
    overflow: hidden;
  }
  /* A placeholder's logo, while the top page's list is on its way. */
  .community-card > div .community-card-logo {
    background: var(--muted);
  }
  .community-card-name,
  .community-card-description {
    display: -webkit-box;
    min-width: 0;
    overflow: hidden;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
  }
  .community-card-name {
    font-size: 16px;
    font-weight: 700;
    line-height: 1.5;
  }
  .community-card-description {
    min-height: 3.2em;
    margin-top: 8px;
    color: var(--muted-foreground);
    font-size: 14px;
    line-height: 1.6;
  }
  ${raw(toneCss)}
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
  /*
   * A signed-in visitor's frame is the small one from the first paint, as
   * /drop.js makes it once it knows who is here (F03-AC80): the page does
   * not shrink under their eyes.
   */
  .home[data-member='yes'] .drop-zone-large {
    padding: 24px 16px;
  }
  .home[data-member='yes'] .drop-zone-large .drop-title {
    font-size: 18px;
    line-height: 1.5;
  }
  .drop-zone p {
    max-width: 40em;
    margin: 0;
  }
  /* The title is the page's h1 on the top page; it looks like the others. */
  .drop-zone .drop-title {
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
  /* While a file is being received, or kept for a sign-in, the line is solid. */
  .drop-zone[data-busy],
  .drop-zone[data-picked] {
    border-style: solid;
  }
  .drop-picked {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 12px;
  }
  /* The script hides parts of the frame; a button's own display would win. */
  .drop-zone [hidden] {
    display: none;
  }
  .drop-picked .drop-file {
    flex-basis: 100%;
    font-weight: 600;
    overflow-wrap: anywhere;
  }
  .drop-status {
    font-size: 14px;
    line-height: 1.6;
  }
  .drop-status[data-refusal] {
    color: var(--destructive);
    font-weight: 600;
  }
  .drop-progress {
    width: 100%;
    max-width: 28em;
    height: 8px;
    overflow: hidden;
    border-radius: 999px;
    background: var(--muted);
  }
  .drop-progress span {
    display: block;
    width: 0;
    height: 100%;
    background: var(--foreground);
    transition: width 0.2s;
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
  /*
   * A menu of actions behind a button: the viewer's share and ⋯ menus, and
   * the ⋯ menu of a profile.
   */
  .action-menu {
    position: relative;
  }
  .action-menu > summary {
    list-style: none;
  }
  .action-menu > summary::-webkit-details-marker {
    display: none;
  }
  .action-menu > summary.button-icon {
    font-size: 18px;
    font-weight: 700;
    line-height: 1;
  }
  .action-menu .menu-items {
    position: absolute;
    right: 0;
    top: 48px;
    z-index: 10;
    min-width: 14em;
    padding: 6px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--card);
    box-shadow: var(--shadow-menu);
  }
  .action-menu .menu-items a,
  .action-menu .menu-items button {
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
    white-space: nowrap;
    cursor: pointer;
  }
  .action-menu .menu-items a:hover,
  .action-menu .menu-items a:focus-visible,
  .action-menu .menu-items button:hover {
    background: var(--secondary);
  }
  .action-menu .menu-items input {
    display: block;
    width: 100%;
    max-width: none;
    margin-bottom: 4px;
    font-family: var(--font-mono);
    font-size: 13px;
  }
  /* An item waiting for what makes it usable, and a field shown on need. */
  .action-menu .menu-items [hidden] {
    display: none;
  }
  /* The question before blocking someone: one column, at most 480px. */
  .block-confirm {
    max-width: 480px;
  }
  .block-person {
    display: flex;
    align-items: center;
    gap: 16px;
    margin: 24px 0;
  }
  .block-actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 12px;
    margin: 32px 0 24px;
  }
  .block-actions form,
  .block-actions button {
    margin: 0;
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
  /* The display above outranks the browser's own [hidden] rule. */
  .status-chip[hidden] {
    display: none;
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
  /* Related links on the editing page of one slide. */
  .link-rows {
    list-style: none;
    margin: 0 0 20px;
    padding: 0;
    border-top: 1px solid var(--border);
  }
  .link-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 12px 16px;
    padding: 10px 0;
    border-bottom: 1px solid var(--border);
  }
  .link-row form {
    margin: 0;
  }
  .link-kinds {
    margin: 0 0 20px;
  }
  .link-kinds > .link-rows {
    margin-bottom: 12px;
  }
  .link-row-kind > select {
    width: auto;
    max-width: 9em;
  }
  .link-row-place {
    color: var(--muted-foreground);
    font-size: 13px;
  }
  .link-row-kind {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    flex: none;
    min-width: 76px;
    font-size: 13px;
    font-weight: 700;
  }
  .link-row-body {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-width: 0;
  }
  .link-row-title {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .link-row-site {
    color: var(--muted-foreground);
    font-size: 13px;
  }
  /* On a narrow screen the kind and "remove" share the first line, and the
     title, the site and the place take the whole second one. */
  @media (max-width: 599px) {
    .link-kinds .link-row {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 8px 12px;
    }
    .link-kinds .link-row > .link-row-body {
      grid-column: 1 / -1;
      grid-row: 2;
    }
  }
  /* The default cover of a community or an event (D-46): rounded squares in
     two rows, sixteen across, eight on a screen 600px wide or less. */
  .cover-pattern {
    display: grid;
    grid-template-columns: repeat(16, minmax(0, 1fr));
    gap: clamp(4px, 0.8vw, 8px);
    margin: 0 0 32px;
  }
  .cover-pattern > span {
    aspect-ratio: 1;
    border-radius: 18%;
  }
  @media (max-width: 600px) {
    .cover-pattern {
      grid-template-columns: repeat(8, minmax(0, 1fr));
    }
    .cover-pattern > span:nth-child(n + 9):nth-child(-n + 16),
    .cover-pattern > span:nth-child(n + 25) {
      display: none;
    }
  }
  .cover-image {
    display: block;
    width: 100%;
    aspect-ratio: 4 / 1;
    object-fit: cover;
    margin: 0 0 32px;
    border-radius: var(--radius);
  }
  /* The page of one event. */
  .event-page > .cover-pattern,
  .event-page > .cover-image {
    margin-top: 40px;
  }
  .event-head {
    margin: 0 0 40px;
  }
  .event-head h1 {
    margin: 8px 0 16px;
    overflow-wrap: anywhere;
  }
  .event-community {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 0;
    font-size: 14px;
  }
  .event-community-prompt {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px 16px;
    max-width: 40em;
    color: var(--muted-foreground);
  }
  .event-talks h2 {
    display: flex;
    align-items: baseline;
    gap: 12px;
  }
  .event-talks-count {
    color: var(--muted-foreground);
    font-size: 14px;
    font-weight: 400;
  }
  /* A bordered box holding one part of a page. */
  .panel {
    box-sizing: border-box;
    margin: 0 0 20px;
    padding: 20px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
  }
  .panel > h2 {
    margin: 0 0 12px;
    font-size: 20px;
  }
  /* A panel that holds one row: less space above and below it than the others. */
  .panel-compact {
    padding-block: 12px;
  }
  .panel > :last-child,
  .panel > form:last-child > :last-child {
    margin-bottom: 0;
  }
  .panel label:not(:first-child) {
    margin-top: 20px;
  }
  /* A label with its field and note; the fields of a form are 20px apart.
     The label is the first child, so the panel's rule for later labels does
     not push it away from its field. */
  .field {
    margin: 0 0 20px;
  }
  /* A field that goes on from an address: its beginning is shown, only the
     rest is typed. One part for every such field. */
  .prefixed-field {
    display: flex;
    align-items: stretch;
    max-width: 28em;
    border: 1px solid var(--input);
    border-radius: var(--radius);
    overflow: hidden;
    background: var(--background);
  }
  .prefixed-field:focus-within {
    outline: 2px solid var(--ring);
    outline-offset: 2px;
  }
  .prefixed-field > span {
    display: flex;
    align-items: center;
    padding: 0 10px;
    white-space: nowrap;
    background: var(--secondary);
    color: var(--muted-foreground);
    font-size: 14px;
  }
  .prefixed-field input,
  .prefixed-field input:focus {
    min-width: 0;
    border: 0;
    border-radius: 0;
    outline: none;
  }
  /* The way to change the end of a slide's URL: a link that opens the field. */
  .url-change {
    margin: 0;
  }
  .url-change > summary {
    display: inline-flex;
    align-items: center;
    min-height: 44px;
    cursor: pointer;
    font-weight: 600;
    text-decoration: underline;
  }
  .url-change[open] > summary {
    margin-bottom: 4px;
  }
  .url-change > form {
    margin: 0;
  }
  /* A read-only value with the button that copies it. */
  .copy-row {
    display: flex;
    gap: 8px;
  }
  .copy-row input {
    flex: 1;
    min-width: 0;
    max-width: none;
    font-family: var(--font-mono);
    font-size: 13px;
  }
  .copy-row button {
    flex: none;
  }
  /*
   * A copy button holds its words and the words it says once it has copied,
   * stacked in one cell: it is as big as the longer, whichever shows.
   */
  .copy-label {
    display: inline-grid;
  }
  .copy-label > * {
    grid-area: 1 / 1;
  }
  .copy-done,
  [data-copied-now] .copy-idle {
    visibility: hidden;
  }
  [data-copied-now] .copy-done {
    visibility: visible;
  }
  /*
   * A group of choices: each one a mark beside its words, in plain weight,
   * a row at least 44px tall to press. The group is a fieldset with a legend.
   */
  fieldset.choices {
    min-width: 0;
    margin: 0 0 20px;
    padding: 0;
    border: 0;
  }
  .choices legend {
    margin: 0 0 4px;
    padding: 0;
    font-size: 14px;
    font-weight: 600;
    line-height: 1.7;
  }
  label.choice {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    box-sizing: border-box;
    min-height: 44px;
    margin: 0;
    padding: 8px 0;
    font-size: 16px;
    font-weight: 400;
    line-height: 1.7;
    cursor: pointer;
  }
  label.choice > input {
    display: block;
    flex: none;
    width: 20px;
    height: 20px;
    margin: 4px 0 0;
  }
  /* The slides being reported: the same 16:9 as everywhere they are framed. */
  .report-slide {
    margin: 0 0 24px;
  }
  .report-slide iframe {
    display: block;
    box-sizing: border-box;
    width: 100%;
    aspect-ratio: 16 / 9;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--stage);
  }
  .choice-row {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  /*
   * One slide's page: one column, in the order the author works through it.
   * The boxes keep their own margins, so the column only spaces the rest.
   */
  .deck-page {
    max-width: 720px;
    margin: 0 auto;
  }
  .deck-head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 12px 16px;
    margin: 0 0 32px;
  }
  .deck-head h1 {
    flex: 1 1 320px;
    min-width: 0;
    margin: 0;
    font-size: 24px;
    line-height: 1.4;
    overflow-wrap: anywhere;
  }
  .deck-page > [data-deck-frame] {
    margin-bottom: 32px;
  }
  .deck-page > .panel {
    margin-bottom: 32px;
  }
  /*
   * The slide frame: its notices, then the one or two versions, then the drop
   * zone for a new one. The zone is low under the rows, its title, button and
   * note on one line where they fit; it is large only while no version was
   * received, as dropping is then all the author can do here.
   */
  [data-deck-frame='slide'] > h2 + * {
    margin-top: 0;
  }
  [data-deck-frame='slide'] .drop-zone {
    margin: 16px 0 0;
  }
  .drop-zone-low {
    flex-direction: row;
    flex-wrap: wrap;
    justify-content: flex-start;
    gap: 4px 12px;
    padding: 8px 16px;
    text-align: left;
  }
  .drop-zone-low .drop-title {
    font-size: 15px;
  }
  .drop-zone-low .drop-note {
    flex-basis: 100%;
  }
  .drop-zone-first {
    min-height: 160px;
    justify-content: center;
    padding: 40px 16px;
  }
  .version-rows {
    list-style: none;
    margin: 16px 0 0;
    padding: 0;
    border-top: 1px solid var(--border);
  }
  .version-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 12px;
    padding: 14px 0;
    border-bottom: 1px solid var(--border);
  }
  /* The row's button keeps to the right end, also when it wraps under. */
  .version-row form {
    margin: 0 0 0 auto;
  }
  .version-row form > button {
    margin-top: 0;
  }
  .version-row-text {
    flex: 1 1 240px;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  /* The version's name, with the publication tag beside it on the first row. */
  .version-row-name {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px 8px;
  }
  .version-row-kind {
    font-weight: 600;
  }
  /*
   * On a narrow screen the name, its tag and the date take the whole line,
   * and "view" and the button go under them.
   */
  @media (max-width: 599px) {
    .version-row-text {
      flex-basis: 100%;
    }
  }
  .version-row-date {
    color: var(--muted-foreground);
    font-size: 13px;
  }
  /* The author's slides, one row each. */
  .deck-rows {
    list-style: none;
    margin: 40px 0 0;
    padding: 0;
    border-top: 1px solid var(--border);
  }
  .deck-row {
    display: grid;
    grid-template-columns: 128px minmax(0, 1fr) auto auto;
    gap: 8px 16px;
    align-items: center;
    padding: 16px 0;
    border-bottom: 1px solid var(--border);
  }
  .deck-row-cover {
    display: block;
  }
  .deck-row .deck-cover {
    margin: 0;
  }
  .deck-row p {
    margin: 0;
  }
  .deck-row-name {
    font-weight: 700;
    line-height: 1.5;
  }
  .deck-row-name a {
    display: inline-flex;
    align-items: center;
    min-height: 44px;
    color: inherit;
    text-decoration: none;
  }
  .deck-row-name a:hover {
    text-decoration: underline;
  }
  .deck-row-edit {
    display: inline-flex;
    align-items: center;
    min-height: 44px;
    white-space: nowrap;
  }
  /* The profile form: fields 20px apart, the social links stacked. */
  .profile-form .field {
    margin: 0 0 20px;
  }
  .profile-form .field > input + input,
  .profile-form .field > .field-error + input {
    margin-top: 8px;
  }
  .profile-form .field-error {
    margin: 8px 0 0;
  }
  /* A labelled checkbox: the box beside its words, 44px tall. */
  .profile-form .check-row {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 44px;
    margin: 8px 0 0;
    font-weight: 400;
  }
  .profile-form .check-row > input {
    display: inline-block;
    width: 20px;
    height: 20px;
    margin: 0;
  }
  .picture-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 12px;
  }
  /* The file field is the pill button's own: the input stays in the page,
     for the keyboard and for screen readers, but is not drawn. */
  /* What the script hides stays hidden whatever display the class gives. */
  .picture-row [hidden],
  #picture-client-error[hidden] {
    display: none;
  }
  /* A panel gives a label after the first one a 20px top margin; this one
     sits in a row, so it has none, or it drops below its neighbours. */
  .picture-row > label.picture-pick {
    margin: 0;
  }
  /* Whatever shows under the row, the saved notice or a refusal, stands 16px
     from it. */
  .picture-row ~ .notice-success,
  .picture-row ~ .notice-danger {
    margin-top: 16px;
  }
  .picture-pick {
    position: relative;
    margin: 0;
    cursor: pointer;
    padding: 9px 19px;
    border: 1px solid var(--input);
    background: var(--background);
    color: var(--foreground);
  }
  .picture-pick:hover {
    background: var(--secondary);
  }
  /* Until the script can shrink a picture, no file can be chosen. */
  .picture-pick:has(> input:disabled) {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .picture-pick:has(> input:disabled):hover {
    background: var(--background);
  }
  .picture-pick > input[type='file']:disabled {
    cursor: not-allowed;
  }
  .picture-pick:focus-within {
    outline: 2px solid var(--ring);
    outline-offset: 2px;
  }
  .picture-pick > input[type='file'] {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    margin: 0;
    padding: 0;
    border: 0;
    opacity: 0;
    cursor: pointer;
  }
  .account-facts {
    display: flex;
    flex-wrap: wrap;
    gap: 16px 32px;
    margin: 0 0 16px;
  }
  .account-facts > div {
    flex: 1 1 200px;
    min-width: 0;
  }
  .account-facts dt {
    font-size: 13px;
    font-weight: 600;
  }
  .account-facts dd {
    margin: 4px 0 0;
    overflow-wrap: anywhere;
  }
  .account-facts > .account-devices {
    flex-basis: 100%;
  }
  .device-list {
    list-style: none;
    margin: 8px 0 12px;
    padding: 0;
    border-top: 1px solid var(--border);
  }
  .device-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 8px 16px;
    padding: 12px 0;
    border-bottom: 1px solid var(--border);
  }
  .device-row-text {
    display: grid;
    gap: 2px;
    flex: 1 1 220px;
    min-width: 0;
  }
  .device-name {
    font-weight: 600;
  }
  .device-current {
    margin-left: 8px;
    padding: 1px 8px;
    border: 1px solid var(--border);
    border-radius: 999px;
    font-size: 12px;
    color: var(--muted-foreground);
  }
  .device-times {
    font-size: 13px;
    color: var(--muted-foreground);
  }
  .device-row form {
    margin: 0;
  }
  .settings-identity {
    display: flex;
    align-items: center;
    gap: 16px;
    margin-bottom: 16px;
  }
  .settings-identity p {
    margin: 0;
  }
  .settings-face {
    position: relative;
    display: grid;
    place-items: center;
    flex: none;
    width: 64px;
    height: 64px;
    overflow: hidden;
    border-radius: var(--radius-full);
    background: var(--secondary);
    font-size: 24px;
    font-weight: 700;
    text-transform: uppercase;
  }
  .settings-face img {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  @media (max-width: 599px) {
    .deck-row {
      grid-template-columns: 96px minmax(0, 1fr);
    }
    .deck-row .status-chip {
      grid-column: 1;
      justify-self: start;
    }
    .deck-row-edit {
      grid-column: 2;
      justify-self: end;
    }
  }
  /* A table in a narrow column is stacked at every width. */
  .stacked-table th {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }
  .stacked-table,
  .stacked-table tbody,
  .stacked-table tr,
  .stacked-table td {
    display: block;
    width: auto;
  }
  .stacked-table tr {
    padding: 8px 0 12px;
    border-bottom: 1px solid var(--border);
  }
  .stacked-table td {
    border: 0;
    padding: 4px 0;
  }
  .stacked-table .cell-label {
    display: block;
    color: var(--muted-foreground);
    font-size: 13px;
    font-weight: 600;
    line-height: 1.6;
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
