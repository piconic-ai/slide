import { html } from 'hono/html'
import { helpLabels, helpSections, type HelpSection } from './help-content'
import type { Lang } from './i18n'
import { pageShell, PLAIN_PAGE_POLICY } from './shell'

/** The help page carries only service markup and the shared frame. */
export const HELP_PAGE_POLICY = PLAIN_PAGE_POLICY

export const HELP_PATH = '/help'

/**
 * The table of contents beside the text, and above it on a narrow screen.
 * Colors come from the shared tokens; no color is written here.
 */
const helpStyle = html`<style>
  .help {
    display: flex;
    flex-wrap: wrap;
    gap: 0 40px;
    align-items: flex-start;
  }
  .help-toc {
    flex: 1 1 200px;
    max-width: 240px;
  }
  .help-toc ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .help-toc a {
    display: flex;
    align-items: center;
    min-height: 44px;
    font-size: 15px;
  }
  .help-body {
    flex: 3 1 420px;
    min-width: 0;
    line-height: 1.9;
  }
  .help-body > section:first-child > h2 {
    margin-top: 0;
  }
  .help-body p,
  .help-body ul,
  .help-body ol {
    max-width: 40em;
  }
  .help-body section {
    scroll-margin-top: 16px;
  }
  @media (max-width: 599px) {
    .help-toc {
      flex-basis: 100%;
      max-width: none;
    }
  }
</style>`

const tocItem = (section: HelpSection) =>
  html`<li><a href="#${section.id}">${section.title}</a></li>`

/** The safety section brings its own wrapper; the others get one here. */
const sectionOf = (section: HelpSection) =>
  section.id === 'safety'
    ? section.body
    : html`<section id="${section.id}">
        <h2>${section.title}</h2>
        ${section.body}
      </section>`

/**
 * What holds for every slide, so that a slide page only has to show what is
 * particular to it, and how to use the service: putting slides up, sharing,
 * citing, embedding, putting up from an agent and following.
 */
export const helpPage = (lang: Lang, url: URL) => {
  const labels = helpLabels(lang)
  const sections = helpSections(lang)
  return pageShell({
    lang,
    title: labels.title,
    url,
    width: 'wide',
    head: helpStyle,
    body: html`<h1>${labels.title}</h1>
      <div class="help">
        <nav class="help-toc" aria-label="${labels.tocLabel}">
          <ul>
            ${sections.map(tocItem)}
          </ul>
        </nav>
        <div class="help-body">${sections.map(sectionOf)}</div>
      </div>`,
  })
}
