import { chromium } from 'playwright'
import { signInAsOwner } from './.agents/skills/verify-slide/owner.mjs'
const origin = 'http://localhost:8873'
const E = process.env.EVIDENCE
const browser = await chromium.launch()
const owner = await browser.newContext({ locale: 'ja-JP' })
await signInAsOwner(owner, origin, process.env.COOKIE)
const page = await owner.newPage()
const out = {}
for (const [url, title] of [
  ['https://lu.ma/abc123?tk=SECRETTOKEN&utm_source=x', 'イベントのページ'],
  ['https://example.com/talk/?utm_source=twitter&fbclid=abc&page=2#top', ''],
  [`https://example.com/${'very-long-path-segment-'.repeat(8)}end?q=${'v'.repeat(60)}`, '長い URL'],
  ['https://slide.community@evil.example/', ''],
]) {
  await page.goto(`${origin}/slides/try-static#links`)
  await page.locator('#link-url').fill(url)
  if (title) await page.locator('#link-title').fill(title)
  await page.getByRole('button', { name: '追加する' }).click()
  await page.waitForLoadState('networkidle')
  out[url] = page.url()
}
await page.screenshot({ path: `${E}/manage-links.png`, fullPage: true })
// The article, written in the editor and published.
await page.goto(`${origin}/slides/try-static/article`)
await page.locator('textarea').first().fill(
  `外のリンク: [ブログ](https://medium.com/@a/post?source=rss&utm_medium=x) と http://example.com/old?gclid=1 と [メール](mailto:hello@example.com)\n\n共有 URL: ${origin}/@kfly8/try-static\n\nだます URL: [公式](https://slide.community@evil.example/)`,
)
await page.waitForTimeout(3000)
await page.goto(`${origin}/slides/try-static`)
await page.getByRole('button', { name: '記事を公開する' }).click()
await page.waitForLoadState('networkidle')
await owner.close()
console.log(JSON.stringify(out, null, 1))

for (const [name, viewport] of [['1280', { width: 1280, height: 900 }], ['375', { width: 375, height: 800 }]]) {
  const context = await browser.newContext({ locale: 'ja-JP', viewport })
  const reader = await context.newPage()
  const violations = []
  reader.on('console', (m) => { if (/Content Security Policy|CSP/i.test(m.text())) violations.push(m.text()) })
  await reader.goto(`${origin}/@kfly8/try-static`)
  const hrefs = await reader.locator('a.related-link').evaluateAll((as) => as.map((a) => a.getAttribute('href')))
  const article = await reader.locator('[data-viewer-article] a').evaluateAll((as) => as.map((a) => [a.textContent, a.getAttribute('href'), a.hasAttribute('data-link-check')]))
  const html = await reader.content()
  console.log(name, JSON.stringify({ hrefs, article, tk: html.includes('SECRETTOKEN'), utm: html.includes('utm_'), evilLink: /href="[^"]*evil/.test(html) }))
  await reader.locator('a.related-link').nth(2).click()
  await reader.locator('.link-check').waitFor()
  await reader.screenshot({ path: `${E}/check-related-${name}.png` })
  const box = await reader.locator('.link-check-panel').boundingBox()
  console.log(name, 'panel', JSON.stringify(box), 'scrollWidth', await reader.evaluate(() => document.documentElement.scrollWidth), 'url', await reader.locator('[data-link-check-url]').textContent())
  await reader.keyboard.press('Escape')
  await reader.locator('[data-viewer-article] a', { hasText: 'ブログ' }).click()
  await reader.locator('.link-check').waitFor()
  await reader.screenshot({ path: `${E}/check-article-${name}.png` })
  console.log(name, 'article url', await reader.locator('[data-link-check-url]').textContent())
  await reader.getByRole('button', { name: 'キャンセル' }).click()
  console.log(name, 'violations', JSON.stringify(violations), 'url after', reader.url())
  await context.close()
}
await browser.close()
