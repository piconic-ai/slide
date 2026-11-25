import { describe, expect, it } from 'vitest'
import { prepareTextFiles } from './files'

describe('prepareTextFiles', () => {
  it('Given a refused path beside content made to be slow to read, When the files are prepared, Then the path is refused before the content is looked at', async () => {
    const started = performance.now()
    const result = await prepareTextFiles([
      { path: 'index.html', text: '<!---->'.repeat(100000) + 'x' },
      { path: '../x.html', text: '<!---->'.repeat(40000) + 'x' },
    ])
    expect(result).toMatchObject({ ok: false, error: 'invalid_files' })
    expect(performance.now() - started).toBeLessThan(1000)
  })
})
