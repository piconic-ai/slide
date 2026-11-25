import { html } from 'hono/html'
import type { Handle } from '../share/handle'
import { communitiesPath } from '../share/path'
import { messages, type Lang } from '../site/i18n'

/**
 * The places of a profile's communities: its tab and the list the tab
 * opens. They are frames of their own, so that the work on following
 * communities fills them without touching the rest of the profile. The
 * tab's place among the others is set by `profileTabs` in pages.ts.
 */
const text = messages({
  ja: { communities: 'コミュニティ' },
  en: { communities: 'Communities' },
})

/** The name of the list of communities, for its tab and its page's title. */
export const communitiesListName = (lang: Lang) => text[lang].communities

/** The "communities" tab, with its count. */
export const communitiesTab = (
  handle: Handle,
  count: number,
  current: boolean,
  lang: Lang,
) =>
  html`<a
    href="${communitiesPath(handle)}"
    ${current ? html`aria-current="page"` : ''}
    >${text[lang].communities} <span class="count">${count}</span></a
  >`

/**
 * What `/@handle/communities` shows under the tabs: the communities the
 * author follows. Nothing yet; the work on following communities fills it.
 */
export const communitiesListFrame = (_handle: Handle, _lang: Lang) => ''
