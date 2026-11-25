import { html } from 'hono/html'
import { profilePath } from '../share/path'
import type { Handle } from '../share/handle'
import { messages, type Lang } from '../site/i18n'
import { SERVICE_NAME } from '../site/service'
import { MAX_COMMUNITY_LINKS, type LinkRefusal } from './link-rules'

/** What is wrong with one link field: its form, or another community holds it. */
export type LinkProblem =
  | Readonly<{ kind: 'refused'; reason: LinkRefusal }>
  | Readonly<{ kind: 'taken'; handle: Handle }>

/** One link field as the form draws it. */
export type LinkFieldView = Readonly<{
  value: string
  problem: LinkProblem | null
}>

/** Why the list as a whole was refused, shown under the last field. */
export type LinkListProblem = 'none' | 'too_many'

const text = messages({
  ja: {
    label: 'スライドの自動紐づけ用リンク',
    intro:
      'イベントを募集しているグループのページの URL を入れてください。そのグループのイベントで発表されたスライドが、このコミュニティに自動で集まります。',
    forms: 'サービスごとの URL の形',
    connpass: 'https://グループ名.connpass.com/',
    luma: 'カレンダーの「iCal で購読」の URL(https://api.lu.ma/ics/get?entity=calendar&id=cal-…)',
    doorkeeper: 'https://グループ名.doorkeeper.jp/',
    own: '自前のサイト',
    ownForm: 'https://ホスト名/',
    field: (n: number) => `紐づけ用リンク ${n}`,
    remove: '外す',
    removeLabel: (n: number) => `紐づけ用リンク ${n} を外す`,
    add: 'リンクを足す',
    refused: {
      invalid: 'https:// で始まる URL を入れてください。',
      not_top:
        'グループやサイトのトップの URL(https://ホスト名/)を入れてください。',
      public_host:
        'だれでも使うサイトのリンクは入れられません。グループのページか、自前のサイトのトップを入れてください。',
      luma_calendar:
        'Luma は、カレンダーの「iCal で購読」の URL を入れてください。',
    } satisfies Record<LinkRefusal, string>,
    taken: (link: unknown) => html`このリンクは ${link} がすでに使っています。`,
    list: {
      none: '紐づけ用リンクを 1 つ以上入れてください。',
      too_many: `紐づけ用リンクは ${MAX_COMMUNITY_LINKS} 個までです。`,
    } satisfies Record<LinkListProblem, string>,
  },
  en: {
    label: 'Links that gather slides',
    intro:
      'Enter the page of the group that holds your events. Slides given at that group’s events gather in this community by themselves.',
    forms: 'The address for each service',
    connpass: 'https://group-name.connpass.com/',
    luma: 'The calendar’s “Subscribe with iCal” address (https://api.lu.ma/ics/get?entity=calendar&id=cal-…)',
    doorkeeper: 'https://group-name.doorkeeper.jp/',
    own: 'Your own site',
    ownForm: 'https://host-name/',
    field: (n: number) => `Link ${n}`,
    remove: 'Remove',
    removeLabel: (n: number) => `Remove link ${n}`,
    add: 'Add a link',
    refused: {
      invalid: 'Enter an address starting with https://.',
      not_top:
        'Enter the top page of the group or the site (https://host-name/).',
      public_host:
        'A site everyone uses cannot be a link. Enter your group’s page or the top of your own site.',
      luma_calendar:
        'For Luma, enter the calendar’s “Subscribe with iCal” address.',
    } satisfies Record<LinkRefusal, string>,
    taken: (link: unknown) => html`${link} already uses this link.`,
    list: {
      none: 'Enter at least one link.',
      too_many: `A community can have ${MAX_COMMUNITY_LINKS} links at most.`,
    } satisfies Record<LinkListProblem, string>,
  },
})

const problemText = (problem: LinkProblem, lang: Lang) => {
  const t = text[lang]
  if (problem.kind === 'refused') return t.refused[problem.reason]
  return t.taken(
    html`<a href="${profilePath(problem.handle)}"
      >${SERVICE_NAME}/@${problem.handle}</a
    >`,
  )
}

function linkRow(field: LinkFieldView, index: number, lang: Lang) {
  const t = text[lang]
  const id = `community-link-${index}`
  const errorId = `${id}-error`
  return html`<div class="community-link-row">
    <div class="community-link-line">
      <input
        id="${id}"
        name="link"
        type="url"
        inputmode="url"
        autocomplete="off"
        spellcheck="false"
        maxlength="2000"
        value="${field.value}"
        aria-label="${t.field(index + 1)}"
        ${
          field.problem
            ? html`aria-invalid="true" aria-describedby="${errorId}"`
            : ''
        }
      />
      <button
        class="button-secondary"
        type="submit"
        name="remove"
        value="${index}"
        formnovalidate
        aria-label="${t.removeLabel(index + 1)}"
      >
        ${t.remove}
      </button>
    </div>
    ${
      field.problem
        ? html`<p class="field-error" id="${errorId}">
            ${problemText(field.problem, lang)}
          </p>`
        : ''
    }
  </div>`
}

/**
 * The fields of a community's links (F30-AC39): one row a link, its address
 * and a button that takes it away, and a button that adds a row, up to
 * MAX_COMMUNITY_LINKS. Both send the form back to be drawn again, so they
 * work without scripts and keep what was typed. Only a field with a problem
 * is marked, with one sentence under it.
 */
export function linkFields(
  fields: readonly LinkFieldView[],
  listProblem: LinkListProblem | null,
  lang: Lang,
) {
  const t = text[lang]
  const rows = fields.length === 0 ? [{ value: '', problem: null }] : fields
  return html`<fieldset class="community-links">
    <legend class="field-label">${t.label}</legend>
    <p class="field-note">${t.intro}</p>
    <dl class="community-link-forms" aria-label="${t.forms}">
      <dt>connpass</dt>
      <dd><code>${t.connpass}</code></dd>
      <dt>Luma</dt>
      <dd><code>${t.luma}</code></dd>
      <dt>Doorkeeper</dt>
      <dd><code>${t.doorkeeper}</code></dd>
      <dt>${t.own}</dt>
      <dd><code>${t.ownForm}</code></dd>
    </dl>
    ${rows.map((field, index) => linkRow(field, index, lang))}
    ${
      listProblem
        ? html`<p class="field-error" id="community-links-error" role="alert">
            ${t.list[listProblem]}
          </p>`
        : ''
    }
    ${
      rows.length < MAX_COMMUNITY_LINKS
        ? html`<button
            class="button-secondary"
            type="submit"
            name="add"
            value="link"
            formnovalidate
          >
            ${t.add}
          </button>`
        : ''
    }
  </fieldset>`
}

/**
 * The form's list of links after a press of "remove" or "add a link":
 * without the row removed, or with one more empty row (up to the limit).
 */
export function editedLinkFields(
  values: readonly string[],
  action: Readonly<{ remove: number | null; add: boolean }>,
): readonly LinkFieldView[] {
  const kept = values.filter((_, index) => index !== action.remove)
  const rows =
    action.add && kept.length < MAX_COMMUNITY_LINKS ? [...kept, ''] : kept
  return rows.map((value) => ({ value, problem: null }))
}
