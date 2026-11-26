import { html } from 'hono/html'
import type { HelpAim } from './aims'
import { helpArticlePath } from './paths'

/**
 * A link that stands alone and sends the reader to one article of the help,
 * with room to press it (class help-link, in the shared page style). The
 * article must exist; a test reads every such link in the source and checks.
 */
export const helpArticleLink = (aim: HelpAim, slug: string, label: string) =>
  html`<a class="help-link" href="${helpArticlePath(aim, slug)}">${label}</a>`
