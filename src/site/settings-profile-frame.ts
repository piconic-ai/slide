import { html } from 'hono/html'
import type { ProfileFields, ProfileProblem } from '../profile/profile-input'
import {
  BIO_MAX,
  LINKS_MAX,
  LOCATION_MAX,
  NAME_MAX,
} from '../profile/profile-lines'
import type { UrlRefusal } from '../profile/profile-lines'
import { initialOf } from '../follows/people'
import { faceImage } from '../profile/face'
import { type PictureRefusal } from '../profile/picture-policy'
import { messages, type Lang } from './i18n'

const urlRefusal = (lang: 'ja' | 'en') =>
  ({
    ja: {
      invalid: 'URL の形が正しくありません。https:// から書いてください。',
      not_https: 'https:// で始まる URL だけ使えます。',
      too_long: 'URL が長すぎます(2048 文字まで)。',
    },
    en: {
      invalid: 'That is not a valid URL. Start it with https://.',
      not_https: 'Only URLs that start with https:// can be used.',
      too_long: 'That URL is too long (2048 characters at most).',
    },
  })[lang] satisfies Record<UrlRefusal, string>

const text = messages({
  ja: {
    heading: 'プロフィール',
    intro: 'プロフィールに出ます。',
    name: '表示名',
    bio: '自己紹介',
    location: '場所',
    website: 'Web サイト',
    links: `SNS のリンク(X、Bluesky、GitHub など。${LINKS_MAX} つまで)`,
    link: (n: number) => `SNS のリンク ${n}`,
    picture: '顔写真',
    pickPicture: '画像を選ぶ',
    upload: '画像をアップロード',
    removePicture: 'アップロードした画像を外す',
    pictureNote:
      'アップロードした画像があればそれを、なければ頭文字を出します。PNG、JPEG、WebP が使えます(1 MB まで)。',
    pictureSaved: '顔写真を変えました。',
    pictureRemoved: 'アップロードした画像を外しました。',
    pictureRefusal: {
      no_file: '画像を選んでください。',
      too_large: '画像は 1 MB までです。',
      unsupported_type: 'PNG、JPEG、WebP の画像だけ使えます。',
      unreadable: '画像として読めませんでした。別の画像を選んでください。',
      too_wide: '画像の縦か横が長すぎます(8192 ピクセルまで)。',
      unavailable:
        'いま、画像をアップロードできません。しばらくしてからもう一度お試しください。',
    } satisfies Record<PictureRefusal, string>,
    save: '保存する',
    saved: 'プロフィールを保存しました。',
    failed: '保存できませんでした。次の項目を直してください。',
    nameEmpty: '表示名を入力してください。',
    tooLong: (max: number) => `${max} 文字までです。`,
    tooManyLinks: `SNS のリンクは ${LINKS_MAX} つまでです。`,
    url: urlRefusal('ja'),
  },
  en: {
    heading: 'Profile',
    intro: 'This is shown on your profile.',
    name: 'Display name',
    bio: 'Bio',
    location: 'Location',
    website: 'Website',
    links: `Social links (X, Bluesky, GitHub and so on; up to ${LINKS_MAX})`,
    link: (n: number) => `Social link ${n}`,
    picture: 'Picture',
    pickPicture: 'Choose an image',
    upload: 'Upload an image',
    removePicture: 'Remove the uploaded image',
    pictureNote:
      'The uploaded image is shown if there is one, otherwise your initial. PNG, JPEG and WebP work (up to 1 MB).',
    pictureSaved: 'Your picture was changed.',
    pictureRemoved: 'The uploaded image was removed.',
    pictureRefusal: {
      no_file: 'Choose an image.',
      too_large: 'An image is 1 MB at most.',
      unsupported_type: 'Only PNG, JPEG and WebP images can be used.',
      unreadable: 'That could not be read as an image. Please choose another.',
      too_wide: 'The image is too wide or too tall (8192 pixels at most).',
      unavailable:
        'Pictures cannot be uploaded right now. Please try again later.',
    } satisfies Record<PictureRefusal, string>,
    save: 'Save',
    saved: 'Your profile was saved.',
    failed: 'It was not saved. Please fix the fields below.',
    nameEmpty: 'Enter a display name.',
    tooLong: (max: number) => `Up to ${max} characters.`,
    tooManyLinks: `Up to ${LINKS_MAX} social links.`,
    url: urlRefusal('en'),
  },
})

/** What the profile frame shows: the typed fields, and what was wrong. */
export type ProfileFormView = Readonly<{
  fields: ProfileFields
  problems: readonly ProfileProblem[]
  /** The profile was just saved. */
  saved: boolean
  picture: PictureView
}>

/** The picture part of the frame: what shows now, and what just happened. */
export type PictureView = Readonly<{
  /** Where the picture is served from, with the time it was put up. */
  src: string
  /** Whether an uploaded picture exists, and so can be removed. */
  uploaded: boolean
  result:
    | Readonly<{ kind: 'none' }>
    | Readonly<{ kind: 'changed' | 'removed' }>
    | Readonly<{ kind: 'refused'; reason: PictureRefusal }>
}>

type Text = (typeof text)[Lang]

