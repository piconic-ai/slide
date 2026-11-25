import { html } from 'hono/html'
import { NEW_COMMUNITY_PATH } from '../events/event-page'
import { handleRefusalText, type HandleProblem } from '../handles/refusals'
import { messages, type Lang } from '../site/i18n'
import { prefixedField } from '../site/prefixed-field'
import { SERVICE_NAME } from '../site/service'
import { communityStyle } from './community-style'
import { NAME_MAX, type NameRefusal } from './community-input'
import {
  linkFields,
  type LinkFieldView,
  type LinkListProblem,
} from './link-fields'

/** What the form to make a community shows: what was typed, and what is wrong. */
export type NewCommunityForm = Readonly<{
  handle: string
  name: string
  links: readonly LinkFieldView[]
  problems: Readonly<{
    handle: HandleProblem | null
    name: NameRefusal | null
    links: LinkListProblem | null
  }>
}>

/** The form before anything is typed; `link` fills the first link. */
export const emptyNewCommunityForm = (link: string): NewCommunityForm => ({
  handle: '',
  name: '',
  links: [{ value: link, problem: null }],
  problems: { handle: null, name: null, links: null },
})

const text = messages({
  ja: {
    title: 'コミュニティを作る',
    lead: '勉強会やカンファレンスで発表されたスライドを、1 つのページにまとめておけます。',
    handle: 'ハンドル',
    handleNote:
      '人のハンドルと同じ並びで、重なるものは使えません。あとから変えられません。',
    name: '名前',
    nameProblem: {
      empty: '名前を入力してください。',
      too_long: `名前は ${NAME_MAX} 文字までです。`,
    } satisfies Record<NameRefusal, string>,
    create: '作る',
    send: '送る',
  },
  en: {
    title: 'Create a community',
    lead: 'Keep the slides given at a meetup or a conference together on one page.',
    handle: 'Handle',
    handleNote:
      'Communities share handles with people, so one in use cannot be taken. It cannot be changed later.',
    name: 'Name',
    nameProblem: {
      empty: 'Enter a name.',
      too_long: `A name is ${NAME_MAX} characters at most.`,
    } satisfies Record<NameRefusal, string>,
    create: 'Create',
    send: 'Send',
  },
})

/**
 * A hidden first button: pressing Enter in a field sends the form as this
 * one does, not as the first "remove" would.
 */
export const defaultSubmit = (label: string) =>
  html`<button
    class="default-submit"
    type="submit"
    tabindex="-1"
    aria-hidden="true"
  >
    ${label}
  </button>`

const describedBy = (id: string, problem: unknown, note = '') =>
  problem
    ? html`aria-invalid="true"
      aria-describedby="${id}-error${note ? ` ${note}` : ''}"`
    : note
      ? html`aria-describedby="${note}"`
      : ''

/**
 * The page that makes a community (F30-AC9): its handle after the service's
 * address, its name and its links, then "create". A field with a problem
 * says what to do under it, and keeps what was typed.
 */
export function newCommunityBody(form: NewCommunityForm, lang: Lang) {
  const t = text[lang]
  const { problems } = form
  return html`${communityStyle}
    <div class="community-form-page">
      <h1>${t.title}</h1>
      <p class="field-note">${t.lead}</p>
      <form class="community-form" method="post" action="${NEW_COMMUNITY_PATH}">
        ${defaultSubmit(t.create)}
        <div class="field">
          <label for="community-handle">${t.handle}</label>
          ${prefixedField(
            `${SERVICE_NAME}/@`,
            html`<input
              id="community-handle"
              name="handle"
              type="text"
              required
              maxlength="39"
              autocomplete="off"
              autocapitalize="none"
              spellcheck="false"
              value="${form.handle}"
              ${describedBy('community-handle', problems.handle, 'community-handle-note')}
            />`,
          )}
          ${
            problems.handle
              ? html`<p class="field-error" id="community-handle-error">
                  ${handleRefusalText(lang, problems.handle)}
                </p>`
              : ''
          }
          <p class="field-note" id="community-handle-note">${t.handleNote}</p>
        </div>
        <div class="field">
          <label for="community-name">${t.name}</label>
          <input
            id="community-name"
            name="name"
            type="text"
            required
            maxlength="${NAME_MAX * 2}"
            value="${form.name}"
            ${describedBy('community-name', problems.name)}
          />
          ${
            problems.name
              ? html`<p class="field-error" id="community-name-error">
                  ${t.nameProblem[problems.name]}
                </p>`
              : ''
          }
        </div>
        ${linkFields(form.links, problems.links, lang)}
        <button class="button-primary" type="submit">${t.create}</button>
      </form>
    </div>`
}

export const newCommunityTitle = (lang: Lang) => text[lang].title
