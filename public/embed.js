// The page a site frames to show slides.
const deck = document.querySelector('iframe#deck')
if (deck) {
  // iOS Safari sends touches into a cross-origin frame only where it finds a
  // touch listener, and it does not count the frame's own window or document
  // listeners. Slides that page on window touch events then never move. An
  // empty listener on the frame element marks its area as handling touches,
  // as the viewer does.
  deck.addEventListener('touchstart', () => {}, { passive: true })
  // A link in the slides that leads anywhere but their own files, the share
  // URL of other slides included, is refused by this page's policy: its
  // frame may hold the slides' origin only. Firefox then leaves the slides
  // as they are. Chromium puts its error page in the frame, and the slides
  // would be gone until the reader loads the article again. That case is
  // told by a load of the frame that comes with a refusal: the two events
  // arrive in either order, a moment apart. The slides are then loaded
  // again from where the frame started. Safari keeps the slides but reports
  // the same load, which this page cannot tell from Chromium's, so there
  // the slides start again too. A load well before the
  // refusal is the slides' own, and a move within the slides' own files
  // loads the frame without a refusal; both are left be.
  const start = deck.getAttribute('src')
  const BEFORE = 250
  const AFTER = 2000
  let refusedAt = -Infinity
  let loadedAt = -Infinity
  let restoring = false
  const restore = () => {
    const gap = loadedAt - refusedAt
    if (!(gap >= -BEFORE && gap <= AFTER)) return
    refusedAt = loadedAt = -Infinity
    restoring = true
    deck.src = start
  }
  deck.addEventListener('load', () => {
    // The load of the slides put back is not a sign of anything.
    if (restoring) {
      restoring = false
      return
    }
    loadedAt = performance.now()
    restore()
  })
  document.addEventListener('securitypolicyviolation', (event) => {
    if (event.effectiveDirective !== 'frame-src') return
    refusedAt = performance.now()
    restore()
  })
}
