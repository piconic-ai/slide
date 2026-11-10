import { html } from 'hono/html'

/** Styles only the top page needs; the shared page style stays small. */
export const homeStyle = html`<style>
  .hero-split {
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
    background: white;
    color: #153b70;
    border: 1px solid #c4cedd;
  }
  .features {
    border-top: 1px solid #d6dde8;
    margin-top: 48px;
    padding-top: 32px;
  }
  .features h2 {
    font-size: 14px;
    letter-spacing: 0.1em;
    color: #4f5f78;
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
    color: #3b4a62;
    font-size: 15px;
    margin: 0 0 12px;
  }
  .status {
    display: inline-block;
    vertical-align: middle;
    font-size: 12px;
    font-weight: 600;
    line-height: 1;
    padding: 5px 8px;
    border-radius: 999px;
    white-space: nowrap;
  }
  .status-done {
    color: #1f6f43;
    background: #e6f4ea;
  }
  .status-wip {
    color: #153b70;
    background: #e7eef9;
  }
  .status-spec {
    color: #4f5f78;
    background: #eef1f6;
    border: 1px dashed #c4cedd;
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
    font-family: ui-monospace, Menlo, Consolas, monospace;
  }
  .mock-url {
    font-family: ui-monospace, Menlo, Consolas, monospace;
    font-size: 12px;
    color: #4f5f78;
    margin: 0 0 6px;
  }
  .mock-slide {
    position: relative;
    max-width: 100%;
    aspect-ratio: 16 / 9;
    box-sizing: border-box;
    padding: 20px 22px;
    border-radius: 8px;
    background: #111111;
    color: white;
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
    color: #777777;
    font-family: ui-monospace, Menlo, monospace;
  }
  .mock-controls {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
    color: #aaaaaa;
  }
  .mock-range {
    display: inline-block;
    width: clamp(48px, 18vw, 110px);
    height: 4px;
    border-radius: 2px;
    background: linear-gradient(to right, white 40%, #444444 40%);
  }
  .mock-range.short {
    width: clamp(40px, 14vw, 90px);
    background: linear-gradient(to right, white 50%, #444444 50%);
  }
  .mock-timeline {
    list-style: none;
    margin: 0 10px;
    padding: 0;
    flex: 1 1 auto;
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-family: ui-monospace, Menlo, monospace;
  }
  .mock-timeline li {
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
    background: white;
  }
  .mock-timeline small {
    color: #888888;
    font-size: 10px;
  }
  .mock-note,
  .mock-log {
    color: #aaaaaa;
    font-size: 11px;
  }
  .mock-code,
  .mock-log,
  .mock-button {
    font-family: ui-monospace, Menlo, monospace;
  }
  .mock-button {
    align-self: flex-start;
    padding: 6px 10px;
    border: 1px solid #444444;
    border-radius: 5px;
    background: #1c1c1c;
  }
  .mock-card {
    border: 1px solid #d6dde8;
    border-radius: 8px;
    background: white;
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
    color: #4f5f78;
  }
  .mock-card-head {
    border-bottom: 1px solid #d6dde8;
  }
  .mock-card-foot {
    border-top: 1px solid #d6dde8;
  }
  .mock-toggle {
    display: inline-flex;
    border: 1px solid #c4cedd;
    border-radius: 6px;
    overflow: hidden;
  }
  .mock-toggle > * {
    padding: 4px 10px;
    font-weight: 600;
  }
  .mock-toggle > b {
    background: #152439;
    color: white;
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
    border-right: 1px solid #d6dde8;
  }
  .mock-axes li {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    padding: 10px 14px;
    border-bottom: 1px solid #eef1f6;
  }
  .mock-axes li span:last-child {
    font-family: ui-monospace, Menlo, monospace;
  }
  .mock-axes .is-selected {
    background: #152439;
    color: white;
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
    color: #4f5f78;
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
  .mock-note-row p {
    margin: 0;
    font-size: 13px;
    line-height: 1.7;
    min-width: 0;
  }
  .mock-note-row small {
    display: block;
    color: #4f5f78;
    font-size: 11px;
  }
  .mock-thumb {
    flex: none;
    width: 112px;
    aspect-ratio: 16 / 9;
    box-sizing: border-box;
    padding: 6px;
    border-radius: 4px;
    background: #111111;
    color: white;
    font-size: 10px;
    font-weight: 700;
    display: flex;
    align-items: flex-end;
    line-height: 1.3;
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
    border-bottom: 1px solid #eef1f6;
    line-height: 1.5;
  }
  .mock-course li:last-child {
    border-bottom: 0;
  }
  .mock-course li > span:nth-child(2) {
    flex: 1 1 auto;
    min-width: 0;
  }
  .mock-course li > span:last-child {
    flex: none;
    font-size: 12px;
    color: #4f5f78;
  }
  .mock-course .mock-thumb {
    width: 80px;
  }
  .mock-course small {
    display: block;
    font-size: 12px;
    color: #4f5f78;
  }
  .mock-course .is-current {
    font-weight: 600;
  }
  .mock-course .is-locked {
    color: #4f5f78;
  }
  .mock-course .is-locked .mock-thumb {
    background: #d6dde8;
  }
  .mock-kv {
    margin: 0;
    font-size: 14px;
  }
  .mock-kv > div {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    padding: 10px 0;
    border-bottom: 1px solid #d6dde8;
  }
  .mock-kv dt,
  .mock-kv dd {
    margin: 0;
  }
  .mock-kv dd {
    color: #4f5f78;
    text-align: right;
  }
  .mock-yaml {
    background: #111111;
    color: #dddddd;
    border: 0;
    border-radius: 6px;
    padding: 14px 16px;
    font-size: 12px;
    line-height: 1.7;
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
  .recent-cover {
    position: relative;
    aspect-ratio: 16 / 9;
    box-sizing: border-box;
    padding: 16px 18px;
    border-radius: 8px;
    background: #111111;
    display: flex;
    align-items: center;
    overflow: hidden;
  }
  /* Placeholders hold the carousel's height until the decks arrive. */
  .recent-loading .recent-cover {
    background: #e3e8f0;
  }
  .recent-message .recent-cover {
    background: #eef1f6;
  }
  .recent-message .empty {
    margin: 0;
  }
  .recent-cover:has(.card-title:focus-visible) {
    outline: 2px solid #153b70;
    outline-offset: 2px;
  }
  .recent-cover .card-title {
    color: white;
    font-size: 17px;
    font-weight: 700;
    line-height: 1.4;
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
  /* Last, so it wins over the base mock rules of the same specificity. */
  @media (max-width: 520px) {
    .mock-slide {
      aspect-ratio: auto;
      min-height: 200px;
    }
  }
</style>`
