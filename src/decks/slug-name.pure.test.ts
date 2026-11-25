import { describe, expect, it } from 'vitest'
import { deckSlugSchema } from './deck-id'
import {
  chosenSlug,
  freeSlug,
  isReservedSlug,
  parseSlugNotice,
  SLUG_NOTICES,
  slugBase,
  slugOf,
} from './slug-name'

const slug = (text: string) => deckSlugSchema.parse(text)

describe('slugOf', () => {
  it.each([
    ['My Talk', 'my-talk'],
    ['  Testing BarefootJS: six ways!  ', 'testing-barefootjs-six-ways'],
    ['ＡＢＣ１２３', 'abc123'],
    ['a___b', 'a-b'],
    ['--a--', 'a'],
    ['2026', '2026'],
    ['Slide の最初のスライド', 'slide'],
    ['<script>alert(1)</script>', 'script-alert-1-script'],
    ['../../etc/passwd', 'etc-passwd'],
    ['Café', 'caf'],
  ])('Given %j, When spelled as a slug, Then it is %j', (text, expected) => {
    expect(slugOf(text)).toBe(expected)
  })

  it.each([['日本語だけの題名'], [''], ['   '], ['---'], ['😀🎉'], ['\u0000']])(
    'Given %j, When spelled as a slug, Then nothing is left',
    (text) => {
      expect(slugOf(text)).toBeNull()
    },
  )

  it('Given a long title, When spelled as a slug, Then it is cut to 64 characters without a hyphen at the end', () => {
    const spelled = slugOf(`${'a'.repeat(63)} ${'b'.repeat(40)}`)

    expect(spelled).toBe('a'.repeat(63))
    expect(slugOf('x'.repeat(200))).toHaveLength(64)
  })
})

describe('slugBase', () => {
  it.each([
    [{ title: 'My Talk', fileName: 'deck.html' }, 'my-talk'],
    [
      { title: '日本語の題名', fileName: 'RubyKaigi 2026.zip' },
      'rubykaigi-2026',
    ],
    [{ title: '', fileName: 'index.html' }, 'index'],
    [{ title: null, fileName: 'talk.v2.html' }, 'talk-v2'],
    [{ fileName: 'C:\\Users\\me\\Desktop\\talk.html' }, 'talk'],
    [{ fileName: 'folder/sub/deck.zip' }, 'deck'],
    [{ title: '発表', fileName: '発表.html' }, 'slide'],
    [{ title: '   ', fileName: '.html' }, 'slide'],
    [{}, 'slide'],
  ])(
    'F22-AC13: Given the name %j, When the slug to start from is chosen, Then it is %j',
    (name, expected) => {
      expect(slugBase(name)).toBe(expected)
    },
  )
})

describe('freeSlug', () => {
  it('F22-AC13: Given a name the author does not use, When a free slug is picked, Then it is the name itself', () => {
    expect(freeSlug(slug('talk'), new Set(['other']))).toBe('talk')
  })

  it('F22-AC13: Given the author already has the name and its second, When a free slug is picked, Then it is the third', () => {
    expect(freeSlug(slug('talk'), new Set(['talk', 'talk-2']))).toBe('talk-3')
  })

  it.each(['following', 'followers', 'citing', 'cited', 'new', 'connect'])(
    'F21-AC20, F24-AC35: Given a slide whose name spells %j, When a free slug is picked, Then it gets -2 and never the reserved name',
    (reserved) => {
      expect(freeSlug(slug(reserved), new Set())).toBe(`${reserved}-2`)
      expect(freeSlug(slug(reserved), new Set([`${reserved}-2`]))).toBe(
        `${reserved}-3`,
      )
    },
  )

  it('Given a taken name of 64 characters, When a free slug is picked, Then the name is cut so the number still fits', () => {
    const long = slug('a'.repeat(64))

    const picked = freeSlug(long, new Set([long]))

    expect(picked).toBe(`${'a'.repeat(62)}-2`)
    expect(picked).toHaveLength(64)
  })

  it('Given cutting leaves a hyphen before the number, When a free slug is picked, Then the slug is still valid', () => {
    const base = slug(`${'a'.repeat(61)}-bb`)

    const picked = freeSlug(base, new Set([base]))

    expect(picked).toBe(`${'a'.repeat(61)}-2`)
    expect(deckSlugSchema.safeParse(picked).success).toBe(true)
  })

  it('Given many slides of one name, When a free slug is picked, Then the first unused number is taken', () => {
    const taken = new Set(['talk'])
    for (let number = 2; number <= 20; number++) taken.add(`talk-${number}`)

    expect(freeSlug(slug('talk'), taken)).toBe('talk-21')
  })
})

describe('chosenSlug', () => {
  it.each(['talk', 'my-talk-2026', 'a', '  talk  '])(
    'Given the author types %j, When checked, Then it is accepted as typed',
    (input) => {
      expect(chosenSlug(input)).toEqual({ ok: true, slug: input.trim() })
    },
  )

  it.each(['following', 'followers', 'citing', 'cited', 'new', 'connect'])(
    'F21-AC20, F24-AC35: Given the author types %j, When checked, Then it is refused as reserved and nothing is added to it',
    (input) => {
      expect(chosenSlug(input)).toEqual({ ok: false, reason: 'reserved' })
    },
  )

  it.each([
    '',
    '   ',
    'My Talk',
    'talk_1',
    '-talk',
    'talk-',
    '日本語',
    'a'.repeat(65),
    'talk/../x',
    '<b>',
  ])(
    'Given the author types %j, When checked, Then it is refused as invalid',
    (input) => {
      expect(chosenSlug(input)).toEqual({ ok: false, reason: 'invalid' })
    },
  )

  it('Given names that only look reserved, When asked, Then they are not', () => {
    expect(isReservedSlug('following-2')).toBe(false)
    expect(isReservedSlug('Following')).toBe(false)
    expect(isReservedSlug('news')).toBe(false)
  })
})

describe('parseSlugNotice', () => {
  it.each(SLUG_NOTICES)(
    'Given %j, When read, Then it is that notice',
    (notice) => {
      expect(parseSlugNotice(notice)).toBe(notice)
    },
  )

  it.each([undefined, '', 'Renamed', 'applied', '<script>', ['renamed'], 1])(
    'Given %j, When read, Then it is no notice',
    (value) => {
      expect(parseSlugNotice(value)).toBeNull()
    },
  )
})
