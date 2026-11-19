// Makes each place for dropping slides take a file: one dropped on it, or one
// chosen with its button. The frame is drawn by the server with its button
// disabled; this script enables it, so where no script runs nothing looks
// usable. What to send, what to refuse and how to send it are decided by
// ./drop-core.js, which is built from the tested functions in src/drops.
import {
  dropText,
  failureMessage,
  pageLang,
  prepareDrop,
  refusalMessage,
  sendDrop,
} from './drop-core.js'

const lang = pageLang(document.documentElement.lang)
const words = dropText(lang)

/** Sends one request to the service, as the flow in drop-core asks. */
const request = async (path, init) => {
  const response = await fetch(path, { ...init, credentials: 'same-origin' })
  return {
    status: response.status,
    body: await response.json().catch(() => null),
  }
}
const wait = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds))

// The title names the slide's URL; the service reads its own for display.
const TITLE_SCAN_BYTES = 64 * 1024
const titleOf = (bytes) => {
  try {
    const head = new TextDecoder().decode(bytes.subarray(0, TITLE_SCAN_BYTES))
    return new DOMParser().parseFromString(head, 'text/html').title.trim()
  } catch {
    return ''
  }
}

/** The page of a slide, kept to this origin whatever the answer said. */
const pageOf = (result) => {
  try {
    const url = new URL(result.manageUrl, location.href)
    if (url.origin === location.origin) return url.href
  } catch {}
  return `/slides/${encodeURIComponent(result.slug)}`
}

function setUp(zone) {
  const choose = zone.querySelector('[data-drop-choose]')
  const input = zone.querySelector('[data-drop-input]')
  const title = zone.querySelector('[data-drop-title]')
  const note = zone.querySelector('[data-drop-note]')
  if (!choose || !input || !title || !note) return
  const idle = { title: title.textContent, note: note.textContent }
  const target =
    zone.dataset.dropZone === 'replace'
      ? { kind: 'version', slug: zone.dataset.deck ?? '' }
      : { kind: 'new' }

  // Said to assistive technology as it changes; a refusal interrupts.
  const status = document.createElement('p')
  status.className = 'drop-status'
  status.hidden = true
  const bar = document.createElement('div')
  bar.className = 'drop-progress'
  bar.setAttribute('role', 'progressbar')
  bar.setAttribute('aria-valuemin', '0')
  bar.hidden = true
  const fill = document.createElement('span')
  bar.append(fill)
  zone.append(bar, status)

  const say = (message, kind) => {
    status.textContent = message
    status.setAttribute('role', kind === 'refusal' ? 'alert' : 'status')
    status.toggleAttribute('data-refusal', kind === 'refusal')
    status.hidden = message === ''
  }
  const progress = (received, total) => {
    bar.hidden = false
    bar.setAttribute('aria-valuemax', String(total))
    bar.setAttribute('aria-valuenow', String(received))
    bar.setAttribute('aria-valuetext', words.progress(received, total))
    fill.style.width = `${total ? (received / total) * 100 : 0}%`
  }
  const rest = () => {
    zone.removeAttribute('data-busy')
    title.textContent = idle.title
    note.textContent = idle.note
    bar.hidden = true
    choose.disabled = false
    choose.hidden = false
  }
  const refuse = (message) => {
    rest()
    say(message, 'refusal')
  }

  let busy = false
  const take = async (file) => {
    if (busy) return
    busy = true
    try {
      zone.setAttribute('data-busy', '')
      choose.hidden = true
      title.textContent = words.receiving
      note.textContent = file.name
      say('', 'status')
      const plan = await prepareDrop(
        { name: file.name, size: file.size },
        async () => new Uint8Array(await file.arrayBuffer()),
      )
      if (!plan.ok) return refuse(refusalMessage(plan.refusal, lang))
      const index = plan.files.find(({ path }) => path === 'index.html')
      say(words.receivingNote, 'status')
      progress(0, plan.files.length)
      const result = await sendDrop({
        request,
        wait,
        target,
        attempt: crypto.randomUUID(),
        name: {
          fileName: file.name.slice(0, 1000),
          title: index ? titleOf(index.bytes).slice(0, 1000) : '',
        },
        files: plan.files,
        onProgress: progress,
      })
      if (!result.ok) return refuse(failureMessage(result, lang))
      location.assign(pageOf(result))
    } catch {
      refuse(failureMessage({ reason: 'failed' }, lang))
    } finally {
      busy = false
    }
  }

  // A drop of several things takes none: one slide is one file.
  const only = (files) =>
    files.length === 1
      ? take(files[0])
      : refuse(refusalMessage({ reason: 'unsupported_kind' }, lang))

  choose.addEventListener('click', () => input.click())
  input.addEventListener('change', () => {
    const files = [...input.files]
    // Choosing the same file again must fire a change too.
    input.value = ''
    if (files.length) only(files)
  })
  // Without this the browser would leave the page to open the file.
  for (const type of ['dragenter', 'dragover'])
    zone.addEventListener(type, (event) => {
      event.preventDefault()
      if (!busy) zone.setAttribute('data-over', '')
    })
  zone.addEventListener('dragleave', (event) => {
    if (!zone.contains(event.relatedTarget)) zone.removeAttribute('data-over')
  })
  zone.addEventListener('drop', (event) => {
    event.preventDefault()
    zone.removeAttribute('data-over')
    const files = [...(event.dataTransfer?.files ?? [])]
    if (files.length) only(files)
  })
  choose.disabled = false
}

for (const zone of document.querySelectorAll('[data-drop-zone]')) setUp(zone)
