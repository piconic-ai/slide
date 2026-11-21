// The header's account area starts empty. Ask who is signed in, then put
// the way in, or the bell and their icon,
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
    return [bell, menu]
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
  // Set while signing out is being sent, and from then on once it worked.
  let signingOut = false
  const answer = fetch('/api/session', { credentials: 'same-origin' }).then(
    (response) => {
      if (!response.ok) throw new Error(`session answered ${response.status}`)
      return response.json()
    },
  )
  // The page asks who is signed in once. Another script of the page that
  // needs to know, such as the drop zone's, reads the same answer here;
  // null stands for no answer.
  window.slideSession = answer.catch(() => null)
  answer
    .then((session) => {
      // An answer from before the sign-out would bring the author back.
      if (signingOut) return
      draw(session)
      try {
        localStorage.setItem(KEPT, JSON.stringify(session))
      } catch {}
    })
    // No answer, or a refusal such as 429.
    .catch(() => {
      if (drawn === null) draw(null)
    })
  // Signing out is sent by this script, not as a form: the viewer, the
  // help, the legal and the error pages let no form be sent. The form stays
  // for where no script runs. What this browser kept of the session is
  // forgotten only once the session has ended, so a failed attempt leaves
  // the author shown as they still are: signed in. The page is then read
  // again, as a visitor. The page's own question about the session may
  // still be unanswered when signing out is pressed, as the icon is drawn
  // from the last visit; its answer is then left unused.
  const forget = () => {
    try {
      localStorage.removeItem(KEPT)
    } catch {}
  }
  const signOut = async (form) => {
    if (signingOut) return
    signingOut = true
    try {
      const response = await fetch(form.action, {
        method: 'POST',
        credentials: 'same-origin',
        // The answer is a redirect to the top page; it is not followed.
        redirect: 'manual',
        body: new URLSearchParams(),
      })
      if (!response.ok && response.type !== 'opaqueredirect')
        throw new Error(`sign-out answered ${response.status}`)
      forget()
      location.reload()
    } catch {
      signingOut = false
    }
  }
  document.addEventListener('submit', (event) => {
    const action = event.target.getAttribute?.('action')
    if (action === '/auth/logout') {
      event.preventDefault()
      signOut(event.target)
    }
    // Leaving the service is a form of its own page; its answer is the top
    // page, drawn for a visitor.
    if (action === '/account/delete') forget()
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
// A press inside the slides never reaches this page: the frame is another
// origin's. The window loses focus to the frame instead, which is taken as
// the press outside that closes an open menu. Losing focus to another window
// leaves the frame unfocused and the menus as they are. Firefox names the
// frame as the active element only after the event, hence the next task.
addEventListener('blur', () => {
  setTimeout(() => {
    if (!(document.activeElement instanceof HTMLIFrameElement)) return
    for (const menu of document.querySelectorAll('details[data-menu][open]'))
      menu.open = false
  }, 0)
})
// What binds to a page's own markup is bound by a function given a root:
// the document, for a page loaded whole, and again, by the router
// (/components/assets/router.js), for the markup a move between pages puts
// in the frame. Listeners on the document or the window are set once, above
// and below, and look up what they need when they run, so a page moved to
// needs none of them again. An element is bound once, however many times
// its root is bound.
const bindings = []
const unseen = () => {
  const seen = new WeakSet()
  return (element) => !seen.has(element) && Boolean(seen.add(element))
}
window.slidePage = {
  // Binds the page on screen now, and the markup of each move after.
  onMount(bind) {
    bindings.push(bind)
    bind(document)
  },
  mount(region) {
    for (const bind of bindings) bind(region)
  },
}
// The language switcher in the footer stays through a move between pages,
// so it is pointed at the page now on screen when it is used. Without
// scripts its links already name the page they were drawn for.
document.addEventListener(
  'click',
  (event) => {
    const link = event.target.closest?.('a[hreflang]')
    if (!link || !link.closest('.site-footer')) return
    const url = new URL(location.href)
    url.searchParams.set('lang', link.getAttribute('hreflang'))
    link.href = url.pathname + url.search
  },
  true,
)
// Copies the value of the input that a [data-copy] button names, then shows
// the button's data-copied text, worded in the page's language, for two
// seconds. The same text goes to the status line the button names in
// data-copy-status, which a screen reader reads out. Where the clipboard is
// unavailable, the value is selected for a manual copy; a field kept hidden
// until then is shown.
// Each status line empties two seconds after it was last written, whichever
// button wrote it, so the same words are read out again on the next copy.
const statusTimers = new WeakMap()
function say(status, words) {
  status.textContent = words
  clearTimeout(statusTimers.get(status))
  statusTimers.set(
    status,
    setTimeout(() => {
      status.textContent = ''
    }, 2000),
  )
}
const newCopyButton = unseen()
function bindCopyButtons(root) {
  for (const button of root.querySelectorAll('[data-copy]')) {
    if (!newCopyButton(button)) continue
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
        const status = document.getElementById(button.dataset.copyStatus ?? '')
        if (status) say(status, button.dataset.copied)
      } catch {
        // Refused, or no clipboard here: the value is left selected to copy by hand.
        input.hidden = false
        input.focus()
        input.select()
      }
    })
  }
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
function hideBrokenCovers(root) {
  for (const image of root.querySelectorAll('img[data-cover]'))
    if (image.complete && image.naturalWidth === 0) image.hidden = true
}
// Keyboard navigation of a deck works once its frame has focus.
// iOS Safari sends touches into a cross-origin frame only where it finds a
// touch listener, and it does not count the frame's own window or document
// listeners. A deck that pages on window touch events then never moves. An
// empty listener on the frame element marks its area as handling touches.
const newAutofocusFrame = unseen()
function focusDeckFrame(root) {
  const frame = root.querySelector('iframe[data-autofocus]')
  if (!frame) return
  frame.focus()
  if (newAutofocusFrame(frame))
    frame.addEventListener('touchstart', () => {}, { passive: true })
}
// A reader who follows a deck's link to another deck: the deck's frame loads
// the service's own page, which asks to open the path. Only the frame of the
// deck this page is about may ask, from this origin, and only for a share
// path.
// Slides only their author may open start from a form that posts a one-time
// token to the slides' own origin, into the frame; see viewerPage.
// When the form was sent, for the page on screen; 0 where there is none.
let launchedAt = 0
const newLaunch = unseen()
function launchOwnerSlides(root) {
  for (const form of root.querySelectorAll('form[data-launch]')) {
    if (!newLaunch(form)) continue
    launchedAt = Date.now()
    form.submit()
  }
}
// A form that publishes is sent once: a second press would be refused.
const newOnceForm = unseen()
function sendOnce(root) {
  for (const form of root.querySelectorAll('form'))
    if (form.querySelector('button[data-once]') && newOnceForm(form))
      form.addEventListener('submit', () => {
        setTimeout(() => {
          for (const button of form.querySelectorAll('button'))
            button.disabled = true
        })
      })
}
// That session lasts five minutes and is not renewed. Shown again after
// that, the page is made again, which opens the slides with a new token.
const reopenIfOld = () => {
  if (
    launchedAt > 0 &&
    document.querySelector('form[data-launch]') &&
    document.visibilityState === 'visible' &&
    Date.now() - launchedAt > 240000
  )
    location.reload()
}
document.addEventListener('visibilitychange', reopenIfOld)
addEventListener('pageshow', (event) => event.persisted && reopenIfOld())
const deckFrames = (root) => root.querySelectorAll('iframe[data-deck]')
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
const newDeckFrame = unseen()
function registerDecks(root) {
  for (const frame of deckFrames(root)) {
    if (!newDeckFrame(frame)) continue
    // This script may start after a deck has loaded, and would miss its load.
    if (onDeck(frame)) shown.add(frame)
    frame.addEventListener('load', deckLoaded)
  }
}
function restoreDeck(frame) {
  // A frame with no address was opened by a form, whose token is used up.
  if (frame.hasAttribute('src') && onServicePage(frame))
    frame.contentWindow.location.replace(frame.src)
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
// for it. The address, the page's URL to copy and the post links follow, so
// what the reader shares opens on the page they were looking at. The URL of
// the slides as a whole stays as it is. Only the frame of the slides this
// page is about is heard, from the origin it was given. The frame is looked
// up when a message arrives, so one listener serves every viewer the page
// shows, one after another.
const slidesFrame = () => document.querySelector('iframe#deck[data-share]')
const slidesOrigin = (main) => new URL(main.dataset.origin ?? main.src).origin
addEventListener('message', (event) => {
  const main = slidesFrame()
  if (!main) return
  if (event.source !== main.contentWindow) return
  if (event.origin !== slidesOrigin(main)) return
  if (event.data?.type !== 'slide:page') return
  const page = event.data.page
  if (!Number.isInteger(page) || page < 1 || page > 9999) return
  const path = page === 1 ? main.dataset.share : `${main.dataset.share}/${page}`
  sharePage(path)
  // Confirming an action should return to the page the reader last saw.
  for (const link of document.querySelectorAll('a[data-slide-return]'))
    updateSlideReturn(link, path)
  // Some browsers refuse when slides turn pages faster than they allow.
  try {
    history.replaceState(history.state, '', path + location.search)
  } catch {}
})
// A frame that could not show owner-only slides says so, by the notice
// above the slides.
addEventListener('message', (event) => {
  const main = slidesFrame()
  if (!main) return
  if (event.source !== main.contentWindow) return
  if (event.origin !== slidesOrigin(main)) return
  if (event.data?.type !== 'slide:preview-unavailable') return
  // The slides' own page may send this too; all it can do is show the
  // author this notice, so only the two known reasons are read.
  // A frame session lasts five minutes and the browser drops its cookie
  // then too, so a frame that finds no cookie after that has not met a
  // browser that keeps none: its time ran out.
  const ran = launchedAt > 0 && Date.now() - launchedAt > 300000
  const reason =
    event.data.reason === 'expired' || ran ? 'expired' : 'unsupported'
  for (const notice of document.querySelectorAll(
    '[data-preview-unavailable]',
  )) {
    notice.hidden = false
    for (const line of notice.querySelectorAll('[data-reason]'))
      line.hidden = line.dataset.reason !== reason
  }
})
// What the slides told before this script was listening is asked again.
const newSlidesFrame = unseen()
function askSlidesPage(root) {
  const main = root.querySelector('iframe#deck[data-share]')
  if (main && newSlidesFrame(main))
    main.contentWindow?.postMessage(
      { type: 'slide:page-request' },
      slidesOrigin(main),
    )
}
// The share menu learns the page on screen: its URL can now be copied, and
// a post carries it. Slides that never tell a page leave that item hidden
// and the posts on the URL of the slides.
function sharePage(path) {
  const pageUrl = document.getElementById('share-page-url')
  if (!pageUrl) return
  pageUrl.value = new URL(path, pageUrl.value).href
  for (const item of document.querySelectorAll('[data-share-page]'))
    item.hidden = false
  for (const link of document.querySelectorAll('a[data-share-post]'))
    link.href = link.dataset.sharePost + encodeURIComponent(pageUrl.value)
}
// Hands the title and the URL of the page on screen to the system's share
// sheet. Hidden where the browser has none. A reader who closes the sheet
// without choosing has done nothing wrong, so its refusal is not reported.
const newShareButton = unseen()
function bindNativeShare(root) {
  for (const button of root.querySelectorAll('[data-share-native]')) {
    if (typeof navigator.share !== 'function' || !newShareButton(button))
      continue
    button.hidden = false
    button.addEventListener('click', () => {
      const url = document.getElementById('share-page-url')?.value
      if (!url) return
      navigator.share({ title: button.dataset.shareTitle, url }).catch(() => {})
    })
  }
}
function updateSlideReturn(link, path) {
  const url = new URL(link.dataset.muteHref ?? link.href, location.href)
  url.searchParams.set('slide', path)
  const href = url.pathname + url.search
  // While muted the live link goes to settings. Keep the mute fallback current.
  if (link.hasAttribute('data-mute-href')) link.dataset.muteHref = href
  if (link.dataset.muted !== 'true') link.href = href
}

function showFollowing(link, following) {
  const data = link.dataset
  data.following = String(following)
  link.textContent = following ? data.followingLabel : data.followLabel
  link.title = following ? data.releaseLabel : data.followLabel
  link.setAttribute('aria-label', link.title)
}

function showMuted(link, muted, result) {
  const data = link.dataset
  data.muted = String(muted)
  link.href = muted ? data.releaseHref : data.muteHref
  link.textContent = muted ? data.releaseLabel : data.muteLabel
  link.title = muted ? data.releaseName : data.muteEffect
  link.setAttribute('aria-label', muted ? data.releaseName : data.muteLabel)
  link.parentElement.querySelector('[data-mute-status]').hidden = !muted
  // A mute removes the follow; a release reports the follow that is stored.
  const follow = document.querySelector('a[data-follow-handle]')
  if (!follow) return
  showFollowing(follow, !muted && result.following === true)
  follow.hidden = muted
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
  link.addEventListener('click', async (event) => {
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
    render(link, wanted, result)
    clearPendingToggle()
  })
}

const newFollowLink = unseen()
const newMuteLink = unseen()
function bindAuthorLinks(root) {
  const follow = root.querySelector('a[data-follow-handle]')
  if (follow && newFollowLink(follow))
    bindAuthorToggle(follow, 'following', '/follows', showFollowing)
  const mute = root.querySelector('a[data-mute-handle]')
  if (mute && newMuteLink(mute))
    bindAuthorToggle(mute, 'muted', '/mutes', showMuted)
}
addEventListener('pageshow', (event) => {
  if (event.persisted) clearPendingToggle()
})
// A link that asks for a sign-in (data-login-prompt="follow", "mute",
// "report") opens a modal built from the page's own template of that kind,
// instead of being followed. The template holds the words and the way to
// sign in; nothing is sent and the server is not asked. Opening moves the
// focus into the modal, stops the page behind it from scrolling and from
// taking focus; Esc, the close button and a press on the backdrop close it,
// and the focus returns to what opened it (the menu's summary when the link
// sat in a menu, which closes). Tab goes round inside the modal. A link
// pressed with a modifier, or without scripts, is followed as before: it leads
// to the page that asks for the sign-in. One listener on the document serves
// every page the router shows.
let loginPrompt = null
const promptFocusables = (dialog) =>
  dialog.querySelectorAll('a[href], button:not([disabled])')
function closeLoginPrompt() {
  if (!loginPrompt) return
  const { dialog, opener, inerted, overflow } = loginPrompt
  loginPrompt = null
  dialog.remove()
  for (const element of inerted) element.inert = false
  document.body.style.overflow = overflow
  opener.focus()
}
function openLoginPrompt(trigger) {
  const template = document.querySelector(
    `template[data-login-prompt-for="${trigger.dataset.loginPrompt}"]`,
  )
  const dialog = template?.content.firstElementChild?.cloneNode(true)
  if (!dialog || loginPrompt) return false
  // A viewer's links follow the page on screen (see updateSlideReturn), so
  // the way back from signing in is that page, not the one first loaded.
  const slide = new URL(trigger.href, location.href).searchParams.get('slide')
  const signIn = dialog.querySelector('a[href^="/auth/github?to="]')
  if (slide && signIn)
    signIn.href = `/auth/github?to=${encodeURIComponent(slide)}`
  const menu = trigger.closest('details[data-menu]')
  const opener = menu?.querySelector('summary') ?? trigger
  if (menu) menu.open = false
  document.body.append(dialog)
  const inerted = [...document.body.children].filter(
    (element) => element !== dialog && !element.inert,
  )
  for (const element of inerted) element.inert = true
  const overflow = document.body.style.overflow
  document.body.style.overflow = 'hidden'
  loginPrompt = { dialog, opener, inerted, overflow }
  // Only a press that began on the backdrop and ended on it closes: a drag
  // from the panel out onto the backdrop does not.
  let pressedBackdrop = false
  dialog.addEventListener('pointerdown', (event) => {
    pressedBackdrop = event.target === dialog
  })
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog && pressedBackdrop) closeLoginPrompt()
    pressedBackdrop = false
  })
  dialog
    .querySelector('[data-login-prompt-close]')
    ?.addEventListener('click', closeLoginPrompt)
  promptFocusables(dialog)[0]?.focus()
  return true
}
document.addEventListener('click', (event) => {
  const trigger = event.target.closest?.('a[data-login-prompt]')
  if (
    !trigger ||
    event.button !== 0 ||
    event.altKey ||
    event.ctrlKey ||
    event.metaKey ||
    event.shiftKey
  )
    return
  if (openLoginPrompt(trigger)) event.preventDefault()
})
document.addEventListener(
  'keydown',
  (event) => {
    if (!loginPrompt) return
    if (event.key === 'Escape') {
      event.preventDefault()
      closeLoginPrompt()
    }
    if (event.key !== 'Tab') return
    const items = [...promptFocusables(loginPrompt.dialog)]
    const first = items[0]
    const last = items[items.length - 1]
    const active = document.activeElement
    if (event.shiftKey ? active === first : active === last) {
      event.preventDefault()
      ;(event.shiftKey ? last : first).focus()
    } else if (!loginPrompt.dialog.contains(active)) {
      event.preventDefault()
      first.focus()
    }
  },
  true,
)
// Shows the deck alone. Hidden where the browser cannot do it.
const newFullscreenButton = unseen()
function bindFullscreen(root) {
  for (const button of root.querySelectorAll('[data-fullscreen]')) {
    const target = document.getElementById(button.dataset.fullscreen)
    if (!target?.requestFullscreen || !document.fullscreenEnabled) continue
    if (!newFullscreenButton(button)) continue
    button.hidden = false
    button.addEventListener('click', async () => {
      await target.requestFullscreen().catch(() => {})
      target.focus()
    })
  }
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

// The viewer shows the decks on either side of a citation as cover cards.
// After a mute or a release it fetches the page again, as this reader is
// answered now, and puts the two lists in the places of the ones shown. The
// slides and the menus stay as they are. The lists hold links and pictures
// alone; a frame in what was fetched is dropped, never run.
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
  for (const wrapper of fresh)
    for (const frame of wrapper.querySelectorAll('iframe')) frame.remove()
  fresh.forEach((wrapper, index) =>
    current[index].replaceWith(document.adoptNode(wrapper)),
  )
  return true
}

// Binds the page loaded whole, and each page moved to; see the top of this part.
// The order is the order the page's own script ran in before.
for (const bind of [
  bindCopyButtons,
  hideBrokenCovers,
  focusDeckFrame,
  launchOwnerSlides,
  sendOnce,
  registerDecks,
  askSlidesPage,
  bindNativeShare,
  bindAuthorLinks,
  bindFullscreen,
])
  window.slidePage.onMount(bind)
