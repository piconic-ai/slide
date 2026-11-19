// Makes each place for dropping slides take a file: one dropped on it, or one
// chosen with its button. The frame is drawn by the server with its button
// disabled; this script enables it, so where no script runs nothing looks
// usable. What to send, what to refuse and how to send it are decided by
// ./drop-core.js, which is built from the tested functions in src/drops.
import {
  dropText,
  failureMessage,
  formatBytes,
  freshStash,
  pageLang,
  prepareDrop,
  refusalMessage,
  sendDrop,
  STASH_SIGN_IN_PATH,
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

// A file picked before signing in is kept here, one at a time, until its
// owner comes back signed in. IndexedDB holds the File itself. A browser
// that refuses the storage (some private windows) keeps nothing, and the
// frame then says to sign in first.
const STASH = { database: 'slide-drop', store: 'pending', key: 'drop' }
const stashStore = (mode) =>
  new Promise((resolve, reject) => {
    const opening = indexedDB.open(STASH.database, 1)
    opening.onupgradeneeded = () =>
      opening.result.createObjectStore(STASH.store)
    opening.onerror = () => reject(opening.error)
    opening.onsuccess = () => {
      const transaction = opening.result.transaction(STASH.store, mode)
      transaction.oncomplete = () => opening.result.close()
      resolve(transaction.objectStore(STASH.store))
    }
  })
const settled = (request) =>
  new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
const stash = {
  /** The kept file, or null: none, one too old, or one that is no file. */
  async read() {
    try {
      const record = await settled(
        (await stashStore('readonly')).get(STASH.key),
      )
      const kept = freshStash(record, Date.now())
      if (record !== undefined && !kept) await stash.clear()
      return kept
    } catch {
      return null
    }
  },
  async write(record) {
    await settled((await stashStore('readwrite')).put(record, STASH.key))
  },
  async clear() {
    try {
      await settled((await stashStore('readwrite')).delete(STASH.key))
    } catch {}
  },
}

/** Whether a visitor is signed in; null when the service did not say. */
const signedIn = async () => {
  try {
    const response = await fetch('/api/session', { credentials: 'same-origin' })
    if (!response.ok) return null
    return (await response.json()).signedIn === true
  } catch {
    return null
  }
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
  // What a file kept for a signed-out visitor is shown with.
  const picked = document.createElement('div')
  picked.className = 'drop-picked'
  picked.hidden = true
  const pickedFile = document.createElement('p')
  pickedFile.className = 'drop-file'
  const continueLink = document.createElement('a')
  continueLink.className = 'button-primary'
  continueLink.href = STASH_SIGN_IN_PATH
  continueLink.textContent = words.signInToContinue
  const another = document.createElement('button')
  another.type = 'button'
  another.className = 'button-secondary'
  another.textContent = words.pickAnother
  picked.append(pickedFile, continueLink, another)
  note.before(picked)

  const rest = () => {
    zone.removeAttribute('data-busy')
    zone.removeAttribute('data-picked')
    title.textContent = idle.title
    note.textContent = idle.note
    bar.hidden = true
    picked.hidden = true
    choose.disabled = false
    choose.hidden = false
  }
  const showPicked = (file) => {
    rest()
    zone.setAttribute('data-picked', '')
    choose.hidden = true
    title.textContent = words.picked
    pickedFile.textContent = words.pickedFile(file.name, formatBytes(file.size))
    note.textContent = words.pickedNote
    picked.hidden = false
    say('', 'status')
  }
  const refuse = (message) => {
    rest()
    say(message, 'refusal')
  }

  const keeps = zone.hasAttribute('data-drop-stash')
  // Whether the visitor is signed in, where the frame keeps files; null
  // until the service has said, and where the page is the author's own.
  let visitor = null

  let busy = false
  /**
   * Keeps a file for a visitor who is not signed in, after the same checks a
   * signed-in drop gets. Nothing is sent.
   */
  const hold = async (file, attempt = crypto.randomUUID()) => {
    const plan = await prepareDrop(
      { name: file.name, size: file.size },
      async () => new Uint8Array(await file.arrayBuffer()),
    )
    if (!plan.ok) return refuse(refusalMessage(plan.refusal, lang))
    try {
      await stash.write({ file, attempt, storedAt: Date.now() })
    } catch {
      return refuse(words.notKept)
    }
    showPicked(file)
  }
  const take = async (file, attempt = crypto.randomUUID()) => {
    if (busy) return
    busy = true
    try {
      if (keeps && visitor === false) return await hold(file, attempt)
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
        attempt,
        name: {
          fileName: file.name.slice(0, 1000),
          title: index ? titleOf(index.bytes).slice(0, 1000) : '',
        },
        files: plan.files,
        onProgress: progress,
      })
      // The session ended meanwhile: the file waits for the next sign-in.
      if (!result.ok && result.reason === 'sign_in' && keeps) {
        visitor = false
        return await hold(file, attempt)
      }
      // A kept file is done with once the service has answered for it; a
      // drop that only failed halfway is tried again on the next visit.
      if (result.ok || (result.reason !== 'failed' && result.reason !== 'busy'))
        await stash.clear()
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

  another.addEventListener('click', async () => {
    await stash.clear()
    rest()
    choose.focus()
  })
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
  if (!keeps) {
    choose.disabled = false
    return
  }
  // The top page is the same file for everyone: ask who is here, then
  // receive what a visitor kept before signing in, or show it again.
  signedIn().then(async (answer) => {
    visitor = answer
    if (answer === true) zone.classList.remove('drop-zone-large')
    const kept = await stash.read()
    choose.disabled = false
    if (!kept) return
    if (answer === true) take(kept.file, kept.attempt)
    else showPicked(kept.file)
  })
}

for (const zone of document.querySelectorAll('[data-drop-zone]')) setUp(zone)
