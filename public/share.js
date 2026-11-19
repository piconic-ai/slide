// The header's account area starts empty. Ask who is signed in, then put
// the way in, or the link to the author's slides, the bell and their icon,
// which opens their menu. The last answer is kept in this browser and drawn
// at once on the next page, so the area does not blink in on every visit; the
// fresh answer then corrects it. When no answer comes, what is drawn stays,
// and a first visit gets the way in: GitHub sends a signed-in author back.
const account = document.querySelector('[data-account]')
if (account) {
  const KEPT = 'slide:session'
  const HANDLE = /^[a-z0-9][a-z0-9-]{0,38}$/
  // GitHub serves every profile picture here; the page policy allows no other.
  const AVATARS = 'https://avatars.githubusercontent.com/'
  const SVG = 'http://www.w3.org/2000/svg'
  const words = account.dataset
  const anchor = (href, text) => {
    const link = document.createElement('a')
    link.href = href
    link.textContent = text
    return link
  }
  // A bell drawn as two paths: the body, and the clapper under it.
  const bellIcon = () => {
    const svg = document.createElementNS(SVG, 'svg')
    svg.setAttribute('viewBox', '0 0 24 24')
    svg.setAttribute('fill', 'none')
    svg.setAttribute('stroke', 'currentColor')
    svg.setAttribute('stroke-width', '2')
    svg.setAttribute('stroke-linecap', 'round')
    svg.setAttribute('stroke-linejoin', 'round')
    svg.setAttribute('aria-hidden', 'true')
    for (const d of [
      'M6 9a6 6 0 0 1 12 0c0 6 2 7 2 7H4s2-1 2-7',
      'M10 20a2 2 0 0 0 4 0',
    ]) {
      const path = document.createElementNS(SVG, 'path')
      path.setAttribute('d', d)
      svg.append(path)
    }
    return svg
  }
  const signedIn = (login, handle, avatar, unread) => {
    const manage = anchor('/slides', words.decks)
    manage.className = 'manage'
    const bell = anchor('/notifications', '')
    bell.className = 'bell'
    // The label carries the number, as the list's own title does.
    bell.setAttribute(
      'aria-label',
      unread ? words.unread.replace('{count}', unread) : words.notifications,
    )
    const bellFace = document.createElement('span')
    bellFace.append(bellIcon())
    if (unread) {
      const dot = document.createElement('span')
      dot.className = 'unread-dot'
      bellFace.append(dot)
    }
    bell.append(bellFace)
    const menu = document.createElement('details')
    menu.className = 'menu'
    menu.setAttribute('data-menu', '')
    const icon = document.createElement('summary')
    icon.className = 'avatar'
    icon.title = login
    icon.setAttribute('aria-label', `${words.menu} (${login})`)
    icon.setAttribute('aria-expanded', 'false')
    // Their picture covers the initial, which shows again if it fails.
    const face = document.createElement('span')
    face.textContent = login.slice(0, 1)
    if (avatar) {
      const picture = document.createElement('img')
      picture.alt = ''
      picture.referrerPolicy = 'no-referrer'
      picture.addEventListener('error', () => picture.remove())
      picture.src = avatar
      face.append(picture)
    }
    icon.append(face)
    const items = document.createElement('div')
    items.className = 'menu-items'
    if (handle) items.append(anchor(`/@${handle}`, words.profile))
    items.append(
      anchor('/slides', words.decks),
      anchor('/settings', words.settings),
    )
    const logout = document.createElement('form')
    logout.method = 'post'
    logout.action = '/auth/logout'
    const button = document.createElement('button')
    button.textContent = words.logout
    logout.append(button)
    items.append(logout)
    menu.append(icon, items)
    return [manage, bell, menu]
  }
  const signIn = () => {
    const link = anchor('/auth/github', words.signIn)
    link.className = 'sign-in'
    return link
  }
  // What is drawn, so an answer that changes nothing leaves an open menu be.
  let drawn = null
  const draw = (session) => {
    const login =
      session?.signedIn === true && typeof session.login === 'string'
        ? session.login
        : ''
    const handle =
      login && typeof session.handle === 'string' && HANDLE.test(session.handle)
        ? session.handle
        : ''
    const avatar =
      login &&
      typeof session.avatarUrl === 'string' &&
      session.avatarUrl.startsWith(AVATARS)
        ? session.avatarUrl
        : ''
    const unread =
      login && Number.isInteger(session.unread) && session.unread > 0
        ? session.unread
        : 0
    const next = `${login}\n${handle}\n${avatar}\n${unread}`
    if (next === drawn) return
    drawn = next
    account.replaceChildren(
      ...(login ? signedIn(login, handle, avatar, unread) : [signIn()]),
    )
  }
  // Storage may be blocked, and what it holds is only a hint for drawing.
  try {
    const kept = JSON.parse(localStorage.getItem(KEPT) ?? 'null')
    if (kept) draw(kept)
  } catch {}
  fetch('/api/session', { credentials: 'same-origin' })
    .then((response) => {
      if (!response.ok) throw new Error(`session answered ${response.status}`)
      return response.json()
    })
    .then((session) => {
      draw(session)
      try {
        localStorage.setItem(KEPT, JSON.stringify(session))
      } catch {}
    })
    // No answer, or a refusal such as 429.
    .catch(() => {
      if (drawn === null) draw(null)
    })
  // Signing out or leaving ends the session: forget the kept icon, so the
  // next page does not draw it while the fresh answer is on its way.
  document.addEventListener('submit', (event) => {
    const action = event.target.getAttribute?.('action')
    if (action !== '/auth/logout' && action !== '/account/delete') return
    try {
      localStorage.removeItem(KEPT)
    } catch {}
  })
}
// Menus are <details data-menu>: the account menu in the header, and the
// share and "more" menus under the slides. Each says whether it is open in
// aria-expanded on its summary. An open one closes on a click outside it and
// on Escape, which hands the focus back to its summary; opening one closes
// the others. The toggle event does not bubble, hence the capturing listener,
// which also covers the header's menu, drawn after this script ran.
document.addEventListener(
  'toggle',
  (event) => {
    const menu = event.target
    if (!(menu instanceof HTMLDetailsElement) || !menu.matches('[data-menu]'))
      return
    menu.querySelector('summary')?.setAttribute('aria-expanded', menu.open)
    if (!menu.open) return
    for (const other of document.querySelectorAll('details[data-menu][open]'))
      if (other !== menu) other.open = false
  },
  true,
)
document.addEventListener('click', (event) => {
  for (const menu of document.querySelectorAll('details[data-menu][open]'))
    if (!menu.contains(event.target)) menu.open = false
})
document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return
  for (const menu of document.querySelectorAll('details[data-menu][open]')) {
    menu.open = false
    menu.querySelector('summary')?.focus()
  }
})
// Copies a share URL from the input that a [data-copy] button names, then
// shows the button's data-copied text, worded in the page's language, for
// two seconds. Where the clipboard is unavailable, the URL is selected for
// a manual copy.
for (const button of document.querySelectorAll('[data-copy]')) {
  const label = button.textContent
  let timer = 0
  button.addEventListener('click', async () => {
    const input = document.getElementById(button.dataset.copy)
    if (!input) return
    try {
      await navigator.clipboard.writeText(input.value)
      if (!button.dataset.copied) return
      button.textContent = button.dataset.copied
      clearTimeout(timer)
      timer = setTimeout(() => {
        button.textContent = label
      }, 2000)
    } catch {
      input.select()
    }
  })
}
// A cover is an image over a face that carries the deck's name. An image
// that cannot be read is hidden, so the name shows and no broken-image mark
// does. Error events do not bubble, hence the capturing listener; it also
// covers cards drawn after this script ran.
document.addEventListener(
  'error',
  (event) => {
    const image = event.target
    if (image instanceof HTMLImageElement && image.hasAttribute('data-cover'))
      image.hidden = true
  },
  true,
)
for (const image of document.querySelectorAll('img[data-cover]'))
  if (image.complete && image.naturalWidth === 0) image.hidden = true
