import { html } from 'hono/html'
import type { HtmlEscapedString } from 'hono/utils/html'
import { messages } from '../site/i18n'
import { en } from './home-en'
import { ja } from './home-ja'

export type Html = HtmlEscapedString | Promise<HtmlEscapedString>

/**
 * Where a promised capability stands. The top page shows the product as it
 * is meant to be, so each section carries its state instead of hiding
 * unbuilt parts.
 */
export type SectionStatus = 'done' | 'wip' | 'spec'

export type HomeSection = Readonly<{
  id: string
  title: string
  status: SectionStatus
  /** Explanatory paragraphs; plain text, escaped on output. */
  body: readonly string[]
  /**
   * A mock of the screen the section describes, or a slide the page renders
   * as a live client component under the address bar `path`.
   */
  figure: Html | LiveFigure
}>

/** The slides the page renders as client components, by name. */
export type LiveKind = 'backoff' | 'review' | 'notes'

export type LiveFigure = Readonly<{ live: LiveKind; path: string }>

export const isLive = (figure: Html | LiveFigure): figure is LiveFigure =>
  typeof figure === 'object' && 'live' in figure

/** The top page's wording and mock screens in one language. */
export type HomeCopy = Readonly<{
  title: string
  statusLabels: Readonly<Record<SectionStatus, string>>
  hero: Readonly<{
    heading: string
    lead: string
    start: string
    tryIt: string
    figure: Html
  }>
  recentHeading: string
  groups: Readonly<{
    touch: string
    learn: string
    gather: string
    creators: string
  }>
  /** What readers get: touch, understand. */
  readerSections: readonly HomeSection[]
  learnSections: readonly HomeSection[]
  /** What gathers around a deck: its event, citations and reactions. */
  gatherSections: readonly HomeSection[]
  /** What authors get. */
  creatorSections: readonly HomeSection[]
  outro: Readonly<{ body: string }>
}>

export const homeCopy = messages<HomeCopy>({ ja, en })

export const statusBadge = (copy: HomeCopy, status: SectionStatus) =>
  html`<span class="status-chip status-chip-${status}"
    >${copy.statusLabels[status]}</span
  >`

export const sectionHeading = (copy: HomeCopy, section: HomeSection) =>
  html`<h3 id="${section.id}">
    ${section.title} ${statusBadge(copy, section.status)}
  </h3>`

/** A pillar color-block. Ecru and navy are separate; they have no drawn shapes. */
export type ColorBlock = 'yellow' | 'blue' | 'red'

export const featureClass = (flip: boolean, tone?: ColorBlock) =>
  [
    'feature',
    flip ? 'feature-flip' : '',
    tone ? `color-block color-block-${tone}` : '',
  ]
    .filter((part) => part !== '')
    .join(' ')

const hiddenShape = (className: string) =>
  html`<span class="${className}" aria-hidden="true"></span>`

/**
 * Cut-paper shapes for one pillar, at the rest positions in
 * `slide-design-handoff/preview/index.html`. Stage 8 adds the motion.
 */
export const blockShapes = (tone: ColorBlock) => {
  switch (tone) {
    case 'yellow':
      return html`${hiddenShape('block-shape shape-touch-circle')}${hiddenShape(
        'block-shape shape-touch-track',
      )}${hiddenShape('block-shape block-shape-accent shape-touch-knob')}`
    case 'blue':
      return html`${hiddenShape('block-shape shape-learn-sheet')}${hiddenShape(
        'block-shape block-shape-accent shape-learn-line-long',
      )}${hiddenShape('block-shape shape-learn-line-short')}`
    case 'red':
      return html`${hiddenShape('block-shape shape-gather-a')}${hiddenShape(
        'block-shape block-shape-accent shape-gather-b',
      )}${hiddenShape('block-shape block-shape-accent shape-gather-c')}`
  }
}

/** A section's heading and paragraphs, beside its figure. */
export const featureText = (copy: HomeCopy, section: HomeSection) =>
  html`<div class="feature-text">
    ${sectionHeading(copy, section)}
    ${section.body.map((paragraph) => html`<p>${paragraph}</p>`)}
  </div>`

const featureColumn = (copy: HomeCopy, section: HomeSection) =>
  html`<div class="column">
    ${sectionHeading(copy, section)}
    ${section.body.map((paragraph) => html`<p>${paragraph}</p>`)}
    ${isLive(section.figure) ? '' : section.figure}
  </div>`

/** The top of the page: the one line, both ways in, and one slide. */
export const homeHero = ({ hero }: HomeCopy) =>
  html`<section class="hero hero-split">
    <div class="feature-text">
      <h1>${hero.heading}</h1>
      <p>${hero.lead}</p>
      <p class="actions">
        <a class="cta" href="/start">${hero.start}</a>
        <a class="cta cta-quiet" href="#touch">${hero.tryIt}</a>
      </p>
    </div>
    <div class="feature-figure">${hero.figure}</div>
  </section>`

/**
 * Sections alternate sides from one to the next, across the groups: the
 * first has its words on the left. Each group continues where the one
 * before it stopped, however many sections that one has.
 */
export function groupFlips(
  copy: Pick<HomeCopy, 'readerSections' | 'learnSections' | 'gatherSections'>,
) {
  const from = (before: number) => (index: number) => (before + index) % 2 === 1
  const readers = copy.readerSections.length
  return {
    reader: from(0),
    learn: from(readers),
    gather: from(readers + copy.learnSections.length),
  }
}

/**
 * Creator sections. The first is an ecru color-block and the rest stay on
 * white. Ecru shapes are still only described in DESIGN.md, so none are drawn.
 */
export const homeFeatures = (copy: HomeCopy) => {
  const [first, ...rest] = copy.creatorSections
  return html`<section id="creators" class="features">
    <h2>${copy.groups.creators}</h2>
    ${
      first
        ? html`<div class="feature color-block color-block-ecru">
            ${featureText(copy, first)}
            <div class="feature-figure">
              ${isLive(first.figure) ? '' : first.figure}
            </div>
          </div>`
        : ''
    }
    ${
      rest.length === 0
        ? ''
        : html`<div class="columns">
            ${rest.map((section) => featureColumn(copy, section))}
          </div>`
    }
  </section>`
}

export const homeOutro = ({ hero, outro }: HomeCopy) =>
  html`<section class="hero color-block color-block-navy">
    <h2>${hero.heading}</h2>
    <p>${outro.body}</p>
    <p><a class="cta" href="/start">${hero.start}</a></p>
  </section>`
