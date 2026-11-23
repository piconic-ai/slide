// The article's editing page. The box is kept as the author types: after
// 1.5 seconds without a key, the text is sent to the server, which keeps it
// where readers do not see it. Beside the box, on a wide screen, the article
// as the viewer draws it is asked from the server 0.4 seconds after the last
// key; only the HTML the server made is put in, and no Markdown is read here.
// Every button of the page also works without this script: the form sends
// the box and the revision the page was on. Written by hand, served as it is
// (the pages' policy allows scripts of the service's own origin only).
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
  // Saving is over for this page: another tab moved the article on, the
  // sign-in ended, the slides are gone, or the page itself is not valid. The
  // box keeps the text, and nothing more is sent.
  let stopped = root.dataset.stopped === 'true'
  // The text is too long to keep: saving starts again once it is shorter.
  let tooLong = false
  let submitting = false

  const say = (message) => {
    status.textContent = message
  }
  const wide = matchMedia('(min-width: 1100px)')
  if (stopped) say(words.textConflict)

  const stop = (message) => {
    stopped = true
    clearTimeout(saveTimer)
    saveTimer = 0
    say(message)
  }

  async function failure(response) {
    if (response.status === 409) return stop(words.textConflict)
    if (response.status === 401) return stop(words.textSignedOut)
    if (response.status === 404) return stop(words.textGone)
    if (response.status === 400) {
      const reason = await response.json().catch(() => ({}))
      if (reason.error === 'too_long') {
        // Shorter text is saved again; nothing is sent until then.
        tooLong = true
        say(words.textTooLong)
      } else stop(words.textInvalid)
      return
    }
    say(words.textFailed)
    schedule(RETRY_AFTER)
  }

  function save() {
    clearTimeout(saveTimer)
    saveTimer = 0
    if (stopped || tooLong || inFlight || box.value === saved) return inFlight
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
        if (chips) chips.hidden = !result.pending
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
        if (!stopped && !tooLong && box.value !== saved && !saveTimer)
          schedule(SAVE_AFTER)
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
    // A text that is short enough again is saved again.
    if (tooLong) {
      tooLong = false
      say('')
    }
    clearTimeout(renderTimer)
    renderTimer = setTimeout(render, RENDER_AFTER)
    if (!stopped) schedule(SAVE_AFTER)
  })
  // A page already holding text the server lacks (back from the preview).
  if (saved === null && !stopped) schedule(SAVE_AFTER)
  wide.addEventListener('change', () => wide.matches && render())

  // The preview beside the box shows how the article reads; nothing in it
  // leads away from the box.
  pane?.addEventListener('click', (event) => {
    if (event.target instanceof Element && event.target.closest('a'))
      event.preventDefault()
  })

  // What is typed and not yet kept, and what is on its way, is kept before a
  // button is sent, one save after another, so the button goes with the
  // revision the last one made. A save that cannot be made does not hold the
  // button back: the server answers to the revision the page was on.
  async function settle() {
    for (let turn = 0; turn < 8; turn += 1) {
      clearTimeout(saveTimer)
      saveTimer = 0
      if (inFlight) {
        await inFlight
        continue
      }
      if (stopped || tooLong || box.value === saved) return
      const before = saved
      await save()
      if (saved === before) return
    }
  }

  // A button is pressed once: a second press while the first is on its way
  // is not sent. When something is still to be kept, the press waits for it
  // and is then sent again with the submitter, as `passThrough`.
  let passThrough = false
  form.addEventListener('submit', (event) => {
    if (passThrough) return
    if (submitting) {
      event.preventDefault()
      return
    }
    submitting = true
    if (!inFlight && !saveTimer && box.value === saved) return
    event.preventDefault()
    const submitter = event.submitter
    settle().then(() => {
      passThrough = true
      form.requestSubmit(submitter)
    })
  })

  // Leaving asks only while the text is not kept yet.
  addEventListener('beforeunload', (event) => {
    if (submitting || box.value === saved) return
    event.preventDefault()
    event.returnValue = ''
  })
  render()
}
