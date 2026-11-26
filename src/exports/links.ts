// The addresses and labels of what a person can take out (02-PAGES 08, 09). Pure.
import type { DownloadLink } from '../site/download-links'
import { messages, type Lang } from '../site/i18n'
import type { ExportRole, ExportVersions } from './versions'

/** The slide's own slug: lowercase letters, digits and hyphens only. */
export const slideExportPath = (
  slug: string,
  file: `${ExportRole}.zip` | 'article.md' | 'slide.json',
) => `/my/slides/${encodeURIComponent(slug)}/export/${file}`

export const ACCOUNT_EXPORT_PATH = '/account/export/account.json'
export const PICTURE_EXPORT_PATH = '/account/export/picture'

const text = messages({
  ja: {
    published: '公開中の版(zip)',
    prepared: '準備済みの版(zip)',
    article: '記事(Markdown)',
    info: 'スライドの情報(JSON)',
    account: 'アカウントの情報(JSON)',
    picture: 'プロフィール画像',
  },
  en: {
    published: 'Published version (zip)',
    prepared: 'Prepared version (zip)',
    article: 'Article (Markdown)',
    info: 'Slide information (JSON)',
    account: 'Account information (JSON)',
    picture: 'Profile picture',
  },
})

/**
 * What one slide offers: the published version, the prepared one and the
 * article only when there are any, and always its information. Past versions
 * are never linked.
 */
export function slideDownloadLinks(
  input: Readonly<{
    slug: string
    versions: ExportVersions
    hasArticle: boolean
  }>,
  lang: Lang,
): readonly DownloadLink[] {
  const t = text[lang]
  const link = (label: string, href: string): DownloadLink => ({ label, href })
  return [
    ...(input.versions.published
      ? [link(t.published, slideExportPath(input.slug, 'published.zip'))]
      : []),
    ...(input.versions.prepared
      ? [link(t.prepared, slideExportPath(input.slug, 'prepared.zip'))]
      : []),
    ...(input.hasArticle
      ? [link(t.article, slideExportPath(input.slug, 'article.md'))]
      : []),
    link(t.info, slideExportPath(input.slug, 'slide.json')),
  ]
}

/** What the account offers: its information, and the picture when there is one. */
export function accountDownloadLinks(
  input: Readonly<{ hasPicture: boolean }>,
  lang: Lang,
): readonly DownloadLink[] {
  const t = text[lang]
  return [
    { label: t.account, href: ACCOUNT_EXPORT_PATH },
    ...(input.hasPicture
      ? [{ label: t.picture, href: PICTURE_EXPORT_PATH }]
      : []),
  ]
}