// Keyboard navigation of a deck works once its frame has focus.
document.querySelector('iframe[data-autofocus]')?.focus()
// iOS Safari sends touches into a cross-origin frame only where it finds a
// touch listener, and it does not count the frame's own window or document
// listeners. A deck that pages on window touch events then never moves. An
// empty listener on the frame element marks its area as handling touches.
document
  .querySelector('iframe[data-autofocus]')
  ?.addEventListener('touchstart', () => {}, { passive: true })
// A post's embed page tells its height once it has rendered. X sends
// {"twttr.embed": {method: "twttr.private.resize", params: [{height}]}};
// Bluesky sends {height}. Only frames this page made are resized, and only
// from the height their own window reports.
const embeds = [...document.querySelectorAll('iframe[data-embed]')]
const reportedHeight = (data) => {
  const params = data?.['twttr.embed']?.params
  const height = Array.isArray(params) ? params[0]?.height : data?.height
  return Number.isFinite(height) && height > 0 && height < 5000 ? height : null
}
if (embeds.length)
  addEventListener('message', (event) => {
    const frame = embeds.find((embed) => embed.contentWindow === event.source)
    if (!frame || event.origin !== new URL(frame.src).origin) return
    let data = event.data
    if (typeof data === 'string') {
      try {
        data = JSON.parse(data)
      } catch {
        return
      }
    }
    const height = reportedHeight(data)
    if (height !== null) frame.style.height = `${Math.ceil(height)}px`
  })
