import { html } from 'hono/html'

/**
 * How an article reads: in the viewer under the slides, and in the editing
 * page's preview. It is long text, so reading comes first: 17px, a line 1.8
 * tall, 40em wide. Code and tables scroll inside their own box, never the
 * whole page.
 */
export const articleStyle = html`<style>
  .article-text {
    max-width: 40em;
    font-size: 17px;
    line-height: 1.8;
  }
  .article-text > * {
    margin: 0 0 1em;
  }
  .article-text h3,
  .article-text h4,
  .article-text h5,
  .article-text h6 {
    margin: 1.6em 0 0.6em;
    line-height: 1.5;
  }
  .article-text h3 {
    font-size: 18px;
  }
  .article-text h4,
  .article-text h5,
  .article-text h6 {
    font-size: 17px;
  }
  .article-text ul,
  .article-text ol,
  .article-text blockquote,
  .article-text pre,
  .article-text table {
    margin: 1em 0;
  }
  .article-text blockquote {
    padding: 0 0 0 16px;
    border-left: 3px solid var(--border);
    color: var(--muted-foreground);
  }
  .article-text blockquote > :last-child {
    margin-bottom: 0;
  }
  .article-text code {
    padding: 1px 5px;
    border-radius: 4px;
    background: var(--secondary);
    font-family: var(--font-mono);
    font-size: 0.9em;
  }
  .article-text pre {
    padding: 12px 16px;
    border-radius: var(--radius);
    background: var(--secondary);
    overflow-x: auto;
  }
  .article-text pre code {
    padding: 0;
    background: none;
    white-space: pre;
  }
  .article-text table {
    display: block;
    max-width: 100%;
    overflow-x: auto;
    border-collapse: collapse;
  }
  .article-text th,
  .article-text td {
    padding: 6px 12px;
    border: 1px solid var(--border);
    text-align: left;
  }
  .article-text th {
    background: var(--secondary);
  }
  /* A page of slides shown as an image: 16:9, up to 420px wide. */
  .article-embed {
    max-width: 420px;
    margin: 1em 0;
  }
  .article-embed-link {
    display: block;
    text-decoration: none;
  }
  .article-embed-link .deck-cover {
    margin-bottom: 0;
  }
  .article-embed-caption {
    margin: 6px 0 0;
    color: var(--muted-foreground);
    font-size: 13px;
    line-height: 1.6;
  }
</style>`
