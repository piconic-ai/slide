import { html } from 'hono/html'
import { messages, type Lang } from '../site/i18n'

const text = messages({
  ja: {
    title: 'このリンクを開きますか',
    body: '移る先の URL です。開く前に、全体を確かめてください。',
    open: '開く',
    cancel: 'キャンセル',
  },
  en: {
    title: 'Open this link?',
    body: 'This is the address it leads to. Check all of it before you open it.',
    open: 'Open',
    cancel: 'Cancel',
  },
})

/**
 * The attributes that make a link ask the reader to check its address before
 * it is followed (F27-AC53, F26-AC97). /share.js listens for them; without
 * scripts the link is followed as it is.
 */
export const LINK_CHECK_ATTRIBUTES = 'data-link-check aria-haspopup="dialog"'

/** The same attributes, for markup written with `html`. */
export const linkCheckTrigger = () =>
  html`data-link-check aria-haspopup="dialog"`

/**
 * The modal that shows the whole address a link leads to, kept inert in the
 * viewer until /share.js opens a copy of it. The script writes the link's
 * href, as the page holds it, into the text and into "Open", which is a plain
 * link with the rel of the one pressed: the reader goes where they would have
 * gone without the check, in the same tab.
 */
export const linkCheckPrompt = (lang: Lang) => {
  const t = text[lang]
  return html`<template data-link-check-prompt>
    <div
      class="link-check"
      role="dialog"
      aria-modal="true"
      aria-labelledby="link-check-title"
      aria-describedby="link-check-body link-check-url"
    >
      <div class="link-check-panel">
        <h2 id="link-check-title">${t.title}</h2>
        <p id="link-check-body">${t.body}</p>
        <p class="link-check-url" id="link-check-url" data-link-check-url></p>
        <div class="link-check-actions">
          <a class="button-primary" data-link-check-open>${t.open}</a>
          <button type="button" class="button-secondary" data-link-check-close>
            ${t.cancel}
          </button>
        </div>
      </div>
    </div>
  </template>`
}
