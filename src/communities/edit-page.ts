import { html } from 'hono/html'
import type { HtmlEscapedString } from 'hono/utils/html'
import { eventNameOf } from '../events/event-name'
import { profilePath } from '../share/path'
import { messages, type Lang } from '../site/i18n'
import { SERVICE_NAME } from '../site/service'
import { communityActionPath, type Community } from './community'
import { adminNoticeText } from './admin-page'
import { isRefusal, type AdminNotice } from './admin-notice'
import {
  DESCRIPTION_MAX,
  MAX_SITES,
  NAME_MAX,
  type DescriptionRefusal,
  type NameRefusal,
  type SiteRefusal,
} from './community-input'
import { communityCover } from './community-page'
import { letterTone, logoOf } from './logo'
import { COMMUNITY_COLORS, type CommunityColor } from '../site/cover-pattern'
import { communityStyle } from './community-style'
import type { EditCommunityForm } from './edit-form'
import {
  IMAGE_MAX_SIDE,
  IMAGE_RULES,
  type CommunityImage,
} from './image-policy'
import { linkFields } from './link-fields'
import { defaultSubmit } from './new-page'
import type { RenamableEvent } from './store'

type Html = HtmlEscapedString | Promise<HtmlEscapedString>

/** What the last action on the editing page left to say. */
export type EditNotice =
  | 'saved'
  | 'logo'
  | 'cover'
  | 'logo-removed'
  | 'cover-removed'
  | 'renamed'
  | 'image-refused'
  | 'name-refused'
  | null

export const EDIT_NOTICES: readonly Exclude<EditNotice, null>[] = [
  'saved',
  'logo',
  'cover',
  'logo-removed',
  'cover-removed',
  'renamed',
  'image-refused',
  'name-refused',
]

