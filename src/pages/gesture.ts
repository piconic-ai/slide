/**
 * The pure part of the page-turning gestures: what a touch means, whether
 * it may turn a page, and what key stands for the turn. Like READING_SOURCE
 * it is the text of functions that take everything they use as arguments,
 * so the page script holds it inline and the tests run the same text with
 * plain values (F03-AC202 to F03-AC208).
 *
 * What touches the document (the touch events, the selection, the timer,
 * the key that is sent) stays in script.ts.
 */
export const GESTURE_SOURCE = `
  // A swipe goes at least this far across, and across more than it goes
  // up or down by this factor. A tap moves less than TAP_MOVE_PX, and
  // ends within TAP_MAX_MS.
  const SWIPE_MIN_PX = 40
  const SWIPE_AXIS_FACTOR = 2
  const TAP_MOVE_PX = 10
  const TAP_MAX_MS = 500
  // How long the slides get to turn the page themselves, after a touch,
  // before the service turns it for them.
  const SETTLE_MS = 80
  // The tags of what a tap on it is meant for.
  const TAPPED_TAGS = ['a', 'button', 'input', 'select', 'textarea', 'label', 'summary', 'video', 'audio']

  // What a touch from start to end asks for: { turn: 'next' | 'prev',
  // tap: boolean }, or null when it asks for nothing. A point is
  // { x, y, t } (t in ms); width is the frame's width.
  const gestureOf = (start, end, width) => {
    const dx = end.x - start.x
    const dy = end.y - start.y
    const across = Math.abs(dx)
    if (across >= SWIPE_MIN_PX && across > SWIPE_AXIS_FACTOR * Math.abs(dy))
      return { turn: dx < 0 ? 'next' : 'prev', tap: false }
    if (across < TAP_MOVE_PX && Math.abs(dy) < TAP_MOVE_PX && end.t - start.t <= TAP_MAX_MS && width > 0) {
      if (start.x < width / 3) return { turn: 'prev', tap: true }
      if (start.x > (width * 2) / 3) return { turn: 'next', tap: true }
    }
    return null
  }

  // Whether a tap on the element is the slides' own: it, or what holds it,
  // is a link, a button, a field, a video, or looks as if it can be pressed.
  // The chain is the element and the ones around it, as
  // { tag, role, onclick, editable, pointer, scrollsX } each.
  const tappedForItself = (chain) => chain.some((node) =>
    TAPPED_TAGS.includes(node.tag) ||
    node.role === 'button' || node.role === 'link' ||
    node.onclick || node.editable || node.pointer)

  // Whether a swipe that begins on this element is meant for something that
  // scrolls sideways, such as a wide code block: the chain's elements say so
  // as \`scrollsX\`.
  const scrollsAcross = (chain) => chain.some((node) => node.scrollsX === true)

  // What to do once the slides have had their time: send the key when the
  // page is as it was, and nothing when the slides turned it themselves
  // (they have a touch of their own, and are left to it from then on).
  const afterSettling = (before, after) => after === before ? 'send' : 'left-to-the-slides'

  // Whether the service may turn pages for these slides at all: only when
  // the page is known, and no tool that has its own touch is in use.
  const mayTurn = (tool, page, latched) => tool === null && page !== null && !latched

  // The key that stands for a turn.
  const keyOf = (turn) => turn === 'next'
    ? { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39 }
    : { key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37 }
`
