// The page a site frames to show slides. iOS Safari sends touches into a
// cross-origin frame only where it finds a touch listener, and it does not
// count the frame's own window or document listeners. Slides that page on
// window touch events then never move. An empty listener on the frame
// element marks its area as handling touches, as the viewer does.
document
  .querySelector('iframe#deck')
  ?.addEventListener('touchstart', () => {}, { passive: true })
