import { Hono } from 'hono'
import { csrf } from 'hono/csrf'
import { currentOwner } from '../auth/owner-middleware'
import { accountTitles, renderPage, signInPrompt } from '../decks/pages'
import { NEW_COMMUNITY_PATH } from '../events/event-page'
import { profilePath } from '../share/path'
import { COMMUNITY_COLORS } from '../site/cover-pattern'
import { langOf } from '../site/lang'
import {
  readNewCommunityForm,
  withSaveProblem,
  type FormBody,
} from './new-form'
import {
  emptyNewCommunityForm,
  newCommunityBody,
  newCommunityTitle,
  type NewCommunityForm,
} from './new-page'
import { createCommunity } from './store'
import { readNewCalendarsSoon, waitUntilOf } from '../feeds/reader-routes'

/** The forms that make communities. */
export const communityForms = new Hono<{ Bindings: Env }>()

/** A community's number: a random positive integer that fits a double. */
function randomCommunityId(): number {
  const [high = 0, low = 0] = crypto.getRandomValues(new Uint32Array(2))
  // 21 bits and 32 bits: at most 2^53 - 1, and never 0.
  return (high & 0x1fffff) * 2 ** 32 + low || 1
}

/** One of the five colors, picked at random (D-45). */
function randomColor() {
  const [value = 0] = crypto.getRandomValues(new Uint32Array(1))
  return COMMUNITY_COLORS[value % COMMUNITY_COLORS.length] ?? 'red'
}

/** The longest group page carried over from an event's page. */
const CARRIED_LINK_MAX = 300

const now = () => Math.floor(Date.now() / 1000)

/**
 * The page that makes a community. Someone not signed in is sent to sign
 * in (F30-AC10). From an event's page, the group's page comes along as the
 * first link (F30-AC40).
 */
communityForms.get(NEW_COMMUNITY_PATH, async (c) => {
  const owner = await currentOwner(c)
  if (!owner) return c.redirect('/login', 303)
  const link = c.req.query('link') ?? ''
  const lang = langOf(c)
  return renderPage(
    c,
    newCommunityTitle(lang),
    newCommunityBody(
      emptyNewCommunityForm(link.length <= CARRIED_LINK_MAX ? link.trim() : ''),
      lang,
    ),
    200,
    undefined,
    'narrow',
  )
})

/**
 * Makes a community (F30-AC9): the one who sends the form is its first
 * admin, and goes to its page. A row added or removed draws the form again;
 * a refused field says why under it and keeps what was typed.
 */
communityForms.post(NEW_COMMUNITY_PATH, csrf(), async (c) => {
  const owner = await currentOwner(c)
  const lang = langOf(c)
  if (!owner)
    return renderPage(
      c,
      accountTitles(lang).signInTitle,
      signInPrompt(lang),
      401,
    )
  const show = (form: NewCommunityForm, status: 200 | 400 | 409) =>
    renderPage(
      c,
      newCommunityTitle(lang),
      newCommunityBody(form, lang),
      status,
      undefined,
      'narrow',
    )
  const read = readNewCommunityForm(
    (await c.req.parseBody({ all: true })) as FormBody,
  )
  if (read.kind === 'edited') return show(read.form, 200)
  if (read.kind === 'refused') return show(read.form, 400)
  const id = randomCommunityId()
  const at = now()
  const result = await createCommunity(c.env.DB, {
    id,
    handle: read.handle,
    name: read.name,
    color: randomColor(),
    links: read.links,
    creator: owner.userId,
    now: at,
  })
  if (result.kind === 'created') {
    await readNewCalendarsSoon(c.env, waitUntilOf(c), id, at)
    return c.redirect(profilePath(read.handle), 303)
  }
  return show(
    withSaveProblem(
      read.form,
      result.kind === 'handle'
        ? { kind: 'handle', reason: result.reason }
        : { kind: 'links', owners: result.conflicts },
    ),
    409,
  )
})
