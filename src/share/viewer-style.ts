import { html } from 'hono/html'

/**
 * What only the viewer needs on top of the shared page styles: the stage
 * the slides run in, and the rows under it.
 */
export const viewerStyle = html`<style>
  .page.viewer {
    padding-top: 24px;
  }
  /* Related links: round links that wrap, one per link. */
  .related-links {
    margin: 32px 0 0;
  }
  .related-links h2 {
    margin: 0 0 12px;
    font-size: 24px;
  }
  .related-links ul {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    list-style: none;
    margin: 0;
    padding: 0;
    min-width: 0;
  }
  .related-links li {
    max-width: 100%;
    min-width: 0;
  }
  .related-link {
    box-sizing: border-box;
    display: flex;
    align-items: center;
    gap: 8px;
    max-width: 100%;
    min-height: 44px;
    padding: 0 16px;
    border: 1px solid var(--border);
    border-radius: var(--radius-full);
    color: var(--foreground);
    text-decoration: none;
  }
  .related-link-kind {
    flex: none;
    font-size: 13px;
    font-weight: 700;
  }
  .related-link-title {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .related-link-site {
    flex: 0 1 auto;
    min-width: 0;
    max-width: 40%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--muted-foreground);
    font-size: 13px;
  }
  .related-link .link-icon {
    flex: none;
  }
  /* What the author is told above slides readers cannot see. */
  .viewer-notice {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 12px 16px;
    margin: 0 0 16px;
    padding: 12px 16px;
    border: 2px solid var(--foreground);
    border-radius: var(--radius);
  }
  .viewer-notice p {
    margin: 0;
    font-weight: 700;
  }
  .viewer-notice form {
    margin: 0;
  }
  .viewer-notice-quiet {
    border-width: 1px;
    border-color: var(--border);
  }
  .viewer-notice[hidden] {
    display: none;
  }
  /* The slides take the full width of the column, 16:9. */
  .stage > iframe {
    display: block;
    width: 100%;
    aspect-ratio: 16 / 9;
    max-height: calc(100vh - 190px);
    max-height: calc(100dvh - 190px);
    border: 0;
    border-radius: var(--radius);
    background: var(--stage);
  }
  .stage > iframe:fullscreen {
    max-height: none;
    border-radius: 0;
  }
  /* The title and author on the left, the three actions on the right. */
  .viewer-head {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px 16px;
    margin-top: 16px;
  }
  .viewer-title {
    flex: 1 1 320px;
    min-width: 0;
  }
  .viewer-title h1 {
    margin: 0;
    font-size: 24px;
    line-height: 1.4;
  }
  .viewer-author {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px 12px;
    margin: 8px 0 0;
  }
  .viewer-author .author-link {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    min-height: 44px;
    text-decoration: none;
  }
  .viewer-author .author-face {
    position: relative;
    display: grid;
    place-items: center;
    flex: none;
    width: 36px;
    height: 36px;
    overflow: hidden;
    border-radius: var(--radius-full);
    background: var(--secondary);
    font-size: 15px;
    font-weight: 700;
    line-height: 1.2;
    text-transform: uppercase;
  }
  .viewer-author .author-face img {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  /* A secondary pill. Following is the quieter form. */
  .viewer-author a[data-follow-handle],
  .viewer-author a[data-login-prompt='follow'] {
    display: inline-flex;
    align-items: center;
    box-sizing: border-box;
    min-height: 44px;
    padding: 9px 19px;
    border: 1px solid var(--input);
    border-radius: var(--radius-full);
    background: var(--background);
    color: var(--foreground);
    font: 600 15px/1.2 var(--font-sans);
    text-decoration: none;
  }
  .viewer-author a[data-follow-handle][data-following='true'] {
    background: var(--secondary);
    color: var(--muted-foreground);
  }
  .viewer-author a[data-follow-handle][hidden] {
    display: none;
  }
  .viewer-author a[data-follow-handle][aria-busy] {
    opacity: 0.6;
  }
  .viewer-description {
    max-width: 40em;
    margin: 16px 0 0;
    white-space: pre-line;
  }
  /* The actions wrap onto a row of their own on a narrow screen. */
  .viewer-actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
  }
  .viewer-actions button[hidden] {
    display: none;
  }
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
  /* Read out, not shown: the pressed button already says it. */
  .action-menu .share-status {
    position: absolute;
    width: 1px;
    height: 1px;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
  }
  .action-menu .mute-item {
    display: flex;
    align-items: center;
    white-space: nowrap;
  }
  /* Beside the state, the action must read as something to press. */
  .action-menu [data-mute-status] {
    padding-left: 12px;
    color: var(--muted-foreground);
  }
  .action-menu .mute-item a[data-muted='true'] {
    width: auto;
    margin-left: auto;
    font-weight: 600;
    text-decoration: underline;
  }
  [data-reader-lists]:empty {
    display: none;
  }
  .citations h2 {
    margin: 56px 0 16px;
    font-size: 24px;
    font-weight: 700;
    line-height: 1.4;
  }
  .citations-more {
    margin: 16px 0 0;
    color: var(--muted-foreground);
    font-size: 14px;
  }
  /*
   * Where the parts go. The markup has one order: slide, title and actions,
   * the side (author, description, related links, citations), then the
   * article. The stack (also every screen 760px wide or narrower, whatever
   * the reader chose) takes the side's parts one by one and puts the article
   * before the citations, so it looks as the viewer always did.
   */
  .viewer-layout {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    grid-template-areas:
      'slide'
      'title'
      'author'
      'desc'
      'links'
      'article'
      'cites'
      'citedby';
  }
  .viewer-side {
    display: contents;
  }
  .viewer-layout > .stage {
    grid-area: slide;
  }
  .viewer-layout > .viewer-head {
    grid-area: title;
  }
  .viewer-side > .viewer-author {
    grid-area: author;
  }
  .viewer-side > .viewer-description {
    grid-area: desc;
  }
  .viewer-side > .related-links {
    grid-area: links;
  }
  .viewer-side > [data-reader-lists='cites'] {
    grid-area: cites;
  }
  .viewer-side > [data-reader-lists='cited-by'] {
    grid-area: citedby;
  }
  .viewer-layout > .viewer-article {
    grid-area: article;
  }
  /* A grid item is not a block: keep the long words inside the column. */
  .viewer-layout > *,
  .viewer-side > * {
    min-width: 0;
  }
  /* The layout button: the chosen layout's icon and a small arrow. */
  .layout-menu {
    position: relative;
  }
  .layout-menu[hidden] {
    display: none;
  }
  .layout-toggle {
    gap: 6px;
    padding: 0 14px;
  }
  .layout-toggle .layout-icon {
    display: none;
  }
  .viewer-layout[data-layout='stack'] .layout-toggle [data-layout-icon='stack'],
  .viewer-layout[data-layout='side'] .layout-toggle [data-layout-icon='side'],
  .viewer-layout[data-layout='wide'] .layout-toggle [data-layout-icon='wide'] {
    display: block;
  }
  .layout-items {
    position: absolute;
    right: 0;
    top: 48px;
    z-index: 10;
    display: flex;
    flex-direction: column;
    gap: 2px;
    box-sizing: border-box;
    width: 200px;
    max-width: calc(100vw - 32px);
    padding: 6px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--card);
    box-shadow: var(--shadow-menu);
  }
  .layout-items[hidden] {
    display: none;
  }
  .layout-items button {
    display: flex;
    align-items: center;
    gap: 12px;
    box-sizing: border-box;
    width: 100%;
    min-height: 44px;
    padding: 8px 12px;
    border: 0;
    border-radius: var(--radius-sm);
    background: none;
    color: inherit;
    font: inherit;
    font-size: 14px;
    font-weight: 700;
    text-align: left;
    cursor: pointer;
  }
  .layout-items button:hover,
  .layout-items button:focus-visible,
  .layout-items button[aria-checked='true'] {
    background: var(--secondary);
  }
  .layout-items .layout-icon {
    flex: none;
  }
  .layout-items .layout-name {
    flex: 1 1 auto;
    min-width: 0;
  }
  .layout-items .layout-mark {
    flex: none;
    width: 18px;
    text-align: center;
    visibility: hidden;
  }
  .layout-items button[aria-checked='true'] .layout-mark {
    visibility: visible;
  }
  /* Side by side, and wide: the author's side stays in view beside the article. */
  @media (min-width: 761px) {
    .viewer-layout[data-layout='side'],
    .viewer-layout[data-layout='wide'] {
      grid-template-columns: minmax(0, 2fr) minmax(280px, 1fr);
      grid-template-rows: auto auto 1fr;
      grid-template-areas:
        'slide side'
        'title side'
        'article side';
      column-gap: 32px;
    }
    .viewer-layout[data-layout='wide'] {
      grid-template-areas:
        'slide slide'
        'title side'
        'article side';
    }
    .viewer-layout[data-layout='side'] .viewer-side,
    .viewer-layout[data-layout='wide'] .viewer-side {
      display: block;
      grid-area: side;
      align-self: start;
      position: sticky;
      top: 16px;
      margin-top: 16px;
      max-height: calc(100vh - 32px);
      max-height: calc(100dvh - 32px);
      overflow-y: auto;
    }
    .viewer-layout[data-layout='side'] .viewer-side {
      margin-top: 0;
    }
    .viewer-layout .viewer-side > .viewer-author {
      margin-top: 0;
    }
    .viewer-layout[data-layout='side'] > .viewer-article,
    .viewer-layout[data-layout='wide'] > .viewer-article {
      margin-top: 8px;
    }
    .viewer-layout .viewer-side h2 {
      font-size: 18px;
    }
    .viewer-layout .viewer-side > .related-links {
      margin-top: 24px;
    }
    .viewer-layout .viewer-side .citations h2 {
      margin-top: 32px;
    }
    .viewer-layout .viewer-side .deck-grid-4 {
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 16px;
    }
    /* The page is as wide as the layout needs, not the 960px of the rest. */
    main:has(.viewer-layout[data-layout='side']) {
      max-width: 1280px;
    }
    main:has(.viewer-layout[data-layout='wide']) {
      --gutter: max(16px, calc((100vw - 1248px) / 2));
      max-width: none;
      padding-inline: 0;
    }
    main:has(.viewer-layout[data-layout='wide']) .viewer-notice {
      margin-inline: var(--gutter);
    }
    /* The slides span the screen: no margin at the sides, square corners. */
    .viewer-layout[data-layout='wide'] {
      padding-inline: var(--gutter);
    }
    .viewer-layout[data-layout='wide'] > .stage {
      margin: -24px calc(-1 * var(--gutter)) 0;
    }
    .viewer-notice ~ .viewer-layout[data-layout='wide'] > .stage {
      margin-top: 0;
    }
    .viewer-layout[data-layout='wide'] .stage > iframe {
      border-radius: 0;
    }
  }
  /* There is no room for a choice on a narrow screen. */
  @media (max-width: 760px) {
    .layout-menu {
      display: none;
    }
  }
  @media (max-width: 599px) {
    .page.viewer {
      padding-top: 0;
    }
    /* With no top padding, the notice would touch the header. */
    .viewer-notice {
      margin-top: 16px;
    }
    /* The stage runs edge to edge, so its corners are square. */
    .stage {
      margin: 0 -16px;
    }
    .stage > iframe {
      border-radius: 0;
    }
    /*
     * The actions sit in a row of their own, from the left edge. A menu
     * hangs from that row, not from its button, so it stays on the screen.
     */
    .viewer-actions {
      position: relative;
      flex-basis: 100%;
    }
    .action-menu {
      position: static;
    }
    .action-menu .menu-items {
      top: calc(100% + 4px);
      right: auto;
      left: 0;
      box-sizing: border-box;
      max-width: 100%;
    }
    /* A long item wraps instead of widening the menu past the screen. */
    .action-menu .menu-items a,
    .action-menu .menu-items button {
      white-space: normal;
    }
    .action-menu .mute-item {
      white-space: normal;
    }
  }
</style>`
