import { describe, expect, it } from 'vitest'
import { GESTURE_SOURCE } from './gesture'

type Point = { x: number; y: number; t: number }
type Node = {
  tag: string
  role: string | null
  onclick: boolean
  editable: boolean
  pointer: boolean
  scrollsX: boolean
}

// The text the page script holds, run with plain values.
const {
  gestureOf,
  tappedForItself,
  scrollsAcross,
  afterSettling,
  mayTurn,
  keyOf,
} = new Function(
  `${GESTURE_SOURCE}; return { gestureOf, tappedForItself, scrollsAcross, afterSettling, mayTurn, keyOf }`,
)() as {
  gestureOf: (
    start: Point,
    end: Point,
    width: number,
  ) => { turn: 'next' | 'prev'; tap: boolean } | null
  tappedForItself: (chain: Node[]) => boolean
  scrollsAcross: (chain: Node[]) => boolean
  afterSettling: (
    before: number,
    after: number | null,
  ) => 'send' | 'left-to-the-slides'
  mayTurn: (
    tool: object | null,
    page: number | null,
    latched: boolean,
  ) => boolean
  keyOf: (turn: 'next' | 'prev') => {
    key: string
    code: string
    keyCode: number
  }
}

const at = (x: number, y: number, t = 0): Point => ({ x, y, t })

describe('gestureOf: swipes', () => {
  it.each([
    [at(300, 200), at(200, 205, 150), 'next'],
    [at(100, 200), at(220, 190, 150), 'prev'],
    // Exactly the least distance, and just across the axis factor.
    [at(300, 200), at(260, 219, 100), 'next'],
  ])(
    'F03-AC202: Given a swipe from %j to %j, When it is read, Then it turns to %s',
    (start, end, turn) => {
      expect(gestureOf(start, end, 390)).toEqual({ turn, tap: false })
    },
  )

  it.each([
    ['one pixel short of the least distance', at(300, 200), at(261, 200)],
    ['as much up as across', at(300, 200), at(200, 300)],
    [
      'exactly twice as far up as across is not across enough',
      at(300, 200),
      at(240, 320),
    ],
    ['a vertical scroll', at(200, 400), at(205, 100)],
  ])(
    'F03-AC207: Given %s, When it is read, Then it asks for nothing',
    (_, start, end) => {
      expect(gestureOf(start, end, 390)).toBeNull()
    },
  )
})

describe('gestureOf: taps', () => {
  it.each([
    [10, 'prev'],
    [129, 'prev'],
    [261, 'next'],
    [380, 'next'],
  ])(
    'F03-AC203: Given a tap at x=%i of 390, When it is read, Then it turns to %s',
    (x, turn) => {
      expect(gestureOf(at(x, 300), at(x, 300, 80), 390)).toEqual({
        turn,
        tap: true,
      })
    },
  )

  it.each([130, 195, 260])(
    'F03-AC203: Given a tap at x=%i, in the middle third of 390, When it is read, Then it asks for nothing',
    (x) => {
      expect(gestureOf(at(x, 300), at(x, 300, 80), 390)).toBeNull()
    },
  )

  it('F03-AC203: Given a touch that lasts longer than 500ms, When it is read, Then it is no tap', () => {
    expect(gestureOf(at(10, 300), at(10, 300, 501), 390)).toBeNull()
    expect(gestureOf(at(10, 300), at(10, 300, 500), 390)).toEqual({
      turn: 'prev',
      tap: true,
    })
  })

  it('F03-AC203: Given a touch that moves 10px, When it is read, Then it is neither a tap nor a swipe', () => {
    expect(gestureOf(at(10, 300), at(20, 300, 80), 390)).toBeNull()
    expect(gestureOf(at(10, 300), at(10, 310, 80), 390)).toBeNull()
    expect(gestureOf(at(10, 300), at(19, 309, 80), 390)).toEqual({
      turn: 'prev',
      tap: true,
    })
  })

  it('F03-AC203: Given a frame with no width, When a tap is read, Then it asks for nothing', () => {
    expect(gestureOf(at(0, 0), at(0, 0, 10), 0)).toBeNull()
  })
})

const node = (tag: string, more: Partial<Node> = {}): Node => ({
  tag,
  role: null,
  onclick: false,
  editable: false,
  pointer: false,
  scrollsX: false,
  ...more,
})

describe('tappedForItself', () => {
  it.each([
    ['a link', [node('a')]],
    ['a button', [node('button')]],
    ['a span inside a link', [node('span'), node('a'), node('body')]],
    ['a field', [node('input')]],
    ['a video', [node('video')]],
    ['a role=button', [node('div', { role: 'button' })]],
    ['an onclick', [node('div', { onclick: true })]],
    ['an editable', [node('div', { editable: true })]],
    ['a pointer cursor', [node('div', { pointer: true })]],
  ])(
    'F03-AC206: Given a tap on %s, When it is asked, Then it is the slides’ own',
    (_, chain) => {
      expect(tappedForItself(chain)).toBe(true)
    },
  )

  it.each([
    ['plain text', [node('p'), node('section'), node('body')]],
    ['no chain', []],
  ])(
    'F03-AC206: Given a tap on %s, When it is asked, Then it is not',
    (_, chain) => {
      expect(tappedForItself(chain)).toBe(false)
    },
  )
})

describe('scrollsAcross', () => {
  it('F03-AC207: Given a swipe that begins inside something that scrolls sideways, When it is asked, Then it is meant for that', () => {
    expect(
      scrollsAcross([
        node('code'),
        node('pre', { scrollsX: true }),
        node('body'),
      ]),
    ).toBe(true)
  })

  it.each([
    ['no chain', []],
    ['nothing that scrolls sideways', [node('p'), node('body')]],
  ])('F03-AC207: Given %s, When it is asked, Then it is not', (_, chain) => {
    expect(scrollsAcross(chain)).toBe(false)
  })
})

describe('afterSettling', () => {
  it('F03-AC205: Given the page is as it was, When the time is up, Then the key is sent', () => {
    expect(afterSettling(3, 3)).toBe('send')
  })

  it.each([4, 2, null])(
    'F03-AC205: Given the slides turned the page to %s themselves, When the time is up, Then nothing is sent',
    (after) => {
      expect(afterSettling(3, after)).toBe('left-to-the-slides')
    },
  )
})

describe('mayTurn', () => {
  it('F03-AC202: Given known page, no tool and no latch, When asked, Then it may turn', () => {
    expect(mayTurn(null, 1, false)).toBe(true)
  })

  it.each([
    ['a tool with its own touch (F03-AC208)', {}, 3, false],
    ['no known page (F03-AC208)', null, null, false],
    ['slides that turned the page themselves (F03-AC205)', null, 3, true],
  ])(
    'F03-AC205, F03-AC208: Given %s, When asked, Then it may not',
    (_, tool, page, latched) => {
      expect(mayTurn(tool, page, latched)).toBe(false)
    },
  )
})

describe('keyOf', () => {
  it('F03-AC202: Given the two turns, When the key is asked, Then they are the arrows, with the legacy codes', () => {
    expect(keyOf('next')).toEqual({
      key: 'ArrowRight',
      code: 'ArrowRight',
      keyCode: 39,
    })
    expect(keyOf('prev')).toEqual({
      key: 'ArrowLeft',
      code: 'ArrowLeft',
      keyCode: 37,
    })
  })
})
