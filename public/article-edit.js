// The article's editing page. The box is kept as the author types: after
// 1.5 seconds without a key, the text is sent to the server, which keeps it
// where readers do not see it. Beside the box, on a wide screen, the article
// as the viewer draws it is asked from the server 0.4 seconds after the last
// key; only the HTML the server made is put in, and no Markdown is read here.
// Written by hand, served as it is (the pages' policy allows scripts of the
// service's own origin only).
const root = document.querySelector('[data-article-edit]')
if (root) {
  const form = root.querySelector('form')
  const box = root.querySelector('#article-body')
  const revision = form.querySelector('input[name="revision"]')
  const status = root.querySelector('[data-autosave-status]')
  const pane = root.querySelector('[data-article-pane]')
  const chips = root.querySelector('[data-pending-chip]')
  const words = root.dataset
  const base = `/slides/${root.dataset.deck}/article`
  const SAVE_AFTER = 1500
  const RENDER_AFTER = 400
  const RETRY_AFTER = 5000

  // The text the server has: null while the box holds something it does not.
  let saved = form.dataset.unsaved === 'true' ? null : box.value
  let inFlight = null
  let saveTimer = 0
  let renderTimer = 0
  let renderCount = 0
  let stopped = false
  let leaving = false

  const say = (message) => {
    status.textContent = message
  }
  const wide = matchMedia('(min-width: 1100px)')

  const showPending = (pending) => {
    if (chips) chips.hidden = !pending
    for (const button of form.querySelectorAll('[data-needs-pending]'))
      button.disabled = !pending
  }

  const failure = (response) => {
    if (response.status === 409) {
      stopped = true
      say(words.textConflict)
    } else if (response.status === 400) {
      stopped = true
      say(words.textTooLong)
    } else {
      say(words.textFailed)
      schedule(RETRY_AFTER)
    }
  }

  async function save() {
    clearTimeout(saveTimer)
    saveTimer = 0
    if (stopped || inFlight || box.value === saved) return
    const sent = box.value
    say(words.textSaving)
    const body = new URLSearchParams({ body: sent, revision: revision.value })
    inFlight = fetch(`${base}/autosave`, {
      method: 'POST',
      body,
      credentials: 'same-origin',
    })
      .then(async (response) => {
        if (!response.ok) return failure(response)
        const result = await response.json()
        saved = sent
        revision.value = String(result.revision)
        showPending(result.pending)
        const time = new Date(result.savedAt * 1000).toLocaleTimeString(
          root.dataset.lang === 'ja' ? 'ja-JP' : 'en-US',
          { hour: '2-digit', minute: '2-digit' },
        )
        // Typing went on while this was on its way: save again.
        if (box.value === saved) say(words.textSaved.replace('{time}', time))
      })
      .catch(() => {
        say(words.textFailed)
        schedule(RETRY_AFTER)
      })
      .finally(() => {
        inFlight = null
        if (!stopped && box.value !== saved && !saveTimer) schedule(SAVE_AFTER)
      })
    return inFlight
  }

  function schedule(delay) {
    clearTimeout(saveTimer)
    saveTimer = setTimeout(save, delay)
  }

  async function render() {
    renderTimer = 0
    if (!pane || !wide.matches) return
    const mine = ++renderCount
    try {
      const response = await fetch(`${base}/render`, {
        method: 'POST',
        body: new URLSearchParams({ body: box.value }),
        credentials: 'same-origin',
      })
      // An answer to a text since typed over is not drawn.
      if (mine !== renderCount) return
      if (response.ok) pane.innerHTML = await response.text()
    } catch {}
  }

  box.addEventListener('input', () => {
    if (stopped) return
    schedule(SAVE_AFTER)
    clearTimeout(renderTimer)
    renderTimer = setTimeout(render, RENDER_AFTER)
  })
  // A page already holding text the server lacks (back from the preview).
  if (saved === null) schedule(SAVE_AFTER)
  wide.addEventListener('change', () => wide.matches && render())

  // The preview beside the box shows how the article reads; nothing in it
  // leads away from the box.
  pane?.addEventListener('click', (event) => {
    if (event.target instanceof Element && event.target.closest('a'))
      event.preventDefault()
  })

  // A button sends the box with the revision this page last knew, so what is
  // typed and not yet kept, or on its way, is kept first.
  form.addEventListener('submit', (event) => {
    if (leaving || (!inFlight && !saveTimer)) {
      leaving = true
      return
    }
    event.preventDefault()
    const submitter = event.submitter
    const pending = saveTimer ? save() : inFlight
    Promise.resolve(pending).then(() => {
      // A save refused leaves the text for the server to answer to.
      leaving = true
      form.requestSubmit(submitter)
    })
  })

  // Leaving asks only while the text is not kept yet.
  addEventListener('beforeunload', (event) => {
    if (leaving || box.value === saved) return
    event.preventDefault()
    event.returnValue = ''
  })
  render()
}
