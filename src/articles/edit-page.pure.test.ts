import { expect, test } from 'vitest'
import { editBody } from './edit-page'

test('F26-AC23: Given a page past the version’s last page and a known count, When the editing page is drawn, Then it names the URL and the last page', () => {
  const page = String(
    editBody(
      {
        slug: 'talk',
        deckName: 'Talk',
        article: null,
        body: '',
        revision: null,
        pane: null,
        notice: null,
        missing: [{ handle: 'owner', slug: 'talk', page: 14 }],
        pageCount: 12,
      },
      'ja',
    ),
  )
  expect(page).toContain(
    '/@owner/talk/14 のページは、いまの版にありません(12 ページまで)。',
  )
  expect(page).toContain(
    '読者には、ページの画像の代わりにふつうのリンクが出ます。',
  )
})
