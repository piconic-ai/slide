import { html } from 'hono/html'
import { designTokensCssRaw } from '../site/design-tokens'

/** Styles only the top page needs; the shared page style stays small. */
export const homeStyle = html`<style>
  ${designTokensCssRaw} .hero-split {
    display: flex;
    flex-wrap: wrap;
    gap: 32px;
    align-items: center;
  }
  .hero-split > .feature-text {
    flex: 1 1 320px;
  }
  .hero-split > .feature-figure {
    flex: 1 1 360px;
  }
  .hero .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
  }
  .cta-quiet {
    background: var(--card);
    color: var(--primary);
    border: 1px solid var(--input);
  }
  .features {
    border-top: 1px solid var(--border);
    margin-top: 48px;
    padding-top: 32px;
  }
  .features h2 {
    font-size: 14px;
    letter-spacing: 0.1em;
    color: var(--muted-foreground);
    margin: 0 0 32px;
  }
  .features h3 {
    font-size: 24px;
    line-height: 1.35;
    margin: 0 0 12px;
  }
  .feature-text p,
  .column p {
    line-height: 1.9;
    color: var(--ink-body);
    font-size: 15px;
    margin: 0 0 12px;
  }
  .status-chip {
    display: inline-block;
    vertical-align: middle;
    padding: 4px 10px;
    border-radius: var(--radius-full);
    background: var(--secondary);
    color: var(--foreground);
    font-size: 13px;
    font-weight: 400;
    line-height: 1.6;
    white-space: nowrap;
  }
  .status-chip-done {
    background: var(--success-soft);
    color: var(--success);
  }
  .status-chip-wip {
    background: var(--warning-soft);
    color: var(--warning);
  }
  .status-chip-spec {
    background: var(--background);
    color: var(--muted-foreground);
    border: 1px dashed var(--input);
  }
  .feature {
    display: flex;
    flex-wrap: wrap;
    gap: 32px;
    align-items: center;
    margin-bottom: 56px;
  }
  .feature-text {
    flex: 1 1 280px;
    min-width: 0;
  }
  .feature-figure {
    flex: 1.4 1 360px;
    min-width: 0;
  }
  /* Side by side only when wide; stacked, the heading always comes first. */
  @media (min-width: 760px) {
    .feature-flip > .feature-text {
      order: 2;
    }
  }
  .color-block {
    position: relative;
    overflow: hidden;
    isolation: isolate;
    border-radius: var(--radius-block);
    padding: var(--space-block);
    color: var(--foreground);
  }
  .color-block-yellow {
    --shape: var(--block-yellow-deep);
    --shape-accent: var(--block-yellow-deeper);
    background: var(--block-yellow);
  }
  .color-block-blue {
    --shape: var(--block-blue-deep);
    --shape-accent: var(--block-blue-deeper);
    background: var(--block-blue);
  }
  .color-block-red {
    --shape: var(--block-red-deep);
    --shape-accent: var(--block-red-deeper);
    background: var(--block-red);
  }
  .color-block-ecru {
    background: var(--block-ecru);
  }
  .color-block-navy {
    margin-top: var(--space-section);
    background: var(--block-navy);
    color: var(--block-navy-foreground);
    /* Dark ground: ink --ring is ~1.7:1; use white like DESIGN.md says. */
    --ring: var(--block-navy-foreground);
  }
  .color-block-navy .cta {
    background: var(--background);
    color: var(--foreground);
  }
  .color-block > :not(.block-shape) {
    position: relative;
    z-index: 1;
  }
  .color-block > .feature-text h3,
  .color-block.hero > h2 {
    font-size: 24px;
    font-weight: 700;
    line-height: 1.4;
  }
  .color-block > .feature-text p,
  .color-block.hero > p {
    color: inherit;
    font-size: 18px;
    line-height: 1.8;
  }
  .color-block .mock-url {
    color: inherit;
  }
  .block-shape {
    position: absolute;
    z-index: 0;
    background: var(--shape);
    pointer-events: none;
  }
  .block-shape-accent {
    background: var(--shape-accent);
  }
  .shape-touch-circle {
    right: -60px;
    bottom: -90px;
    width: 300px;
    height: 300px;
    border-radius: 50%;
  }
  .shape-touch-track {
    left: -40px;
    bottom: 36px;
    width: 260px;
    height: 18px;
    border-radius: var(--radius-full);
  }
  .shape-touch-knob {
    left: 150px;
    bottom: 20px;
    width: 50px;
    height: 50px;
    border-radius: 50%;
  }
  .shape-learn-sheet {
    right: -40px;
    top: -40px;
    width: 210px;
    height: 120px;
    border-radius: var(--radius-block);
  }
  .shape-learn-line-long {
    right: -20px;
    bottom: 44px;
    width: 150px;
    height: 20px;
    border-radius: var(--radius-full);
  }
  .shape-learn-line-short {
    right: -20px;
    bottom: 14px;
    width: 96px;
    height: 20px;
    border-radius: var(--radius-full);
  }
  .shape-gather-a {
    right: -70px;
    bottom: -90px;
    width: 210px;
    height: 210px;
    border-radius: 50%;
  }
  .shape-gather-b {
    right: 50px;
    bottom: -110px;
    width: 170px;
    height: 170px;
    border-radius: 50%;
    mix-blend-mode: multiply;
    opacity: 0.7;
  }
  .shape-gather-c {
    right: 16px;
    top: -30px;
    width: 84px;
    height: 84px;
    border-radius: 50%;
  }
  @media (max-width: 599px) {
    .block-shape:not(.block-shape-accent) {
      display: none;
    }
  }
  .columns {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
    gap: 32px;
  }
  .column {
    min-width: 0;
  }
  .column h3 {
    font-size: 20px;
  }
  .mono {
    font-family: var(--font-mono);
  }
  .mock-url {
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--muted-foreground);
    margin: 0 0 6px;
  }
  .mock-slide {
    position: relative;
    max-width: 100%;
    aspect-ratio: 16 / 9;
    box-sizing: border-box;
    padding: 20px 22px;
    border-radius: var(--radius);
    background: var(--stage);
    color: var(--primary-foreground);
    display: flex;
    flex-direction: column;
    gap: 10px;
    overflow: hidden;
    font-size: 12px;
  }
  .mock-cover {
    justify-content: center;
    font-size: clamp(20px, 3.4vw, 30px);
    font-weight: 700;
    line-height: 1.35;
  }
  /*
   * A live slide grows with its timeline: without clipping, 16:9 is only
   * the least height, so the largest values stay readable at any width.
   */
  .mock-live {
    overflow: visible;
  }
  .mock-title {
    font-size: 15px;
    font-weight: 700;
    line-height: 1.4;
  }
  .mock-no {
    position: absolute;
    right: 14px;
    bottom: 8px;
    font-size: 11px;
    color: var(--primary-foreground);
    font-family: var(--font-mono);
  }
  .mock-controls {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
  }
  .mock-control {
    display: inline-flex;
    gap: 6px;
    align-items: center;
  }
  .mock-control input {
    width: clamp(64px, 18vw, 120px);
    margin: 0;
    accent-color: var(--primary-foreground);
  }
  .mock-control output {
    min-width: 2.5em;
    color: var(--primary-foreground);
    font-family: var(--font-mono);
  }
  .mock-timeline {
    list-style: none;
    margin: 0 10px;
    padding: 0;
    flex: 1 1 auto;
    /* Columns of equal width that wrap into rows when tries outgrow it. */
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(48px, 1fr));
    gap: 8px 4px;
    align-content: center;
    font-family: var(--font-mono);
  }
  .mock-timeline li {
    white-space: nowrap;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    font-size: 11px;
  }
  .mock-timeline b {
    font-weight: 400;
  }
  .mock-timeline i {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: var(--card);
  }
  .mock-timeline small {
    font-size: 10px;
  }
  .mock-note {
    font-size: 11px;
  }
  .mock-card {
    border: 0;
    border-radius: var(--radius);
    background: var(--background);
    overflow: hidden;
    font-size: 13px;
  }
  .mock-card-head,
  .mock-card-foot {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    gap: 8px 12px;
    padding: 10px 14px;
    color: var(--muted-foreground);
  }
  .mock-card-head {
    border-bottom: 1px solid var(--border);
  }
  .mock-card-foot {
    border-top: 1px solid var(--border);
  }
  .mock-toggle {
    display: inline-flex;
    border: 1px solid var(--input);
    border-radius: var(--radius-sm);
    overflow: hidden;
  }
  .mock-toggle button {
    padding: 4px 10px;
    border: 0;
    background: transparent;
    color: inherit;
    font: inherit;
    font-weight: 600;
    cursor: pointer;
  }
  .mock-toggle [aria-pressed='true'] {
    background: var(--foreground);
    color: var(--primary-foreground);
  }
  .mock-review {
    display: flex;
    flex-wrap: wrap;
  }
  .mock-axes {
    list-style: none;
    margin: 0;
    padding: 0;
    flex: 1 1 200px;
    border-right: 1px solid var(--border);
  }
  .mock-axes li {
    border-bottom: 1px solid var(--border-soft);
  }
  .mock-axes button {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    width: 100%;
    padding: 10px 14px;
    border: 0;
    background: transparent;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .mock-axes button span:last-child {
    font-family: var(--font-mono);
  }
  .mock-axes [aria-pressed='true'] {
    background: var(--foreground);
    color: var(--primary-foreground);
  }
  .mock-finding {
    flex: 1.3 1 240px;
    padding: 14px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .mock-finding p {
    margin: 0;
    font-size: 13px;
    line-height: 1.7;
  }
  .mock-finding small {
    color: var(--muted-foreground);
    font-size: 11px;
  }
  .mock-notes {
    padding: 14px;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  .mock-note-row {
    display: flex;
    gap: 12px;
    align-items: flex-start;
  }
  /* What the speaker said: set apart from the slide as a quoted aside. */
  .mock-speaker {
    min-width: 0;
    padding: 8px 12px;
    border-left: 3px solid var(--foreground);
    border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
    background: var(--surface-note);
  }
  .mock-speaker small {
    display: block;
    margin-bottom: 4px;
    color: var(--muted-foreground);
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.04em;
  }
  .mock-speaker p {
    margin: 0;
    font-size: 13px;
    line-height: 1.7;
  }
  /* The notes card keeps both views; the toggle hides one of them. */
  .mock-notes[hidden],
  .mock-flip[hidden] {
    display: none;
  }
  .mock-flip {
    padding: 14px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .mock-pager {
    display: flex;
    justify-content: center;
    align-items: center;
    gap: 12px;
    color: var(--muted-foreground);
  }
  .mock-pager button {
    width: 32px;
    height: 32px;
    border: 1px solid var(--input);
    border-radius: var(--radius-sm);
    background: var(--card);
    color: var(--foreground);
    font: inherit;
    font-size: 16px;
    cursor: pointer;
  }
  .mock-pager button:disabled {
    color: var(--input);
    cursor: default;
  }
  .mock-thumb {
    flex: none;
    width: 112px;
    aspect-ratio: 16 / 9;
    box-sizing: border-box;
    padding: 6px;
    border-radius: var(--radius-xs);
    background: var(--stage);
    color: var(--primary-foreground);
    font-size: 10px;
    font-weight: 700;
    display: flex;
    align-items: flex-end;
    line-height: 1.3;
  }
  .mock-posts {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .mock-posts li {
    padding: 10px 14px;
    border-bottom: 1px solid var(--border-soft);
    line-height: 1.6;
  }
  .mock-posts li:last-child {
    border-bottom: 0;
  }
  .mock-posts small {
    display: block;
    font-size: 12px;
    color: var(--muted-foreground);
  }
  .mock-course {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .mock-course li {
    display: flex;
    gap: 12px;
    align-items: center;
    padding: 10px 14px;
    border-bottom: 1px solid var(--border-soft);
    line-height: 1.5;
  }
  .mock-course li:last-child {
    border-bottom: 0;
  }
  .mock-course li > span:nth-child(2) {
    flex: 1 1 auto;
    min-width: 0;
  }
  .mock-course li > span:nth-child(3) {
    flex: none;
    font-size: 12px;
    color: var(--muted-foreground);
  }
  .mock-course .mock-thumb {
    width: 80px;
  }
  .mock-course small {
    display: block;
    font-size: 12px;
    color: var(--muted-foreground);
  }
  .mock-course .is-current {
    font-weight: 600;
  }
  .mock-course .is-locked {
    color: var(--muted-foreground);
  }
  .mock-kv {
    margin: 0;
    padding: 4px 16px;
    border-radius: var(--radius);
    background: var(--background);
    font-size: 14px;
  }
  .mock-kv > div {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    padding: 10px 0;
    border-bottom: 1px solid var(--border);
  }
  .mock-kv dt,
  .mock-kv dd {
    margin: 0;
  }
  .mock-kv dd {
    color: var(--muted-foreground);
    text-align: right;
  }
  .mock-yaml {
    background: var(--background);
    color: var(--foreground);
    border: 0;
    border-radius: var(--radius);
    padding: 14px 16px;
    font-size: 13px;
    line-height: 1.6;
  }
  /* Recent decks scroll sideways; each snaps to the start edge. */
  .recent-list {
    list-style: none;
    /* Room for the focus ring, which the scroll container would clip. */
    margin: 0 -4px;
    padding: 4px 4px 12px;
    scroll-padding-inline: 4px;
    display: grid;
    grid-auto-flow: column;
    grid-auto-columns: min(300px, 80%);
    gap: 16px;
    overflow-x: auto;
    overscroll-behavior-x: contain;
    scroll-snap-type: x mandatory;
  }
  .recent-list > * {
    min-width: 0;
    scroll-snap-align: start;
  }
  .deck-card {
    background: none;
    border: 0;
    padding: 0;
  }
  .recent-list .card-meta {
    color: var(--muted-foreground);
    font-size: 13px;
    font-weight: 400;
    line-height: 1.6;
  }
  .recent-cover {
    position: relative;
    aspect-ratio: 16 / 9;
    /* Grid min-height:auto would grow past the ratio when copy wraps. */
    min-height: 0;
    width: 100%;
    box-sizing: border-box;
    padding: 16px 18px;
    border-radius: var(--radius);
    background: var(--stage);
    display: flex;
    align-items: center;
    overflow: hidden;
  }
  /* Placeholders hold the carousel's height until the decks arrive. */
  .recent-loading .recent-cover {
    background: var(--secondary);
  }
  .recent-message .recent-cover {
    background: var(--secondary);
  }
  /* Sit in the cover without changing its reserved size. */
  .recent-message .empty {
    position: absolute;
    inset: 16px 18px;
    margin: 0;
    display: flex;
    align-items: center;
  }
  .recent-cover:has(.card-title:focus-visible) {
    outline: 2px solid var(--primary);
    outline-offset: 2px;
  }
  .recent-cover .card-title {
    color: var(--primary-foreground);
    font-size: 18px;
    font-weight: 700;
    line-height: 1.5;
    text-decoration: none;
    overflow-wrap: anywhere;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 3;
    overflow: hidden;
  }
  /* The whole cover opens the deck, not just its title text. */
  .recent-cover .card-title::after {
    content: '';
    position: absolute;
    inset: 0;
  }
  .recent-cover .card-title:focus {
    outline: none;
  }
  /*
   * The cover image fills the card once it has loaded; until then, and when
   * it cannot be loaded, the card shows the name. The link's ::after stays
   * over the image, so the whole cover still opens the deck.
   */
  .recent-cover img {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
    opacity: 0;
    pointer-events: none;
  }
  .recent-cover img.drawn {
    opacity: 1;
  }
  /* Hidden from sight only: the link keeps its name for assistive tools. */
  .recent-cover img.drawn + .card-title {
    opacity: 0;
  }
  /* Last, so it wins over the base mock rules of the same specificity. */
  @media (max-width: 520px) {
    .mock-slide {
      aspect-ratio: auto;
      min-height: 200px;
    }
  }
</style>`
