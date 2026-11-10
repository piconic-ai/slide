import { expect, test } from 'vitest'
import { japaneseOutside } from './test-japanese'

test.each([
  ['<p>Hello</p>', []],
  ['<p>こんにちは</p>', ['こんにちは']],
  ['<p lang="ja">日本語</p><p>English</p>', []],
  ['<div lang="ja"><p>入れ子<b>太字</b></p></div><p>残り</p>', ['残り']],
  ['<p lang="ja">日本語</p>後ろ', ['後ろ']],
  ['<input aria-label="共有 URL" />', ['共有 URL']],
  ["<button title='コピー'>Copy</button>", ['コピー']],
  ['<script>const a = "日本語"</script><style>/* 日本 */</style>', []],
  ['<!-- コメント --><br><p>OK</p>', []],
  ['<p lang="en">英語のはず</p>', ['英語のはず']],
] as const)('Given %s, Then the Japanese shown is %j', (page, expected) => {
  expect(japaneseOutside(page)).toEqual(expected)
})
