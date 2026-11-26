import { html } from 'hono/html'
import { messages, type Lang } from './i18n'
import { peopleList } from './settings-people'
import { frameHelpLink } from '../help/frame-links'

const text = messages({
  ja: {
    blocked: 'ブロックしている人',
    blockedNote:
      'ブロックしている間は、互いにフォローできません。ブロックした人の引用やスライドは、あなたの画面に出なくなります。相手に知らせることはありません。',
    noneBlocked: 'ブロックしている人はいません。',
    unblock: {
      label: 'ブロックを解除',
      name: (handle: string) => `@${handle} のブロックを解除`,
    },
  },
  en: {
    blocked: 'People you blocked',
    blockedNote:
      'While you block someone, neither of you can follow the other, and their citations and slides no longer appear to you. They aren’t told.',
    noneBlocked: 'You haven’t blocked anyone.',
    unblock: {
      label: 'Unblock',
      name: (handle: string) => `Unblock @${handle}`,
    },
  },
})

/**
 * Where the settings list the people the author blocked, each with the way
 * to unblock them, above the people muted. Unblocking leaves the follows
 * the block dropped as they are.
 */
export function settingsBlocksFrame(
  blocked: readonly { handle: string }[],
  lang: Lang,
) {
  const t = text[lang]
  return html`<section class="panel" id="blocks">
    <h2>${t.blocked}</h2>
    <p class="field-note">${t.blockedNote}</p>
    ${frameHelpLink('settings-blocks', lang)}
    ${peopleList(
      blocked.map(({ handle }) => handle),
      '/blocks',
      t.unblock,
      t.noneBlocked,
    )}
  </section>`
}
