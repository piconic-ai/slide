import { html } from 'hono/html'

/**
 * What only the viewer needs on top of the shared page styles: the stage
 * the slides run in, and the rows under it.
 */
export const viewerStyle = html`<style>
  main.viewer {
    padding-top: 24px;
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
  .viewer-author a[data-follow-handle] {
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
  @media (max-width: 599px) {
    main.viewer {
      padding-top: 0;
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
    .action-menu .menu-items a,
    .action-menu .menu-items button,
    .action-menu .mute-item {
      white-space: normal;
    }
  }
</style>`
