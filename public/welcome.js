// The welcome page's agreement box: "Get started" can be pressed once the box
// is ticked. Without this script the button is always enabled, and the
// service refuses an unticked form itself.
const box = document.querySelector('[data-terms]')
const start = document.querySelector('[data-start]')
if (box instanceof HTMLInputElement && start instanceof HTMLButtonElement) {
  const note = document.createElement('p')
  note.className = 'field-note'
  note.id = 'welcome-start-note'
  note.textContent = start.dataset.startNote ?? ''
  start.after(note)
  start.setAttribute('aria-describedby', note.id)
  const sync = () => {
    start.disabled = !box.checked
    note.hidden = box.checked
  }
  box.addEventListener('change', sync)
  sync()
}