/** The message for one problem, in the author's language. */
export function problemMessage(problem: ProfileProblem, t: Text): string {
  switch (problem.field) {
    case 'name':
      return problem.reason === 'empty' ? t.nameEmpty : t.tooLong(NAME_MAX)
    case 'bio':
      return t.tooLong(BIO_MAX)
    case 'location':
      return t.tooLong(LOCATION_MAX)
    case 'website':
    case 'link':
      return t.url[problem.reason]
    case 'links':
      return t.tooManyLinks
  }
}

const errorOf = (id: string, message: string | undefined) =>
  message
    ? html`<p class="notice-danger field-error" role="alert" id="${id}">
        ${message}
      </p>`
    : ''

/**
 * Where settings let the author write their profile: display name, bio,
 * location, website and social links. Nothing is saved until "Save"; a
 * refused form comes back with what was typed and what to fix.
 */
export const settingsProfileFrame = (view: ProfileFormView, lang: Lang) => {
  const t = text[lang]
  const { fields, problems } = view
  const messageFor = (match: (problem: ProfileProblem) => boolean) => {
    const found = problems.find(match)
    return found ? problemMessage(found, t) : undefined
  }
  const { picture } = view
  const pictureNotice =
    picture.result.kind === 'refused'
      ? html`<p class="notice-danger field-error" role="alert">
          ${t.pictureRefusal[picture.result.reason]}
        </p>`
      : picture.result.kind === 'changed'
        ? html`<p class="notice-success" role="status">${t.pictureSaved}</p>`
        : picture.result.kind === 'removed'
          ? html`<p class="notice-success" role="status">
              ${t.pictureRemoved}
            </p>`
          : ''
  const links = Array.from(
    { length: LINKS_MAX },
    (_, i) => fields.links[i] ?? '',
  )
  return html`<section class="panel" id="profile">
    <h2>${t.heading}</h2>
    <p class="field-note">${t.intro}</p>
    ${view.saved ? html`<p class="notice-success" role="status">${t.saved}</p>` : ''}
    ${problems.length > 0 ? html`<p class="notice-danger" role="alert">${t.failed}</p>` : ''}
    <form method="post" action="/settings/profile" class="profile-form">
      <div class="field">
        <label for="profile-name">${t.name}</label>
        <input
          id="profile-name"
          name="name"
          autocomplete="nickname"
          required
          aria-describedby="profile-name-error"
          value="${fields.name}"
        />
        ${errorOf(
          'profile-name-error',
          messageFor((p) => p.field === 'name'),
        )}
      </div>
      <div class="field">
        <label for="profile-bio">${t.bio}</label>
        <textarea
          id="profile-bio"
          name="bio"
          rows="3"
          aria-describedby="profile-bio-error"
        >
${fields.bio}</textarea>
        ${errorOf(
          'profile-bio-error',
          messageFor((p) => p.field === 'bio'),
        )}
      </div>
      <div class="field">
        <label for="profile-location">${t.location}</label>
        <input
          id="profile-location"
          name="location"
          autocomplete="off"
          aria-describedby="profile-location-error"
          value="${fields.location}"
        />
        ${errorOf(
          'profile-location-error',
          messageFor((p) => p.field === 'location'),
        )}
      </div>
      <div class="field">
        <label for="profile-website">${t.website}</label>
        <input
          id="profile-website"
          name="website"
          inputmode="url"
          autocomplete="url"
          placeholder="https://"
          aria-describedby="profile-website-error"
          value="${fields.website}"
        />
        ${errorOf(
          'profile-website-error',
          messageFor((p) => p.field === 'website'),
        )}
      </div>
      <div class="field" role="group" aria-labelledby="profile-links-label">
        <span class="field-label" id="profile-links-label">${t.links}</span>
        ${links.map(
          (link, index) =>
            html`<input
                name="link"
                inputmode="url"
                placeholder="https://"
                aria-label="${t.link(index + 1)}"
                aria-describedby="profile-link-${index}-error"
                value="${link}"
              />${errorOf(
                `profile-link-${index}-error`,
                messageFor((p) => p.field === 'link' && p.index === index),
              )}`,
        )}
        ${errorOf(
          'profile-links-error',
          messageFor((p) => p.field === 'links'),
        )}
      </div>
      <div class="field" role="group" aria-labelledby="profile-picture-label">
        <span class="field-label" id="profile-picture-label">${t.picture}</span>
        <div class="picture-row">
          <span class="settings-face" aria-hidden="true"
            >${initialOf(fields.name)}${faceImage(picture.src)}</span
          >
          <input
            type="file"
            name="picture"
            form="picture-upload"
            accept="image/png,image/jpeg,image/webp"
            required
            aria-label="${t.pickPicture}"
            aria-describedby="profile-picture-note"
          />
          <button class="button-secondary" type="submit" form="picture-upload">
            ${t.upload}
          </button>
          ${
            picture.uploaded
              ? html`<button
                  class="button-secondary"
                  type="submit"
                  form="picture-remove"
                >
                  ${t.removePicture}
                </button>`
              : ''
          }
        </div>
        ${pictureNotice}
        <p class="field-note" id="profile-picture-note">${t.pictureNote}</p>
      </div>
      <button class="button-primary" type="submit">${t.save}</button>
    </form>
    <form
      id="picture-upload"
      method="post"
      action="/settings/picture"
      enctype="multipart/form-data"
    ></form>
    <form
      id="picture-remove"
      method="post"
      action="/settings/picture/remove"
    ></form>
  </section>`
}
