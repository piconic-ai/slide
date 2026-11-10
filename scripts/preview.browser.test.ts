import { expect, test } from 'vitest'
import { chromium } from 'playwright'
import { statusPage } from '../src/uploads/status-page'

test('preview runs inline slides while blocking resource requests and parent access', async () => {
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage()
    const requests: string[] = []
    const authorHtml = `<!doctype html><html><head>
      <link rel="stylesheet" href="/probe-relative.css">
      <link rel="stylesheet" href="https://blocked.example/probe-external.css">
      <script src="/probe-relative.js"></script>
      <script src="https://blocked.example/probe-external.js"></script>
      <style>button { color: rgb(1, 2, 3); }</style>
      </head><body>
      <img src="/probe-relative.png"><img src="https://blocked.example/probe-external.png">
      <button id="counter">0</button><p id="isolation"></p><p id="network"></p>
      <script>
        document.querySelector('#counter').onclick = (event) => event.target.textContent++;
        try { parent.document.body.dataset.touched = 'yes'; }
        catch { document.querySelector('#isolation').textContent = 'blocked'; }
        Promise.all([
          fetch('/probe-relative-fetch').catch(() => {}),
          fetch('https://blocked.example/probe-external-fetch').catch(() => {})
        ]).then(() => document.querySelector('#network').textContent = 'done');
      </script></body></html>`
    await page.route('**/*', async (route) => {
      const url = new URL(route.request().url())
      if (url.pathname === '/uploads/test') {
        await route.fulfill({
          contentType: 'text/html',
          body: statusPage('ja', ''),
        })
      } else if (url.pathname === '/api/uploads/test/content/index.html') {
        await route.fulfill({
          contentType: 'text/html',
          headers: {
            'Content-Security-Policy':
              "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data: blob:",
          },
          body: authorHtml,
        })
      } else {
        requests.push(url.href)
        await route.fulfill({ status: 200, body: '' })
      }
    })
    await page.goto('https://slide.test/uploads/test')
    await page.locator('#credential').fill('private-preview-credential')
    await page.locator('#preview').click()
    const frame = page.frameLocator('#slide-preview')
    await expect
      .poll(() => frame.locator('#network').textContent())
      .toBe('done')
    await expect
      .poll(() => frame.locator('#isolation').textContent())
      .toBe('blocked')
    await frame.locator('#counter').click()
    await expect.poll(() => frame.locator('#counter').textContent()).toBe('1')
    expect(
      await frame
        .locator('#counter')
        .evaluate((button) => getComputedStyle(button).color),
    ).toBe('rgb(1, 2, 3)')
    expect(await page.locator('body').getAttribute('data-touched')).toBeNull()
    expect(requests).toEqual([])
  } finally {
    await browser.close()
  }
}, 15000)
