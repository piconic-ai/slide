import { html } from 'hono/html'
import { accountTitles } from '../decks/pages'
import { initialOf } from '../follows/people'
import { faceImage } from '../profile/face'
import type { Handle } from '../share/handle'
import { profilePath } from '../share/path'
import { helpLink } from '../site/help-content'
import { messages, type Lang } from '../site/i18n'

const text = messages({
  ja: {
    title: 'ブロック',
    heading: (name: string) => `${name}さんをブロックしますか`,
    effectsHeading: 'ブロックすると',
    effects: (name: string) => [
      `互いのフォローが外れ、ブロックしている間は、互いにフォローできなくなります。`,
      `${name}さんのスライドや記事にあなたのスライドへのリンクがあっても、あなたの画面には引用として出ず、お知らせも届きません(リンクを書くこと自体は止められません)。`,
      `同じコミュニティやイベントにいても、${name}さんのスライドはあなたに出ません。コミュニティのフォローは止まりません。`,
      `あなたには、${name}さんのスライドが一覧やおすすめに出なくなります。`,
      `公開中のスライドは、ログインしていない人と同じく見えます。ブロックしたことは、${name}さんには知らせません。`,
    ],
    submit: 'ブロックする',
    cancel: 'やめる',
    note: 'ブロックは、設定の「ブロックしている人」からいつでも解除できます。嫌がらせや規約に反する内容は、あわせて通報してください。',
    signIn: 'ブロックするには、ログインが必要です。',
    help: 'ブロックについてくわしく(ヘルプ)',
    back: '戻る',
    more: 'そのほかの操作',
    blockPerson: 'この人をブロック',
    blocking: 'ブロック中',
  },
  en: {
    title: 'Block',
    heading: (name: string) => `Block ${name}?`,
    effectsHeading: 'If you block them',
    effects: (name: string) => [
      `You stop following each other, and neither of you can follow the other while the block stays.`,
      `When ${name}’s slides or articles link to yours, you won’t see them as citations or get notified (the links themselves can’t be stopped).`,
      `Even in the same community or event, you won’t see ${name}’s slides. Community follows stay as they are.`,
      `${name}’s slides no longer appear in your lists or recommendations.`,
      `Their public slides still look to you as they do to anyone signed out. ${name} won’t be told that you blocked them.`,
    ],
    submit: 'Block',
    cancel: 'Cancel',
    note: 'You can unblock them at any time under People you blocked in settings. Report harassment or content against the terms as well.',
    signIn: 'Sign in to block this person.',
    help: 'More about blocking (help)',
    back: 'Go back',
    more: 'More actions',
    blockPerson: 'Block this person',
    blocking: 'Blocked',
  },
})

export const blockTitle = (lang: Lang) => text[lang].title

/** The person asked about, as the confirmation shows them. */
export type BlockTarget = Readonly<{
  handle: Handle
  name: string | null
  avatarUrl: string | null
}>

const person = (target: BlockTarget) =>
  html`<div class="block-person">
    <span class="person-face" aria-hidden="true"
      >${initialOf(target.name ?? target.handle)}${
        target.avatarUrl ? faceImage(target.avatarUrl) : ''
      }</span
    >
    <span class="person-names">
      <strong>${target.name ?? `@${target.handle}`}</strong>
      ${
        target.name === null
          ? ''
          : html`<span class="person-handle">@${target.handle}</span>`
      }
    </span>
  </div>`

/**
 * Asks whether to block `target`: what blocking does, then the button and
 * the way back to `back`, the page the reader came from.
 */
export function blockFormBody(target: BlockTarget, back: string, lang: Lang) {
  const t = text[lang]
  const name = target.name ?? `@${target.handle}`
  return html`<div class="block-confirm">
    <h1>${t.heading(name)}</h1>
    ${person(target)}
    <h2>${t.effectsHeading}</h2>
    <ul>
      ${t.effects(name).map((effect) => html`<li>${effect}</li>`)}
    </ul>
    <div class="block-actions">
      <form method="post" action="/blocks">
        <input type="hidden" name="handle" value="${target.handle}" />
        <input type="hidden" name="slide" value="${back}" />
        <button class="button-primary" type="submit">${t.submit}</button>
      </form>
      <a class="button-secondary" href="${back}">${t.cancel}</a>
    </div>
    <p class="field-note">${t.note}</p>
    <p class="field-note">${helpLink('block', t.help)}</p>
  </div>`
}

export function blockSignInBody(back: string, lang: Lang) {
  const t = text[lang]
  return html`<div class="block-confirm">
    <h1>${t.title}</h1>
    <p>${t.signIn}</p>
    <p>
      <a class="button-primary" href="/login?to=${encodeURIComponent(back)}"
        >${accountTitles(lang).signInLink}</a
      >
    </p>
    <p><a class="button-secondary" href="${back}">${t.back}</a></p>
  </div>`
}

/**
 * What the ⋯ menu of someone else's profile offers a signed-in, active
 * reader: a way to block them, or, while the reader blocks them, that they
 * do (D-70: it is undone in settings).
 */
export type ProfileBlock = 'none' | 'can-block' | 'blocking'

/**
 * The ⋯ menu of someone else's profile, for a signed-in, active reader:
 * blocking them, through the page that asks first, or, while blocking them,
 * the way to the list where it is undone.
 */
export function profileBlockMenu(
  handle: Handle,
  block: Exclude<ProfileBlock, 'none'>,
  lang: Lang,
) {
  const t = text[lang]
  const back = profilePath(handle)
  const item =
    block === 'blocking'
      ? html`<a href="/settings#blocks">${t.blocking}</a>`
      : html`<a
          href="/blocks/new?${new URLSearchParams({ handle, slide: back })}"
          >${t.blockPerson}</a
        >`
  return html`<details class="action-menu profile-menu" data-menu>
    <summary class="button-icon" aria-label="${t.more}" aria-expanded="false">
      <span aria-hidden="true">⋯</span>
    </summary>
    <div class="menu-items">${item}</div>
  </details>`
}
