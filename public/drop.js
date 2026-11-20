// Makes each place for dropping slides take a file: one dropped on it, or one
// chosen with its button. The frame is drawn by the server with its button
// disabled; this script enables it, so where no script runs nothing looks
// usable. What to send, what to refuse and how to send it are decided by
// ./drop-core.js, which is built from the tested functions in src/drops.
import {
  attemptFor,
  continueMark,
  dropText,
  failureMessage,
  formatBytes,
  freshStash,
  isContinuing,
  pageLang,
  planKey,
  prepareDrop,
  refusalMessage,
  rememberAfter,
  sendDrop,
  STASH_CONTINUE_KEY,
  STASH_RETURN_PARAM,
  stashSignInPath,
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

/**
 * Where the author goes once a slide is put: the one place that decides it.
 * It is the author's viewer of the slides, where they check them and press
 * Publish, kept to this origin whatever the answer said. Without a viewer
 * (the author has no handle yet) it is the slide's editing page.
 */
const getDropDestination = (result) => {
  for (const address of [result.viewUrl, result.manageUrl]) {
    // An answer without a viewer (the author has no handle) names none: an
    // empty address would resolve to the page the author is on.
    if (typeof address !== 'string' || address === '') continue
    try {
      const url = new URL(address, location.href)
      if (url.origin === location.origin) return url.href
    } catch {}
  }
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

// Pressing "sign in to continue" leaves a mark in this tab: the attempt of
// the kept file, a token that this one sign-in carries to the service and
// back, and the time. Only a return that comes with the token of its own
// mark, soon enough, receives the file, and the mark is taken away when it
// is read, so it works once. Without it, whoever is signed in when the top
// page opens gets nothing sent in their name. Storage may be blocked; then
// nothing is received by itself.
const mark = {
  leave(attempt, token) {
    try {
      sessionStorage.setItem(
        STASH_CONTINUE_KEY,
        continueMark(attempt, token, Date.now()),
      )
    } catch {}
  },
  take() {
    try {
      const left = sessionStorage.getItem(STASH_CONTINUE_KEY)
      sessionStorage.removeItem(STASH_CONTINUE_KEY)
      return left
    } catch {
      return null
    }
  },
}

/** The token the sign-in came back with, taken out of the address. */
const returned = () => {
  try {
    const url = new URL(location.href)
    const token = url.searchParams.get(STASH_RETURN_PARAM)
    if (token === null) return null
    url.searchParams.delete(STASH_RETURN_PARAM)
    history.replaceState(history.state, '', url)
    return token
  } catch {
    return null
  }
}

/** Asks the service whether the visitor is signed in; null when it did not say. */
const askSession = async () => {
  try {
    const response = await fetch('/api/session', { credentials: 'same-origin' })
    if (!response.ok) return null
    return (await response.json()).signedIn === true
  } catch {
    return null
  }
}
/**
 * Whether a visitor is signed in; null when the service did not say. The
 * header's script has asked already, and its answer is used; this script
 * asks by itself only on a page without that header.
 */
const signedIn = async () => {
  if (!window.slideSession) return askSession()
  const session = await window.slideSession
  return session === null ? null : session?.signedIn === true
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

  // What a file is shown with: one kept for a signed-out visitor, with the
  // way to sign in, or one that was not received, with the way to send it
  // again.
  const picked = document.createElement('div')
  picked.className = 'drop-picked'
  picked.hidden = true
  const pickedFile = document.createElement('p')
  pickedFile.className = 'drop-file'
  const continueLink = document.createElement('a')
  continueLink.className = 'button-primary'
  continueLink.textContent = words.signInToContinue
  const retry = document.createElement('button')
  retry.type = 'button'
  retry.className = 'button-primary'
  retry.textContent = words.sendAgain
  const another = document.createElement('button')
  another.type = 'button'
  another.className = 'button-secondary'
  another.textContent = words.pickAnother
  picked.append(pickedFile, continueLink, retry, another)
  note.before(picked)

  // While a file is received or kept, the button to choose is out of the
  // way. Someone using the keyboard was on it: focus stays inside the
  // frame, and goes back to the button when the frame is at rest again.
  title.tabIndex = -1
  const hideChoose = (next = title) => {
    const focused = zone.contains(document.activeElement)
    choose.hidden = true
    if (focused) next.focus()
  }
  /** What "sign in to continue" marks: the kept file's attempt, and a token. */
  let keptMark = null
  /** Sends the file that was not received once more. */
  let again = null
  const rest = () => {
    const focused = zone.contains(document.activeElement)
    keptMark = null
    again = null
    zone.removeAttribute('data-busy')
    zone.removeAttribute('data-picked')
    title.textContent = idle.title
    note.textContent = idle.note
    bar.hidden = true
    picked.hidden = true
    choose.disabled = false
    choose.hidden = false
    if (focused) choose.focus()
  }
  const showFile = (file, heading, text, action) => {
    zone.setAttribute('data-picked', '')
    title.textContent = heading
    pickedFile.textContent = words.pickedFile(file.name, formatBytes(file.size))
    note.textContent = text
    continueLink.hidden = action !== continueLink
    retry.hidden = action !== retry
    picked.hidden = false
    hideChoose(action)
  }
  const showPicked = (file, attempt) => {
    rest()
    const token = crypto.randomUUID()
    keptMark = { attempt, token }
    continueLink.href = stashSignInPath(token)
    showFile(file, words.picked, words.pickedNote, continueLink)
    say('', 'status')
  }
  /** A kept file that was not received stays in the frame, to send again. */
  const showFailed = (file, attempt, message) => {
    rest()
    again = () => take(file, attempt)
    showFile(file, words.notReceived, words.notReceivedNote, retry)
    say(message, 'refusal')
  }
  const refuse = (message) => {
    rest()
    say(message, 'refusal')
  }

  const keeps = zone.hasAttribute('data-drop-stash')
  // Who is here, where the frame keeps files: asked once, and every drop
  // waits for the answer, so nothing is sent for a visitor who may not be
  // signed in. Where the page is the author's own, nobody is asked.
  let visitor = keeps ? signedIn() : Promise.resolve(true)
  /** Who is here, asking once more when the service did not say. */
  const who = async () => {
    if ((await visitor) === null) visitor = askSession()
    return visitor
  }

  let busy = false
  // The attempt of the last send that did not finish, for the same content.
  let remembered = null
  /** Keeps a checked file for a visitor who is not signed in. Nothing is sent. */
  const hold = async (file, attempt) => {
    try {
      await stash.write({ file, attempt, storedAt: Date.now() })
    } catch {
      return refuse(words.notKept)
    }
    showPicked(file, attempt)
  }
  /** The frame while a file is received; one shown as kept gives way. */
  const showReceiving = (file) => {
    keptMark = null
    again = null
    zone.removeAttribute('data-picked')
    zone.setAttribute('data-busy', '')
    hideChoose()
    picked.hidden = true
    title.textContent = words.receiving
    note.textContent = file.name
    say('', 'status')
  }
  /**
   * Says why a file was not received. One that was kept was not dropped
   * here, so it stays in the frame to be sent again when that can help.
   */
  const notReceived = (file, given, result) => {
    const message = failureMessage(result, lang)
    if (given && result.resumable !== false) showFailed(file, given, message)
    else refuse(message)
  }
  const take = async (file, given) => {
    if (busy) return
    busy = true
    try {
      showReceiving(file)
      const plan = await prepareDrop(
        { name: file.name, size: file.size },
        async () => new Uint8Array(await file.arrayBuffer()),
      )
      if (!plan.ok) return refuse(refusalMessage(plan.refusal, lang))
      // The same content dropped again goes on with the upload it began.
      const key = planKey(plan.files)
      const attempt =
        given ?? attemptFor(remembered, key, () => crypto.randomUUID())
      // Nothing about the file leaves the browser unless its visitor is
      // known to be signed in. One who is not is asked to sign in first,
      // and the file is kept. When the service does not say, nothing is
      // kept either: asking to sign in would be the wrong thing to say.
      const visiting = await who()
      if (visiting === null) return refuse(words.visitorUnknown)
      if (visiting !== true) return await hold(file, attempt)
      // The file is in hand now: none is left for the browser's next user.
      if (keeps) await stash.clear()
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
      remembered = rememberAfter(result, key, attempt)
      // The session ended meanwhile: the file waits for the next sign-in.
      if (!result.ok && result.reason === 'sign_in' && keeps)
        return await hold(file, attempt)
      if (!result.ok) return notReceived(file, given, result)
      location.assign(getDropDestination(result))
    } catch {
      notReceived(file, given, { reason: 'failed' })
    } finally {
      busy = false
    }
  }

  // A drop of several things takes none: one slide is one file. While a
  // file is being received, nothing else is taken or said.
  const only = (files) => {
    if (busy) return
    if (files.length === 1) return take(files[0])
    refuse(refusalMessage({ reason: 'unsupported_kind' }, lang))
  }

  continueLink.addEventListener('click', () => {
    if (keptMark) mark.leave(keptMark.attempt, keptMark.token)
  })
  retry.addEventListener('click', () => again?.())
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
  // The top page is the same file for everyone: ask who is here, then show
  // a visitor the file they kept, or receive it for the one who pressed
  // "sign in to continue" in this tab and came back signed in.
  visitor.then(async (answer) => {
    if (answer === true) zone.classList.remove('drop-zone-large')
    const kept = await stash.read()
    if (answer === null) {
      // Nobody knows who is here: the mark and the kept file wait for a
      // reading of the page that does.
      choose.disabled = false
      if (kept) say(words.keptUnknown, 'refusal')
      return
    }
    const back = returned()
    const left = mark.take()
    choose.disabled = false
    if (!kept) return
    if (answer !== true) return showPicked(kept.file, kept.attempt)
    // Signed in: the kept file is theirs to receive now, or nobody's. It
    // does not wait in the browser for whoever opens this page next.
    await stash.clear()
    if (isContinuing(left, kept, back, Date.now()))
      take(kept.file, kept.attempt)
  })
}

// A zone is set up once. This script is loaded once, by the first page that
// has a zone; the pages moved to after that put their zones in the frame
// without loading it again, so /share.js hands each of them to this function.
const zones = new WeakSet()
const setUpNew = (root) => {
  for (const zone of root.querySelectorAll('[data-drop-zone]'))
    if (!zones.has(zone)) {
      zones.add(zone)
      setUp(zone)
    }
}
if (window.slidePage) window.slidePage.onMount(setUpNew)
else setUpNew(document)