const text = messages({
  ja: {
    title: 'コミュニティを編集',
    handle: 'ハンドル',
    handleNote:
      'ハンドルはあとから変えられません。変える必要があるときは、お問い合わせください。',
    name: '名前',
    nameProblem: {
      empty: '名前を入力してください。',
      too_long: `名前は ${NAME_MAX} 文字までです。`,
    } satisfies Record<NameRefusal, string>,
    description: '説明',
    descriptionNote: `${DESCRIPTION_MAX} 文字まで。URL はリンクになりません。`,
    descriptionProblem: {
      too_long: `説明は ${DESCRIPTION_MAX} 文字までです。`,
    } satisfies Record<DescriptionRefusal, string>,
    color: '色',
    colorNote:
      '既定のカバー画像の模様、ロゴの頭文字の地、フォローしている人の新着のカードの印に使います。',
    colorNames: {
      red: '赤',
      orange: '橙',
      yellow: '黄',
      green: '緑',
      navy: '紺',
    } satisfies Record<CommunityColor, string>,
    colorProblem: '5 色の見本から 1 つを選んでください。',
    logo: 'ロゴ',
    cover: 'カバー画像',
    upload: '画像をアップロード',
    resetLogo: '頭文字に戻す',
    resetCover: '既定の模様に戻す',
    coverNote: '横 1600 × 縦 400 を目安に。PNG、JPEG、WebP、2 MB まで。',
    logoNote: 'PNG、JPEG、WebP、1 MB まで。正方形に切り抜きます。',
    sites: `ほかのリンク(Web サイト、X など。${MAX_SITES} つまで)`,
    site: (n: number) => `ほかのリンク ${n}`,
    siteProblem: {
      invalid: 'https:// で始まる URL を入れてください。',
      too_many: `ほかのリンクは ${MAX_SITES} つまでです。`,
    } satisfies Record<SiteRefusal, string>,
    save: '保存する',
    cancel: 'やめる',
    events: 'イベント名',
    eventsNote: 'このコミュニティに入っているイベントの名前を直せます。',
    eventName: (name: string) => `${name} の名前`,
    rename: '直す',
    choice: {
      tooLarge: (mb: number) => `画像は ${mb} MB までです。`,
      unsupported: 'PNG、JPEG、WebP の画像だけ使えます。',
      unreadable: '画像として読めませんでした。別の画像を選んでください。',
      tooWide: `画像の縦か横が長すぎます(${IMAGE_MAX_SIDE} ピクセルまで)。`,
      cannotShrink:
        'このブラウザでは画像を縮められないため、画像を変えられません。新しいブラウザでお試しください。',
    },
    noScript:
      'スクリプトが動かないため、画像を変えられません。画像は、このページがブラウザの中で縮めてから送ります。',
    notices: {
      saved: '保存しました。',
      logo: 'ロゴを変えました。',
      cover: 'カバー画像を変えました。',
      'logo-removed': 'ロゴを頭文字に戻しました。',
      'cover-removed': 'カバー画像を既定の模様に戻しました。',
      renamed: 'イベント名を直しました。',
      'image-refused':
        '画像を受け取れませんでした。PNG、JPEG、WebP の画像を選び直してください。',
      'name-refused': 'イベント名は 1〜100 文字で入れてください。',
    } satisfies Record<Exclude<EditNotice, null>, string>,
  },
  en: {
    title: 'Edit community',
    handle: 'Handle',
    handleNote:
      'A handle cannot be changed later. If it must be, please contact us.',
    name: 'Name',
    nameProblem: {
      empty: 'Enter a name.',
      too_long: `A name is ${NAME_MAX} characters at most.`,
    } satisfies Record<NameRefusal, string>,
    description: 'Description',
    descriptionNote: `${DESCRIPTION_MAX} characters at most. Addresses do not become links.`,
    descriptionProblem: {
      too_long: `A description is ${DESCRIPTION_MAX} characters at most.`,
    } satisfies Record<DescriptionRefusal, string>,
    color: 'Color',
    colorNote:
      'Used for the default cover pattern, behind the initial of the logo, and for the mark on the cards in followers’ news.',
    colorNames: {
      red: 'Red',
      orange: 'Orange',
      yellow: 'Yellow',
      green: 'Green',
      navy: 'Navy',
    } satisfies Record<CommunityColor, string>,
    colorProblem: 'Choose one of the five colors.',
    logo: 'Logo',
    cover: 'Cover image',
    upload: 'Upload an image',
    resetLogo: 'Back to the initial',
    resetCover: 'Back to the default pattern',
    coverNote: 'About 1600 × 400. PNG, JPEG or WebP, up to 2 MB.',
    logoNote: 'PNG, JPEG or WebP, up to 1 MB. Cropped to a square.',
    sites: `Other links (a website, X and so on; up to ${MAX_SITES})`,
    site: (n: number) => `Other link ${n}`,
    siteProblem: {
      invalid: 'Enter an address starting with https://.',
      too_many: `Up to ${MAX_SITES} other links.`,
    } satisfies Record<SiteRefusal, string>,
    save: 'Save',
    cancel: 'Cancel',
    events: 'Event names',
    eventsNote: 'Fix the names of the events in this community.',
    eventName: (name: string) => `Name of ${name}`,
    rename: 'Fix',
    choice: {
      tooLarge: (mb: number) => `An image is ${mb} MB at most.`,
      unsupported: 'Only PNG, JPEG and WebP images can be used.',
      unreadable: 'That could not be read as an image. Please choose another.',
      tooWide: `The image is too wide or too tall (${IMAGE_MAX_SIDE} pixels at most).`,
      cannotShrink:
        'This browser cannot shrink the image, so it cannot be changed here. Please try a recent browser.',
    },
    noScript:
      'Images cannot be changed with scripts turned off: this page shrinks the image in your browser before sending it.',
    notices: {
      saved: 'Saved.',
      logo: 'The logo was changed.',
      cover: 'The cover image was changed.',
      'logo-removed': 'The logo is back to the initial.',
      'cover-removed': 'The cover image is back to the default pattern.',
      renamed: 'The event name was fixed.',
      'image-refused':
        'The image could not be taken. Please choose a PNG, JPEG or WebP image again.',
      'name-refused': 'An event name is 1 to 100 characters.',
    } satisfies Record<Exclude<EditNotice, null>, string>,
  },
})

function noticeLine(notice: EditNotice | AdminNotice, lang: Lang) {
  if (notice === null) return ''
  const edit = EDIT_NOTICES.find((known) => known === notice)
  const refused = edit
    ? edit.endsWith('refused')
    : isRefusal(notice as AdminNotice)
  return html`<p
    class="${refused ? 'notice-danger' : 'notice-success'}"
    role="status"
  >
    ${edit ? text[lang].notices[edit] : adminNoticeText(notice as AdminNotice, lang)}
  </p>`
}