// A reader who follows a deck's link to another deck: the deck's frame loads
// the service's own page, which asks to open the path. Only the frame of the
// deck this page is about may ask, from this origin, and only for a share
// path. The decks shown small under it are other authors' and run without
// the reader choosing them, so a request from one of those is not followed.
const deckFrames = (root) => root.querySelectorAll('iframe[data-deck]')
const frameOrigin = (frame) => new URL(frame.src || 'about:blank').origin
// Only origins of frames present when this document loaded are known to fit its CSP.
const initialFrameOrigins = new Set(
  Array.from(document.querySelectorAll('iframe'), frameOrigin),
)
const SHARE_PATH =
  /^\/@[a-z0-9][a-z0-9-]{0,38}\/[a-z0-9][a-z0-9-]{0,63}(?:\/[1-9][0-9]{0,3})?$/
// A viewer always starts its frames on decks. Going back, some browsers
// bring a frame up on the service's page instead: by restoring this page
// as it was when the reader left, or by loading the frame from history. That
// is a return to the deck, not the link followed again. So a request counts
// only after the deck has loaded in the frame, and each load allows one; any
// other request loads the deck again in the frame's place.
// A frame's location is readable only while it is on this origin.
function onServicePage(frame) {
  try {
    return frame.contentWindow?.location.origin === location.origin
  } catch {
    return false
  }
}
// A frame whose location cannot be read has left this origin for a deck.
function onDeck(frame) {
  try {
    void frame.contentWindow.location.href
    return false
  } catch {
    return true
  }
}
const shown = new WeakSet()
function deckLoaded(event) {
  // The service's page may finish loading before its request arrives.
  const frame = event.currentTarget
  if (!onServicePage(frame)) shown.add(frame)
}
function registerDeck(frame) {
  // This script may start after a deck has loaded, and would miss its load.
  if (onDeck(frame)) shown.add(frame)
  frame.addEventListener('load', deckLoaded)
}
function unregisterDeck(frame) {
  frame.removeEventListener('load', deckLoaded)
  shown.delete(frame)
  putBack.delete(frame)
}
function restoreDeck(frame) {
  if (onServicePage(frame)) frame.contentWindow.location.replace(frame.src)
}
addEventListener('pageshow', () => deckFrames(document).forEach(restoreDeck))
// A request that is not followed puts the deck back once. A deck that sends
// its frame away again by itself is left there, not loaded in a loop.
const putBack = new WeakSet()
function refuse(frame) {
  if (putBack.has(frame)) return
  putBack.add(frame)
  restoreDeck(frame)
}
addEventListener('message', (event) => {
  if (event.origin !== location.origin || event.data?.type !== 'slide:open')
    return
  const frame = Array.from(deckFrames(document)).find(
    (deck) => deck.contentWindow === event.source,
  )
  if (!frame) return
  if (frame.id !== 'deck' || !shown.has(frame)) return refuse(frame)
  const path = event.data.path
  if (typeof path !== 'string' || !SHARE_PATH.test(path)) return
  shown.delete(frame)
  location.assign(path)
})
// The slides tell which page they show, when their author added the script
// for it. The address and the URL to copy follow, so what the reader shares
// opens on the page they were looking at. Only the frame of the slides this
// page is about is heard, from the origin it was given.
const main = document.querySelector('iframe#deck[data-share]')
if (main) {
  const origin = new URL(main.src).origin
  addEventListener('message', (event) => {
    if (event.source !== main.contentWindow || event.origin !== origin) return
    if (event.data?.type !== 'slide:page') return
    const page = event.data.page
    if (!Number.isInteger(page) || page < 1 || page > 9999) return
    const path =
      page === 1 ? main.dataset.share : `${main.dataset.share}/${page}`
    const shareUrl = document.getElementById('share-url')
    if (shareUrl) shareUrl.value = new URL(path, shareUrl.value).href
    // Confirming an action should return to the page the reader last saw.
    for (const link of document.querySelectorAll('a[data-slide-return]'))
      updateSlideReturn(link, path)
    // Some browsers refuse when slides turn pages faster than they allow.
    try {
      history.replaceState(history.state, '', path + location.search)
    } catch {}
  })
  // What the slides told before this script was listening is asked again.
  main.contentWindow?.postMessage({ type: 'slide:page-request' }, origin)
}
function updateSlideReturn(link, path) {
  const url = new URL(link.dataset.muteHref ?? link.href, location.href)
  url.searchParams.set('slide', path)
  const href = url.pathname + url.search
  // While muted the live link goes to settings. Keep the mute fallback current.
  if (link.hasAttribute('data-mute-href')) link.dataset.muteHref = href
  if (link.dataset.muted !== 'true') link.href = href
}

