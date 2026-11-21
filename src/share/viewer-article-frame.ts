import {
  viewerArticleSection,
  type ViewerArticle,
} from '../articles/viewer-article'
import type { Lang } from '../site/i18n'

/**
 * Where the viewer shows a deck's article, under the related links and above
 * the citations. With nothing to show it holds nothing at all, heading and
 * white space included. The section itself is the article work's
 * (`src/articles/viewer-article.ts`).
 */
export const viewerArticleFrame = (article: ViewerArticle | null, lang: Lang) =>
  viewerArticleSection(article, lang)
