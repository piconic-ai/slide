// Copies a share URL from the input that a [data-copy] button names, then
// shows the button's data-copied text, worded in the page's language. Where
// the clipboard is unavailable, the URL is selected for a manual copy.
for (const button of document.querySelectorAll('[data-copy]')) {
  button.addEventListener('click', async () => {
    const input = document.getElementById(button.dataset.copy)
    if (!input) return
    try {
      await navigator.clipboard.writeText(input.value)
      if (button.dataset.copied) button.textContent = button.dataset.copied
    } catch {
      input.select()
    }
  })
}
// Keyboard navigation of a deck works once its frame has focus.
document.querySelector('iframe[data-autofocus]')?.focus()
// iOS Safari sends touches into a cross-origin frame only where it finds a
// touch listener, and it does not count the frame's own window or document
// listeners. A deck that pages on window touch events then never moves. An
// empty listener on the frame element marks its area as handling touches.
document
  .querySelector('iframe[data-autofocus]')
  ?.addEventListener('touchstart', () => {}, { passive: true })
// A reader who follows a deck's link to another deck: the deck's frame loads
// the service's own page, which asks to open the path. Only the frame of the
// deck this page is about may ask, from this origin, and only for a share
// path. The decks shown small under it are other authors' and run without
// the reader choosing them, so a request from one of those is not followed.
const decks = [...document.querySelectorAll('iframe[data-deck]')]
const SHARE_PATH =
  /^\/@[a-z0-9][a-z0-9-]{0,38}\/[a-z0-9][a-z0-9-]{0,63}(?:\/[1-9][0-9]{0,3})?$/
// A viewer always starts its frames on decks. Going back, some browsers
// bring a frame up on the service's page instead: by restoring this page
// as it was when the reader left, or by loading the frame from history. That
// is a return to the deck, not the link followed again. So a request counts
// only after the deck has loaded in the frame, and each load allows one; any
// other request loads the deck again in the frame's place.
// A frame's location is readable only while it is on this origin.
function onServicePage(frame) {
  try {
    return frame.contentWindow?.location.origin === location.origin
  } catch {
    return false
  }
}
const shown = new WeakSet()
for (const frame of decks)
  frame.addEventListener('load', () => {
    // The service's page may finish loading before its request arrives, so
    // its load leaves the mark as it is.
    if (!onServicePage(frame)) shown.add(frame)
  })
function restoreDeck(frame) {
  if (onServicePage(frame)) frame.contentWindow.location.replace(frame.src)
}
addEventListener('pageshow', () => decks.forEach(restoreDeck))
// A request that is not followed puts the deck back once. A deck that sends
// its frame away again by itself is left there, not loaded in a loop.
const putBack = new WeakSet()
function refuse(frame) {
  if (putBack.has(frame)) return
  putBack.add(frame)
  restoreDeck(frame)
}
addEventListener('message', (event) => {
  const frame = decks.find((deck) => deck.contentWindow === event.source)
  if (!frame || event.origin !== location.origin) return
  if (event.data?.type !== 'slide:open') return
  if (frame.id !== 'deck' || !shown.has(frame)) return refuse(frame)
  const path = event.data.path
  if (typeof path !== 'string' || !SHARE_PATH.test(path)) return
  shown.delete(frame)
  location.assign(path)
})
// Shows the deck alone. Hidden where the browser cannot do it.
for (const button of document.querySelectorAll('[data-fullscreen]')) {
  const target = document.getElementById(button.dataset.fullscreen)
  if (!target?.requestFullscreen || !document.fullscreenEnabled) continue
  button.hidden = false
  button.addEventListener('click', async () => {
    await target.requestFullscreen().catch(() => {})
    target.focus()
  })
}
// A deck shown small is drawn at a full slide's size and scaled to fit, so
// it looks as it does on a large screen. Without this script the frame is
// simply as small as its box.
const MINI_WIDTH = 1280
const MINI_HEIGHT = 720
const fitMini = (box) => {
  const frame = box.querySelector('iframe')
  if (!frame) return
  frame.style.width = `${MINI_WIDTH}px`
  frame.style.height = `${MINI_HEIGHT}px`
  frame.style.transform = `scale(${box.clientWidth / MINI_WIDTH})`
}
if (typeof ResizeObserver === 'function') {
  const observer = new ResizeObserver((entries) => {
    for (const entry of entries) fitMini(entry.target)
  })
  for (const box of document.querySelectorAll('[data-mini]'))
    observer.observe(box)
}
