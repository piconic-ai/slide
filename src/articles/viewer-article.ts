import { html, raw } from 'hono/html'
import { messages, type Lang } from '../site/i18n'
import { articleStyle } from './article-style'
import type { ArticleStatus } from './article'

const text = messages({
  ja: { label: '記事', draft: '下書き' },
  en: { label: 'Article', draft: 'Draft' },
})

/** An article, ready for the viewer: its HTML and its state. */
export type ViewerArticle = Readonly<{
  /** The HTML `renderArticle` made, the only HTML an article is shown as. */
  html: string
  status: ArticleStatus
}>

/**
 * The viewer's article, straight under the description and the related links.
 * It has no heading of its own: the article's text is what the reader came to
 * read under the slides, and its own headings start at h3. The section is
 * named for assistive technology only. A draft is shown to its author alone,
 * who sees the tag "Draft" above the text, and otherwise it looks as readers
 * see it. An article with nothing in it holds nothing at all: no tag, no
 * white space.
 */
export const showsArticle = (
  article: ViewerArticle | null,
): article is ViewerArticle => article !== null && article.html.trim() !== ''

export const viewerArticleSection = (
  article: ViewerArticle | null,
  lang: Lang,
) =>
  !showsArticle(article)
    ? ''
    : html`${articleStyle}
        <section
          class="viewer-article"
          data-viewer-article
          aria-label="${text[lang].label}"
        >
          ${
            article.status === 'draft'
              ? html`<div class="viewer-article-head">
                  <span class="status-chip status-draft"
                    >${text[lang].draft}</span
                  >
                </div>`
              : ''
          }
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
            .viewer-article-head .status-chip {
              margin: 0;
            }
          </style>
        </section>`
