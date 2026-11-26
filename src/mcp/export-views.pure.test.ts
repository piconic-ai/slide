import { describe, expect, test } from 'vitest'
import type { accountInfo } from '../exports/account-info'
import {
  exportAccountView,
  slideFilesView,
  type ListedVersion,
  type UnavailableVersion,
} from './export-views'

type Info = ReturnType<typeof accountInfo>
const slide = (urlName: string, extra: Partial<Info['slides'][number]> = {}) =>
  ({
    urlName,
    title: null,
    state: 'draft',
    hiddenByOperator: false,
    createdAt: '2026-11-01T00:00:00.000Z',
    firstPublishedAt: null,
    shareUrl: `https://slide.example/@a/${urlName}`,
    cites: ['https://slide.example/@b/theirs/3'],
    ...extra,
  }) as Info['slides'][number]

const info = (slides: Info['slides']) => ({ slides }) as unknown as Info

describe('the answer of export_account', () => {
  test('F35-AC32: Given an account file with slides, When the answer is made, Then it holds the file as it is and a short list with each slide’s name, title and state', () => {
    const file = info([
      slide('a', { title: 'A', state: 'public' }),
      slide('b', { hiddenByOperator: true }),
    ])
    const view = exportAccountView(file)
    expect(view.account).toBe(file)
    expect(view.slides).toEqual([
      { slide: 'a', title: 'A', state: 'public', hiddenByOperator: false },
      { slide: 'b', title: null, state: 'draft', hiddenByOperator: true },
    ])
  })

  test('F35-AC35: Given slides that cite other people’s slides, When the short list is made, Then it carries no address of a slide', () => {
    expect(
      JSON.stringify(exportAccountView(info([slide('a')])).slides),
    ).not.toContain('slide.example')
  })

  test('F35-AC32: Given an author with no slide, When the answer is made, Then the list is empty and the account is still there', () => {
    expect(exportAccountView(info([])).slides).toEqual([])
  })
})

describe('the answer of get_slide_files', () => {
  const version: ListedVersion = {
    status: 'listed',
    role: 'published',
    deploymentId: 'dep',
    receivedAt: 1_700_000_000,
    fileCount: 2,
    totalBytes: 30,
    files: [
      {
        path: 'index.html',
        size: 10,
        sha256: 'a'.repeat(64),
        mediaType: 'text/html; charset=utf-8',
        url: 'https://slide.example/mcp/files/x.y',
      },
    ],
  }

  test('F35-AC33: Given a listed version, When the answer is made, Then times are ISO text, the whole counts stay, and the files keep path, size, sha256 and address', () => {
    const view = slideFilesView({
      slide: 'talk',
      versions: [version],
      urlsExpireAt: 1_700_003_600,
      nextCursor: null,
      hasVersions: true,
    })
    expect(view).toMatchObject({
      slide: 'talk',
      urlsExpireAt: '2023-11-14T23:13:20.000Z',
      nextCursor: null,
      versions: [
        {
          role: 'published',
          receivedAt: '2023-11-14T22:13:20.000Z',
          fileCount: 2,
          totalBytes: 30,
          files: [{ path: 'index.html', size: 10, url: version.files[0]!.url }],
        },
      ],
    })
    expect(view.next).toContain('That is every file that can be listed')
    expect(view.next).toContain('get_article_draft')
  })

  test('F35-AC34: Given more files follow, When the answer is made, Then it says to go on with the cursor', () => {
    const view = slideFilesView({
      slide: 'talk',
      versions: [version],
      urlsExpireAt: 1,
      nextCursor: 'CURSOR',
      hasVersions: true,
    })
    expect(view.nextCursor).toBe('CURSOR')
    expect(view.next).toContain('call get_slide_files again with cursor')
    expect(view.next).not.toContain('That is every file')
  })

  test('F35-AC35: Given any answer, When its text is read, Then it tells the agent to keep the addresses secret and never to write a path outside its folder, and holds no file content', () => {
    const view = slideFilesView({
      slide: 'talk',
      versions: [version],
      urlsExpireAt: 1,
      nextCursor: null,
      hasVersions: true,
    })
    expect(view.next).toContain('secret')
    expect(view.next).toContain('“..”')
    expect(
      Object.keys(
        (view.versions[0] as unknown as ListedVersion).files[0]!,
      ).sort(),
    ).toEqual(['mediaType', 'path', 'sha256', 'size', 'url'])
  })

  test('F35-AC33: Given a version that cannot be listed beside one that can, When the answer is made, Then each says its own: the one lists its files, the other its reason and a sentence for the author', () => {
    const lost: UnavailableVersion = {
      status: 'unavailable',
      role: 'prepared',
      deploymentId: 'dep2',
      receivedAt: 1_700_000_100,
      reason: 'unsafe_path',
    }
    const view = slideFilesView({
      slide: 'talk',
      versions: [version, lost],
      urlsExpireAt: 1,
      nextCursor: null,
      hasVersions: true,
    })
    expect(view.versions[0]).toMatchObject({ status: 'listed' })
    expect(view.versions[1]).toMatchObject({
      status: 'unavailable',
      role: 'prepared',
      reason: 'unsafe_path',
      message: expect.stringContaining('not safe to write'),
      receivedAt: '2023-11-14T22:15:00.000Z',
    })
    expect(view.versions[1]).not.toHaveProperty('files')
    expect(view.next).toContain('status unavailable')
  })

  test('F35-AC33: Given a slide with no version, When the answer is made, Then it lists none and says so', () => {
    const view = slideFilesView({
      slide: 'talk',
      versions: [],
      urlsExpireAt: 1,
      nextCursor: null,
      hasVersions: false,
    })
    expect(view.versions).toEqual([])
    expect(view.next).toContain('no version to export')
  })
})
