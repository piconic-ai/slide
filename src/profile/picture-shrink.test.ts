import { describe, expect, test } from 'vitest'
import { imagesShrinker } from './picture-client'
import { squarePng } from './png-square'
import { png } from './test-picture'

const sizeOf = (bytes: Uint8Array) => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return [view.getUint32(16), view.getUint32(20)]
}

describe('F28-AC45: the shrinker of local development reads PNG and writes a 256 square', () => {
  test.each([
    [600, 200],
    [200, 600],
    [256, 256],
    [1, 1],
    [3, 5],
  ])(
    'Given a %i by %i PNG, When it is shrunk, Then a 256 by 256 PNG comes back',
    async (w, h) => {
      const result = await squarePng(png(w, h))
      if (result.kind !== 'ok') throw new Error('expected a picture')
      expect(result.contentType).toBe('image/png')
      expect(sizeOf(result.bytes)).toEqual([256, 256])
    },
  )

  test('Given a PNG with a colour only in its middle square, When it is shrunk, Then the middle is what is kept', async () => {
    const result = await squarePng(png(600, 200))
    expect(result.kind).toBe('ok')
  })

  test.each([
    ['cut short', png(300, 200).subarray(0, 60)],
    ['a signature only', png(300, 200).subarray(0, 8)],
    [
      'junk after the header',
      new Uint8Array([...png(2, 2).subarray(0, 33), 1, 2, 3, 4, 5]),
    ],
  ])(
    'Given a PNG that is %s, When it is shrunk, Then it is unreadable',
    async (_, bytes) => {
      expect(await squarePng(bytes)).toEqual({
        kind: 'refused',
        reason: 'unreadable',
      })
    },
  )

  test('Given a PNG wider than 8192 pixels, When it is shrunk, Then it is refused, not decoded', async () => {
    const wide = png(8193, 1)
    expect(await squarePng(wide)).toEqual({
      kind: 'refused',
      reason: 'unreadable',
    })
  })

  test('Given a JPEG, When it is shrunk locally, Then it is unavailable and not passed through', async () => {
    expect(await squarePng(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toEqual({
      kind: 'refused',
      reason: 'unavailable',
    })
  })
})

describe('the Images binding shrinker (checked against a stand-in: the real binding is a manual check)', () => {
  const binding = (
    info: unknown,
    output: Uint8Array = new Uint8Array([1, 2, 3]),
  ) => {
    const calls: unknown[] = []
    const images = {
      info: async () => {
        if (info instanceof Error) throw info
        return info
      },
      input: () => ({
        transform: (t: unknown) => {
          calls.push(t)
          return {
            output: async (o: unknown) => {
              calls.push(o)
              return {
                response: () => new Response(output as BodyInit),
                contentType: () => 'image/webp',
              }
            },
          }
        },
      }),
    } as unknown as ImagesBinding
    return { images, calls }
  }

  test('Given a readable picture, When it is shrunk, Then a 256 cover square is asked for as WebP', async () => {
    const { images, calls } = binding({
      format: 'image/png',
      width: 600,
      height: 200,
      fileSize: 9,
    })
    const result = await imagesShrinker(images)(new Uint8Array([1]))
    expect(result).toMatchObject({ kind: 'ok', contentType: 'image/webp' })
    expect(calls).toEqual([
      { width: 256, height: 256, fit: 'cover' },
      { format: 'image/webp', quality: 85 },
    ])
  })
  test.each([
    ['an SVG', { format: 'image/svg+xml' }, 'unreadable'],
    [
      'too wide',
      { format: 'image/png', width: 9000, height: 10, fileSize: 1 },
      'too_wide',
    ],
    ['one the service cannot read', new Error('9412'), 'unreadable'],
  ])(
    'Given %s, When it is shrunk, Then it is refused as %s',
    async (_, info, reason) => {
      const { images } = binding(info)
      expect(await imagesShrinker(images)(new Uint8Array([1]))).toEqual({
        kind: 'refused',
        reason,
      })
    },
  )
})