const followLink = document.querySelector('a[data-follow-handle]')
const muteLink = document.querySelector('a[data-mute-handle]')

function showFollowing(following) {
  const data = followLink.dataset
  data.following = String(following)
  followLink.textContent = following ? data.followingLabel : data.followLabel
  followLink.title = following ? data.releaseLabel : data.followLabel
  followLink.setAttribute('aria-label', followLink.title)
}

function showMuted(muted, result) {
  const data = muteLink.dataset
  data.muted = String(muted)
  muteLink.href = muted ? data.releaseHref : data.muteHref
  muteLink.textContent = muted ? data.releaseLabel : data.muteLabel
  muteLink.title = muted ? data.releaseName : data.muteEffect
  muteLink.setAttribute('aria-label', muted ? data.releaseName : data.muteLabel)
  muteLink.parentElement.querySelector('[data-mute-status]').hidden = !muted
  // A mute removes the follow; a release reports the follow that is stored.
  showFollowing(!muted && result.following === true)
  followLink.hidden = muted
}

// A mute removes a follow, so only one of the two requests can be in flight.
let pendingToggle = null
function clearPendingToggle() {
  pendingToggle?.removeAttribute('aria-busy')
  pendingToggle = null
}

async function postAuthorChange(path, form) {
  try {
    const response = await fetch(path, {
      method: 'POST',
      credentials: 'same-origin',
      redirect: 'error',
      headers: { Accept: 'application/json' },
      body: form,
    })
    return response.status === 200 ? await response.json() : null
  } catch {
    return null
  }
}

function bindAuthorToggle(link, field, collection, render) {
  link?.addEventListener('click', async (event) => {
    if (
      event.button !== 0 ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey
    )
      return
    event.preventDefault()
    if (pendingToggle) return
    pendingToggle = link
    link.setAttribute('aria-busy', 'true')
    link.focus()
    const wanted = link.dataset[field] !== 'true'
    const form = new URL(link.dataset.muteHref ?? link.href, location.href)
      .searchParams
    const path = wanted
      ? collection
      : `${collection}/${form.get('handle')}/release`
    const result = await postAuthorChange(path, form)
    if (result?.[field] !== wanted) {
      location.assign(link.href)
      return
    }
    if (field === 'muted' && !(await refreshReaderLists())) {
      reopenViewer()
      return
    }
    render(wanted, result)
    clearPendingToggle()
  })
}

