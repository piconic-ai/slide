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
export type LiveKind = 'backoff' | 'sandbox' | 'review' | 'notes'

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
  groups: Readonly<{ touch: string; learn: string; creators: string }>
  /** What readers get: touch, understand. */
  readerSections: readonly HomeSection[]
  learnSections: readonly HomeSection[]
  /** What authors get. */
  creatorSections: readonly HomeSection[]
  outro: Readonly<{ body: string }>
}>

export const homeCopy = messages<HomeCopy>({ ja, en })

export const statusBadge = (copy: HomeCopy, status: SectionStatus) =>
  html`<span class="status status-${status}"
    >${copy.statusLabels[status]}</span
  >`

export const sectionHeading = (copy: HomeCopy, section: HomeSection) =>
  html`<h3 id="${section.id}">
    ${section.title} ${statusBadge(copy, section.status)}
  </h3>`

export const featureClass = (flip: boolean) =>
  `feature${flip ? ' feature-flip' : ''}`

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
        <a class="cta" href="/decks">${hero.start}</a>
        <a class="cta cta-quiet" href="#touch">${hero.tryIt}</a>
      </p>
    </div>
    <div class="feature-figure">${hero.figure}</div>
  </section>`

/**
 * Sections alternate sides. Reader sections start with words on the left,
 * and the learning sections after them start on the right.
 */
export const readerFlip = (index: number) => index % 2 === 1
export const learnFlip = (index: number) => index % 2 === 0

/**
 * Creator sections. The reader and learning sections come before them from
 * the page, since their figures are live components.
 */
export const homeFeatures = (copy: HomeCopy) =>
  html`<section id="creators" class="features">
    <h2>${copy.groups.creators}</h2>
    <div class="columns">
      ${copy.creatorSections.map((section) => featureColumn(copy, section))}
    </div>
  </section>`

export const homeOutro = ({ hero, outro }: HomeCopy) =>
  html`<section class="hero">
    <h2>${hero.heading}</h2>
    <p>${outro.body}</p>
    <p><a class="cta" href="/decks">${hero.start}</a></p>
  </section>`
