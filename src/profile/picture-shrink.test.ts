import { describe, expect, test } from 'vitest'
import { imagesShrinker } from './picture-client'

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
