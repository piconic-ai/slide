import { findArticle, type Catalog } from '../help/catalog'
import { HELP_PATH, helpArticlePath } from '../help/paths'

/**
 * Where the help's article on maintenance, "「メンテナンス中です」と出たとき",
 * has to be: the aim "安全と規約" (`safety`) and this slug. Work H2 writes it;
 * the band reaches it under this name.
 */
export const MAINTENANCE_ARTICLE = {
  aim: 'safety',
  slug: 'maintenance',
} as const

/**
 * The page the band links to (F38-AC2): the article on maintenance, or, while
 * the help has no such article, the help's entrance, so that the band never
 * leads to a page that is not there.
 */
export const maintenanceHelpPath = (catalog: Catalog): string =>
  findArticle(catalog, MAINTENANCE_ARTICLE.aim, MAINTENANCE_ARTICLE.slug)
    ? helpArticlePath(MAINTENANCE_ARTICLE.aim, MAINTENANCE_ARTICLE.slug)
    : HELP_PATH