bindAuthorToggle(followLink, 'following', '/follows', showFollowing)
bindAuthorToggle(muteLink, 'muted', '/mutes', showMuted)
addEventListener('pageshow', (event) => {
  if (event.persisted) clearPendingToggle()
})
// Shows the deck alone. Hidden where the browser cannot do it.
for (const button of document.querySelectorAll('[data-fullscreen]')) {
  const target = document.getElementById(button.dataset.fullscreen)
  if (!target?.requestFullscreen || !document.fullscreenEnabled) continue
  button.hidden = false
  button.addEventListener('click', async () => {
    await target.requestFullscreen().catch(() => {})
    target.focus()
  })
}
// A deck shown small is drawn at a full slide's size and scaled to fit, so
// it looks as it does on a large screen. Without this script the frame is
// simply as small as its box.
const MINI_WIDTH = 1280
const MINI_HEIGHT = 720
const fitMini = (box) => {
  const frame = box.querySelector('iframe')
  if (!frame) return
  frame.style.width = `${MINI_WIDTH}px`
  frame.style.height = `${MINI_HEIGHT}px`
  frame.style.transform = `scale(${box.clientWidth / MINI_WIDTH})`
}
const miniObserver =
  typeof ResizeObserver === 'function'
    ? new ResizeObserver((entries) => {
        for (const entry of entries) fitMini(entry.target)
      })
    : null

function registerFrames(root) {
  for (const frame of deckFrames(root)) registerDeck(frame)
  for (const box of root.querySelectorAll('[data-mini]'))
    miniObserver?.observe(box)
}
registerFrames(document)

function replaceReaderList(current, fresh) {
  for (const frame of deckFrames(current)) unregisterDeck(frame)
  for (const box of current.querySelectorAll('[data-mini]'))
    miniObserver?.unobserve(box)
  current.replaceWith(document.adoptNode(fresh))
  registerFrames(fresh)
}

const readerListNames = ['cites', 'cited-by']
function readerLists(page) {
  const wrappers = page.querySelectorAll('[data-reader-lists]')
  if (wrappers.length !== readerListNames.length)
    throw new Error('Unexpected reader lists')
  return readerListNames.map((name) => {
    const wrapper = page.querySelector(`[data-reader-lists="${name}"]`)
    if (!wrapper) throw new Error('Missing reader list')
    return wrapper
  })
}

// Reopen only when the list fetch fails, its status is not 200, or a wrapper
// is missing. This can lose the deck's position, but recovers the saved lists.
// Firefox restores frames by position on reload; replace starts each one fresh.
function reopenViewer() {
  // With a fragment in the address, going to it again would only scroll.
  const url = new URL(location.href)
  url.hash = ''
  if (location.hash) history.replaceState(history.state, '', url)
  location.replace(url)
}

function replaceUnseenFrame(frame) {
  const box = frame.closest('.mini')
  box?.removeAttribute('data-mini')
  const cover = box?.dataset.cover
  if (!cover) {
    frame.remove()
    return
  }
  const image = frame.ownerDocument.createElement('img')
  image.alt = frame.title
  image.addEventListener(
    'error',
    () => {
      image.hidden = true
    },
    { once: true },
  )
  image.src = cover
  frame.replaceWith(image)
}

async function refreshReaderLists() {
  let current, fresh
  try {
    const response = await fetch(location.href, {
      credentials: 'same-origin',
      headers: { Accept: 'text/html' },
      cache: 'no-store',
    })
    if (response.status !== 200) return false
    const page = new DOMParser().parseFromString(
      await response.text(),
      'text/html',
    )
    current = readerLists(document)
    fresh = readerLists(page)
  } catch {
    return false
  }
  // Prepare every detached list before any new frame enters the viewer.
  for (const wrapper of fresh) {
    for (const frame of wrapper.querySelectorAll('iframe')) {
      if (!initialFrameOrigins.has(frameOrigin(frame)))
        replaceUnseenFrame(frame)
    }
  }
  fresh.forEach((wrapper, index) => replaceReaderList(current[index], wrapper))
  return true
}
