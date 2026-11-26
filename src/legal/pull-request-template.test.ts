import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'

const template = readFileSync(
  new URL('../../.github/pull_request_template.md', import.meta.url),
  'utf8',
)

test('F34-AC28: Given the pull request template, When it is read, Then it asks whether the change touches what the privacy policy and the page of destinations say, in the words decided', () => {
  expect(template).toContain(
    'この変更は、利用者の情報を新しく集める、新しい相手に送る、保存の期間を変える、のどれかに当たるか。当たるなら、プライバシーポリシーと『外部への送信』のページを直すことを依頼者に伝えたか。',
  )
})

test('F34-AC28: Given the pull request template, When it is read, Then the question is one section with a box to tick for each answer, and the sections it had are all still there', () => {
  expect(template.match(/^## 利用者の情報への影響$/gmu)).toHaveLength(1)
  expect(template).toContain('- [ ] 当たらない')
  expect(template).toContain('- [ ] 当たる。')
  for (const heading of [
    '変更',
    '満たした受け入れ条件',
    '確認',
    '確かめていないこと',
    '人の確認',
  ])
    expect(template).toContain(`## ${heading}\n`)
})
