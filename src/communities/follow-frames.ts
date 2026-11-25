import { html } from 'hono/html'
import { followButton, type FollowState } from '../follows/pages'
import { peopleListBody } from '../follows/people-pages'
import type { PeopleReader } from '../follows/people'
import type { Person } from '../follows/store'
import type { Handle } from '../share/handle'
import { peoplePath } from '../share/path'
import { messages, type Lang } from '../site/i18n'
import { loginPrompt } from '../site/login-prompt'

/** Where the forms that follow and unfollow a community are sent. */
export const COMMUNITY_FOLLOW_PATH = '/communities/follows'
export const COMMUNITY_RELEASE_PATH = '/communities/follows/release'

const text = messages({
  ja: {
    followOf: (name: string) => `${name} をフォローする`,
    releaseOf: (name: string) => `${name} のフォローを解除する`,
  },
  en: {
    followOf: (name: string) => `Follow ${name}`,
    releaseOf: (name: string) => `Unfollow ${name}`,
  },
})

/** What a reader can do about a community: as about a person (FollowState). */
export const communityFollowState = (
  viewer: string | null,
  following: boolean,
): FollowState =>
  viewer === null ? 'signed-out' : following ? 'following' : 'can-follow'

/**
 * The button that follows or unfollows a community at once (F31-AC1), the
 * same white pill as the person's follow button. `back` is the page it sits
 * on, where the reader returns. A reader who is not signed in gets the
 * sign-in prompt, and nothing is sent (F31-AC2); without scripts the link
 * leads to the sign-in, which returns to `back`.
 */
export function communityFollowForm(
  state: FollowState,
  community: Readonly<{ handle: Handle; name: string }>,
  back: string,
  lang: Lang,
) {
  const fields = { handle: community.handle, back }
  return followButton(
    state,
    {
      signIn: `/login?to=${encodeURIComponent(back)}`,
      follow: { action: COMMUNITY_FOLLOW_PATH, fields },
      release: { action: COMMUNITY_RELEASE_PATH, fields },
      followName: text[lang].followOf(community.name),
      releaseName: text[lang].releaseOf(community.name),
      prompt: 'follow-community',
    },
    lang,
  )
}

/**
 * "Follow" in the head of a community's page, with the sign-in prompt it
 * opens for a reader who is not signed in.
 */
export const communityFollowFrame = (
  input: Readonly<{
    state: FollowState
    handle: Handle
    name: string
    /** The page the button sits on. */
    back: string
  }>,
  lang: Lang,
) =>
  html`${
    input.state === 'signed-out'
      ? loginPrompt('follow-community', input.back, lang)
      : ''
  }${communityFollowForm(input.state, input, input.back, lang)}`

/**
 * The followers tab of a community's page (F31-AC10): its followers as a
 * person's followers are listed, the newest follow first, each with the
 * button that follows that person.
 */
export const communityFollowersFrame = (
  list: Readonly<{
    handle: Handle
    people: readonly Person[]
    page: number
    total: number
    reader: PeopleReader
  }>,
  lang: Lang,
) =>
  html`${
      list.reader.kind === 'signed-out'
        ? loginPrompt('follow', peoplePath(list.handle, 'followers'), lang)
        : ''
    }
    <section class="people">
      ${peopleListBody({ ...list, list: 'followers' }, lang)}
    </section>`
