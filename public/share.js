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