const invalid = (id: string, problem: unknown) =>
  problem ? html`aria-invalid="true" aria-describedby="${id}-error"` : ''

const errorLine = (id: string, words: string | null) =>
  words ? html`<p class="field-error" id="${id}-error">${words}</p>` : ''

/**
 * The file field that puts up a logo or a cover. It is part of its own form
 * (the browser shrinks the picture and sends it at once), so it stands
 * inside the editing form without being sent with it. Disabled until the
 * page's script finds it can shrink pictures.
 */
function imageField(community: Community, image: CommunityImage, lang: Lang) {
  const t = text[lang]
  const rule = IMAGE_RULES[image]
  const has = (image === 'logo' ? community.logoAt : community.coverAt) !== null
  const noticeId = `community-${image}-error`
  return html`<div class="community-image-row">
      ${
        image === 'logo'
          ? html`<span class="community-logo-preview" data-color-shown
              >${logoOf(community, 48)}</span
            >`
          : ''
      }
      <label class="button-secondary picture-pick">
        ${t.upload}
        <input
          type="file"
          name="image"
          form="community-${image}-form"
          accept="image/png,image/jpeg,image/webp"
          disabled
          data-picture-upload
          data-sniff
          data-notice="${noticeId}"
          data-side="${rule.side}"
          data-aspect="${rule.aspect}"
          ${rule.noUpscale ? html`data-no-upscale` : ''}
          data-max-side="${IMAGE_MAX_SIDE}"
          data-max-bytes="${rule.maxBytes}"
          data-too-large="${t.choice.tooLarge(rule.maxBytes / 1024 / 1024)}"
          data-unsupported="${t.choice.unsupported}"
          data-unreadable="${t.choice.unreadable}"
          data-too-wide="${t.choice.tooWide}"
          data-cannot-shrink="${t.choice.cannotShrink}"
          aria-describedby="community-${image}-note ${noticeId}"
        />
      </label>
      ${
        has
          ? html`<button
              class="button-secondary"
              type="submit"
              form="community-${image}-remove-form"
            >
              ${image === 'logo' ? t.resetLogo : t.resetCover}
            </button>`
          : ''
      }
    </div>
    <p class="field-error" id="${noticeId}" role="alert" hidden></p>
    <p class="field-note" id="community-${image}-note">
      ${image === 'logo' ? t.logoNote : t.coverNote}
    </p>
    <noscript><p class="field-note">${t.noScript}</p></noscript>`
}

/**
 * The five colors as swatches to choose from (F30-AC45): radios named by
 * their colors, the one the community has checked. The color fills the
 * swatch alone (D-13). The page's script shows the chosen color at once on
 * the logo's initial and the default cover above (F30-AC51); each radio
 * names the tone its initial is written in.
 */
function colorField(form: EditCommunityForm, lang: Lang) {
  const t = text[lang]
  const problem = form.problems.color
  return html`<fieldset
    class="community-colors"
    data-color-preview
    aria-describedby="community-color-note${problem ? ' community-color-error' : ''}"
  >
    <legend class="field-label">${t.color}</legend>
    <div class="community-color-row">
      ${COMMUNITY_COLORS.map(
        (color) =>
          html`<label class="community-color">
            <input
              type="radio"
              name="color"
              value="${color}"
              ${form.color === color ? html`checked` : ''}
              required
              data-tone="${letterTone(color)}"
            />
            <span
              class="community-swatch"
              style="background: var(--community-${color}); color: var(--${letterTone(color)})"
              aria-hidden="true"
            ></span>
            <span class="community-color-name">${t.colorNames[color]}</span>
          </label>`,
      )}
    </div>
    ${errorLine('community-color', problem ? t.colorProblem : null)}
    <p class="field-note" id="community-color-note">${t.colorNote}</p>
  </fieldset>`
}

function siteRows(form: EditCommunityForm, lang: Lang) {
  const t = text[lang]
  return html`<fieldset class="community-links">
    <legend class="field-label">${t.sites}</legend>
    ${form.sites.map((field, index) => {
      const id = `community-site-${index}`
      return html`<div class="community-link-row">
        <input
          id="${id}"
          name="site"
          type="url"
          inputmode="url"
          maxlength="300"
          value="${field.value}"
          placeholder="https://"
          aria-label="${t.site(index + 1)}"
          ${invalid(id, field.problem)}
        />
        ${errorLine(id, field.problem ? t.siteProblem[field.problem] : null)}
      </div>`
    })}
  </fieldset>`
}

