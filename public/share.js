// Copies a share URL from the input that a [data-copy] button names. Where
// the clipboard is unavailable, the URL is selected for a manual copy.
for (const button of document.querySelectorAll('[data-copy]')) {
  button.addEventListener('click', async () => {
    const input = document.getElementById(button.dataset.copy)
    if (!input) return
    try {
      await navigator.clipboard.writeText(input.value)
      button.textContent = 'コピーしました'
    } catch {
      input.select()
    }
  })
}
// Keyboard navigation of a deck works once its frame has focus.
document.querySelector('iframe[data-autofocus]')?.focus()
