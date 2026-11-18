// The header's account area starts empty. Ask who is signed in, then put
// the way in, or a button to add slides beside the author's icon, which
// opens their menu. The last answer is kept in this browser and drawn at
// once on the next page, so the area does not blink in on every visit; the
// fresh answer then corrects it. When no answer comes, what is drawn stays,
// and a first visit gets the way in: it sends a signed-in author on.
const account = document.querySelector('[data-account]')
if (account) {
  const KEPT = 'slide:session'
  const HANDLE = /^[a-z0-9][a-z0-9-]{0,38}$/
  // GitHub serves every profile picture here; the page policy allows no other.
  const AVATARS = 'https://avatars.githubusercontent.com/'
  const words = account.dataset
  const anchor = (href, text) => {
    const link = document.createElement('a')
    link.href = href
    link.textContent = text
    return link
  }
  const signedIn = (login, handle, avatar) => {
    // The plus is drawn by the stylesheet; the label names the link.
    const add = anchor('/slides/new', '')
    add.className = 'add'
    add.title = words.add
    add.setAttribute('aria-label', words.add)
    const menu = document.createElement('details')
    menu.className = 'menu'
    const icon = document.createElement('summary')
    icon.className = 'avatar'
    icon.textContent = login.slice(0, 1)
    icon.title = login
    // Their picture covers the initial, which shows again if it fails.
    if (avatar) {
      const picture = document.createElement('img')
      picture.alt = ''
      picture.referrerPolicy = 'no-referrer'
      picture.addEventListener('error', () => picture.remove())
      picture.src = avatar
      icon.append(picture)
    }
    icon.setAttribute('aria-label', `${words.menu} (${login})`)
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
    return [add, menu]
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
    const next = `${login}\n${handle}\n${avatar}`
    if (next === drawn) return
    drawn = next
    account.replaceChildren(
      ...(login
        ? signedIn(login, handle, avatar)
        : [anchor('/start', words.start)]),
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
  // The menu closes on a click outside it and on Escape.
  const openMenu = () => account.querySelector('details[open]')
  document.addEventListener('click', (event) => {
    const menu = openMenu()
    if (menu && !menu.contains(event.target)) menu.open = false
  })
  document.addEventListener('keydown', (event) => {
    const menu = openMenu()
    if (event.key !== 'Escape' || !menu) return
    menu.open = false
    menu.querySelector('summary')?.focus()
  })
}
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
const decks = [...document.querySelectorAll('iframe[data-deck]')]
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
for (const frame of decks) {
  // This script may start after a deck has loaded, and would miss its load.
  if (onDeck(frame)) shown.add(frame)
  frame.addEventListener('load', () => {
    // The service's page may finish loading before its request arrives, so
    // its load leaves the mark as it is.
    if (!onServicePage(frame)) shown.add(frame)
  })
}
function restoreDeck(frame) {
  if (onServicePage(frame)) frame.contentWindow.location.replace(frame.src)
}
addEventListener('pageshow', () => decks.forEach(restoreDeck))
// A request that is not followed puts the deck back once. A deck that sends
// its frame away again by itself is left there, not loaded in a loop.
const putBack = new WeakSet()
function refuse(frame) {
  if (putBack.has(frame)) return
  putBack.add(frame)
  restoreDeck(frame)
}
addEventListener('message', (event) => {
  const frame = decks.find((deck) => deck.contentWindow === event.source)
  if (!frame || event.origin !== location.origin) return
  if (event.data?.type !== 'slide:open') return
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
    for (const link of document.querySelectorAll('a[data-slide-return]')) {
      const url = new URL(link.href)
      url.searchParams.set('slide', path)
      link.href = url.pathname + url.search
    }
    // Some browsers refuse when slides turn pages faster than they allow.
    try {
      history.replaceState(history.state, '', path + location.search)
    } catch {}
  })
  // What the slides told before this script was listening is asked again.
  main.contentWindow?.postMessage({ type: 'slide:page-request' }, origin)
}
const followLink = document.querySelector('a[data-follow-handle]')
followLink?.addEventListener('click', async (event) => {
  if (
    event.button !== 0 ||
    event.altKey ||
    event.ctrlKey ||
    event.metaKey ||
    event.shiftKey
  )
    return
  event.preventDefault()
  if (followLink.hasAttribute('aria-busy')) return
  followLink.setAttribute('aria-busy', 'true')
  const data = followLink.dataset
  const handle = data.followHandle
  const path =
    data.following === 'true' ? `/follows/${handle}/release` : '/follows'
  try {
    const response = await fetch(path, {
      method: 'POST',
      credentials: 'same-origin',
      redirect: 'error',
      headers: { Accept: 'application/json' },
      body: new URL(followLink.href).searchParams,
    })
    const result = response.status === 200 ? await response.json() : null
    if (typeof result?.following === 'boolean') {
      data.following = String(result.following)
      followLink.textContent = result.following
        ? data.followingLabel
        : data.followLabel
      followLink.title = result.following ? data.releaseLabel : data.followLabel
      followLink.setAttribute('aria-label', followLink.title)
      return
    }
  } catch {
    // The confirmation page reads the current state if the reply was lost.
  } finally {
    followLink.removeAttribute('aria-busy')
  }
  location.assign(followLink.href)
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
if (typeof ResizeObserver === 'function') {
  const observer = new ResizeObserver((entries) => {
    for (const entry of entries) fitMini(entry.target)
  })
  for (const box of document.querySelectorAll('[data-mini]'))
    observer.observe(box)
}
