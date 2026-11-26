/**
 * The look of the notice over the slides: a frame with a line, text and what
 * the reader may press. The viewer page and the page the viewer keeps for
 * the times it cannot be read are separate documents, so each puts this rule
 * set in its own style; they share it here so that the two cannot drift.
 */
export const viewerNoticeCss = `
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
    margin: 0 auto 0 0;
    font-weight: 700;
  }
  /* The link from the band of a stored version to the help: tall enough to press. */
  .viewer-notice-help {
    display: inline-flex;
    align-items: center;
    min-height: 44px;
    white-space: nowrap;
  }
`
