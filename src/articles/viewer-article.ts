import { html, raw } from 'hono/html'
import { messages, type Lang } from '../site/i18n'
import { articleStyle } from './article-style'
import type { ArticleStatus } from './article'

const text = messages({
  ja: { heading: '記事', draft: '下書き' },
  en: { heading: 'Article', draft: 'Draft' },
})

/** An article, ready for the viewer: its HTML and its state. */
export type ViewerArticle = Readonly<{
  /** The HTML `renderArticle` made, the only HTML an article is shown as. */
  html: string
  status: ArticleStatus
}>

/**
 * The viewer's article, under the related links and above the citations. A
 * draft is shown to its author alone, who sees the tag "Draft" beside the
 * heading, and otherwise it looks as readers see it. An article with nothing
 * in it holds nothing at all: no heading, no white space.
 */
export const viewerArticleSection = (
  article: ViewerArticle | null,
  lang: Lang,
) =>
  article === null || article.html.trim() === ''
    ? ''
    : html`${articleStyle}
        <section class="viewer-article" data-viewer-article>
          <div class="viewer-article-head">
            <h2 id="article">${text[lang].heading}</h2>
            ${
              article.status === 'draft'
                ? html`<span class="status-chip status-draft"
                    >${text[lang].draft}</span
                  >`
                : ''
            }
          </div>
          <div class="article-text">${raw(article.html)}</div>
          <style>
            .viewer-article {
              margin: 32px 0 0;
            }
            .viewer-article-head {
              display: flex;
              flex-wrap: wrap;
              align-items: center;
              gap: 12px;
              margin: 0 0 16px;
            }
            .viewer-article-head h2 {
              margin: 0;
            }
            .viewer-article-head .status-chip {
              margin: 0;
            }
          </style>
        </section>`
