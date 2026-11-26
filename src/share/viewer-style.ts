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
  /* The link from the band of a stored version to the help: tall enough to press. */
  .viewer-notice-help {
    display: inline-flex;
    align-items: center;
    min-height: 44px;
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
  /* Slides that are not run (an article preview of slides not yet public). */
  .stage > .deck-cover {
    margin: 0;
    max-height: calc(100dvh - 190px);
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
  /*
   * The events under the title, one line each: the community's logo, the
   * event, "presented at", the community. The logo's own rules live with the
   * community pages, so the few it needs here are repeated.
   */
  .viewer-events {
    list-style: none;
    margin: 8px 0 0;
    padding: 0;
    font-size: 14px;
  }
  .viewer-event {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px 8px;
    min-height: 32px;
    overflow-wrap: anywhere;
  }
  .viewer-event-name {
    font-weight: 700;
  }
  .viewer-event-dot {
    color: var(--muted-foreground);
  }
  .viewer-event .community-logo {
    display: grid;
    place-items: center;
    flex: none;
    box-sizing: border-box;
    width: 28px;
    height: 28px;
    border-radius: 22%;
    font-size: 14px;
    font-weight: 700;
    line-height: 1;
    object-fit: cover;
    overflow: hidden;
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
  /*
   * The other talks of the same event and community, under the whole
   * layout: the heading with the way to the whole beside it, then the cards.
   */
  .viewer-talks-head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 0 16px;
    margin: 56px 0 16px;
  }
  .viewer-talks-head h2 {
    margin: 0;
    font-size: 24px;
    font-weight: 700;
    line-height: 1.4;
    overflow-wrap: anywhere;
  }
  .viewer-talks-head a {
    display: inline-flex;
    align-items: center;
    min-height: 44px;
    font-size: 14px;
  }
  .citations-more {
    margin: 16px 0 0;
    color: var(--muted-foreground);
    font-size: 14px;
  }
  /*
   * Where the parts go. The markup has one order: slide, title and actions,
   * the side (author, description, related links, citations), then the
   * article. On a screen 760px wide or narrower the stack takes the side's
   * parts one by one and puts the article before the citations.
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
  /*
   * Wider than 760px: the wide layout, at most 1600px across and centered.
   * The slides span that width with square corners; under them the title
   * and the article stand on the left, and the side (author, description,
   * related links, citations) stays in view on the right. With nothing for
   * the side but the author (data-side="false"), there is no column: the
   * title, the author and the article stand in one centered column of the
   * article's own reading width.
   */
  @media (min-width: 761px) {
    main:has(.viewer-layout) {
      max-width: 1600px;
      padding-inline: 0;
    }
    main:has(.viewer-layout) .viewer-notice,
    main:has(.viewer-layout) .viewer-talks {
      margin-inline: 32px;
    }
    .viewer-layout {
      padding-inline: 32px;
      column-gap: 32px;
    }
    .viewer-layout > .stage {
      margin: -24px -32px 0;
    }
    .viewer-notice ~ .viewer-layout > .stage {
      margin-top: 0;
    }
    .viewer-layout .stage > iframe {
      border-radius: 0;
    }
    .viewer-layout[data-side='true'] {
      grid-template-columns: minmax(0, 2fr) minmax(280px, 1fr);
      grid-template-rows: auto auto 1fr;
      grid-template-areas:
        'slide slide'
        'title side'
        'article side';
    }
    .viewer-layout[data-side='true'] .viewer-side {
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
    .viewer-layout[data-side='true'] > .viewer-article {
      margin-top: 8px;
    }
    .viewer-layout[data-side='true'] .viewer-side > .viewer-author {
      margin-top: 0;
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
    /* Beside the article, the side holds one card across, as wide as the column. */
    .viewer-layout .viewer-side .deck-grid-4 {
      grid-template-columns: minmax(0, 1fr);
      gap: 16px;
    }
    /* No side: one centered column, as wide as the article reads. */
    .viewer-layout[data-side='false'] {
      grid-template-columns: minmax(0, 1fr);
      grid-template-areas:
        'slide'
        'title'
        'author'
        'article';
    }
    .viewer-layout[data-side='false'] > :not(.stage),
    .viewer-layout[data-side='false'] .viewer-side > .viewer-author {
      justify-self: center;
      width: 100%;
      max-width: 44em;
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