function renameRows(
  community: Community,
  events: readonly RenamableEvent[],
  lang: Lang,
) {
  const t = text[lang]
  if (events.length === 0) return ''
  return html`<section class="panel community-events-panel">
    <h2>${t.events}</h2>
    <p class="field-note">${t.eventsNote}</p>
    ${events.map((event) => {
      const name = eventNameOf(event, lang)
      return html`<form
        class="community-rename"
        method="post"
        action="${communityActionPath(community.id, `events/${event.id}/rename`)}"
      >
        <input
          name="name"
          type="text"
          required
          maxlength="100"
          value="${event.name ?? ''}"
          placeholder="${name}"
          aria-label="${t.eventName(name)}"
        />
        <button class="button-secondary" type="submit">${t.rename}</button>
      </form>`
    })}
  </section>`
}

/**
 * A community's editing page (F30-AC25), for its admins only: its handle
 * (shown, not changed), name, links, description, color, logo, cover and other
 * links, then "save" and "cancel"; the names of its events; and, below,
 * the parts the admins and deletion add.
 */
export function editPageBody(
  input: Readonly<{
    community: Community
    form: EditCommunityForm
    events: readonly RenamableEvent[]
    notice: EditNotice | AdminNotice
    /** The admins and the deletion, drawn by their own parts. */
    below?: Html | string
  }>,
  lang: Lang,
) {
  const t = text[lang]
  const { community, form } = input
  const path = profilePath(community.handle)
  const action = (name: string) => communityActionPath(community.id, name)
  return html`${communityStyle}
    <div class="community-form-page">
      <p><a href="${path}">‹ ${community.name}</a></p>
      <h1>${t.title}</h1>
      ${noticeLine(input.notice, lang)}
      <form
        id="community-logo-form"
        method="post"
        enctype="multipart/form-data"
        action="${action('logo')}"
      ></form>
      <form
        id="community-cover-form"
        method="post"
        enctype="multipart/form-data"
        action="${action('cover')}"
      ></form>
      <form
        id="community-logo-remove-form"
        method="post"
        action="${action('logo/remove')}"
      ></form>
      <form
        id="community-cover-remove-form"
        method="post"
        action="${action('cover/remove')}"
      ></form>
      <form class="community-form" method="post" action="${action('edit')}">
        ${defaultSubmit(t.save)}
        <div class="field">
          <p class="field-label">${t.handle}</p>
          <p>${SERVICE_NAME}/@${community.handle}</p>
          <p class="field-note">${t.handleNote}</p>
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
            ${invalid('community-name', form.problems.name)}
          />
          ${errorLine(
            'community-name',
            form.problems.name ? t.nameProblem[form.problems.name] : null,
          )}
        </div>
        ${linkFields(form.links, form.problems.links, lang)}
        <div class="field">
          <label for="community-description">${t.description}</label>
          <textarea
            id="community-description"
            name="description"
            rows="4"
            maxlength="${DESCRIPTION_MAX * 2}"
            ${
              form.problems.description
                ? html`aria-invalid="true"
                  aria-describedby="community-description-error
                  community-description-note"`
                : html`aria-describedby="community-description-note"`
            }
          >
${form.description}</textarea>
          ${errorLine(
            'community-description',
            form.problems.description
              ? t.descriptionProblem[form.problems.description]
              : null,
          )}
          <p class="field-note" id="community-description-note">
            ${t.descriptionNote}
          </p>
        </div>
        ${colorField(form, lang)}
        <div class="field">
          <p class="field-label">${t.logo}</p>
          ${imageField(community, 'logo', lang)}
        </div>
        <div class="field">
          <p class="field-label">${t.cover}</p>
          <div class="community-cover-preview" data-color-shown>
            ${communityCover(community, lang)}
          </div>
          ${imageField(community, 'cover', lang)}
        </div>
        ${siteRows(form, lang)}
        <div class="community-form-buttons">
          <button class="button-primary" type="submit">${t.save}</button>
          <a class="button-secondary" href="${path}">${t.cancel}</a>
        </div>
      </form>
      ${renameRows(community, input.events, lang)} ${input.below ?? ''}
    </div>`
}

export const editPageTitle = (lang: Lang) => text[lang].title
