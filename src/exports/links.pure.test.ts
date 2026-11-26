import { describe, expect, it } from 'vitest'
import {
  ACCOUNT_EXPORT_PATH,
  accountDownloadLinks,
  slideDownloadLinks,
  slideExportPath,
} from './links'
import type { ExportVersions } from './versions'

const version = { deploymentId: 'x', readyAt: 1, order: 1 }
const none: ExportVersions = { published: null, prepared: null }

describe('slideDownloadLinks', () => {
  it('F35-AC4: Given a published version and a prepared one, When links are made in Japanese, Then both zips come first in that order, with the information last', () => {
    const links = slideDownloadLinks(
      {
        slug: 'talk',
        versions: { published: version, prepared: version },
        hasArticle: true,
      },
      'ja',
    )
    expect(links.map((link) => link.label)).toEqual([
      '公開中の版(zip)',
      '準備済みの版(zip)',
      '記事(Markdown)',
      'スライドの情報(JSON)',
    ])
    expect(links.map((link) => link.href)).toEqual([
      '/my/slides/talk/export/published.zip',
      '/my/slides/talk/export/prepared.zip',
      '/my/slides/talk/export/article.md',
      '/my/slides/talk/export/slide.json',
    ])
  })

  it('F35-AC4: Given no prepared version, When links are made, Then there is no prepared link', () => {
    const links = slideDownloadLinks(
      {
        slug: 'talk',
        versions: { published: version, prepared: null },
        hasArticle: false,
      },
      'en',
    )
    expect(links.map((link) => link.label)).toEqual([
      'Published version (zip)',
      'Slide information (JSON)',
    ])
  })

  it('F35-AC11: Given no article, When links are made, Then there is no article link', () => {
    const links = slideDownloadLinks(
      { slug: 'talk', versions: none, hasArticle: false },
      'ja',
    )
    expect(links.map((link) => link.href)).toEqual([
      '/my/slides/talk/export/slide.json',
    ])
  })

  it('F35-AC5: Given any slide, When links are made, Then no link names a past version', () => {
    const links = slideDownloadLinks(
      {
        slug: 'talk',
        versions: { published: version, prepared: version },
        hasArticle: true,
      },
      'en',
    )
    for (const { href } of links)
      expect(href).toMatch(
        /\/export\/(published\.zip|prepared\.zip|article\.md|slide\.json)$/,
      )
  })

  it('Given a slug with characters a path reads specially, When the path is made, Then they are encoded', () => {
    expect(slideExportPath('a/b?c', 'slide.json')).toBe(
      '/my/slides/a%2Fb%3Fc/export/slide.json',
    )
  })
})

describe('accountDownloadLinks', () => {
  it('F35-AC17: Given no uploaded picture, When links are made, Then only the account information is offered', () => {
    expect(accountDownloadLinks({ hasPicture: false }, 'ja')).toEqual([
      { label: 'アカウントの情報(JSON)', href: ACCOUNT_EXPORT_PATH },
    ])
  })

  it('F35-AC17: Given an uploaded picture, When links are made, Then the picture follows', () => {
    expect(
      accountDownloadLinks({ hasPicture: true }, 'en').map((l) => l.label),
    ).toEqual(['Account information (JSON)', 'Profile picture'])
  })
})
