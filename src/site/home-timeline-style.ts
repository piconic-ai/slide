import { html } from 'hono/html'

/**
 * The top page's timeline and its carousels (F44). The tabs, the cards'
 * covers and the white pill buttons keep their rules from page-style.ts;
 * this holds what the timeline adds: two columns of slides from 600px, a
 * carousel that spans both, and the small marks of a card's source.
 */
export const timelineStyle = html`<style>
  .timeline-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 32px 24px;
  }
  @media (min-width: 600px) {
    .timeline-list {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }
  .timeline-card {
    min-width: 0;
  }
  .timeline-card .card-cover {
    position: relative;
    display: block;
  }
  /* The cover is the button that turns the card into its slides (F44-AC27). */
  .card-cover-play {
    display: block;
    width: 100%;
    margin: 0;
    padding: 0;
    border: 0;
    border-radius: var(--radius);
    background: none;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .card-cover-play:focus-visible {
    outline: 2px solid var(--foreground);
    outline-offset: 2px;
  }
  /* Once the slides are shown, the cover is out of the way: no focus, no click. */
  .card-cover-play:disabled {
    visibility: hidden;
  }
  /*
   * The slides lie over the cover, in its box, so the title, the author and
   * the link to the viewer stay where they were (F44-AC27). They show once
   * they are known to be slides, and not before.
   */
  .card-frame {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    border: 0;
    border-radius: var(--radius);
    background: var(--stage);
    opacity: 0;
    pointer-events: none;
  }
  .card-frame-shown {
    opacity: 1;
    pointer-events: auto;
  }
  .timeline-card .deck-cover {
    margin-bottom: 0;
  }
  .timeline-card-head {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 8px;
  }
  .timeline-card-title {
    flex: 1 1 auto;
    min-width: 0;
    display: -webkit-box;
    overflow: hidden;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    color: var(--foreground);
    font-size: 16px;
    font-weight: 700;
    line-height: 1.5;
    text-decoration: none;
  }
  /* The link to the viewer: a 44px target around a 36px round icon. */
  .icon-link {
    flex: none;
    display: grid;
    place-items: center;
    width: 44px;
    height: 44px;
    padding: 0;
    border: 0;
    background: none;
    color: var(--foreground);
    text-decoration: none;
    cursor: pointer;
  }
  .icon-link > span {
    display: grid;
    place-items: center;
    width: 36px;
    height: 36px;
    border-radius: var(--radius-full);
    background: var(--secondary);
  }
  .icon-link:hover > span {
    background: var(--border);
  }
  .icon-link:focus-visible {
    outline: 2px solid var(--foreground);
    outline-offset: -2px;
  }
  .icon-link svg {
    width: 18px;
    height: 18px;
  }
  .timeline-card .card-meta,
  .timeline-card .card-source {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0 6px;
    margin: 4px 0 0;
    color: var(--muted-foreground);
    font-size: 13px;
    line-height: 1.6;
  }
  .timeline-card .card-source {
    margin-top: 0;
  }
  .timeline-card .card-meta a,
  .timeline-card .card-source a {
    color: inherit;
  }
  .timeline-card .source-label {
    padding: 0 8px;
    border-radius: var(--radius-full);
    background: var(--secondary);
    white-space: nowrap;
  }
  .timeline-card .community-mark {
    flex: none;
    width: 10px;
    height: 10px;
    border-radius: 3px;
  }
  /* The placeholder of a card that is on its way. */
  .timeline-loading .timeline-card .deck-cover {
    background: var(--secondary);
  }
  .timeline-loading .timeline-card-title {
    min-height: 24px;
  }

  /* A note where the list is empty or could not be read. */
  .home-timeline-note {
    display: flex;
    flex-direction: column;
    gap: 12px;
    align-items: center;
    padding: 48px 16px 0;
    color: var(--muted-foreground);
    text-align: center;
  }
  .home-timeline-note p {
    margin: 0;
  }
  /* A carousel stands across both columns between two slides (F44-AC15). */
  .timeline-carousel {
    grid-column: 1 / -1;
    min-width: 0;
    padding: 20px 0 24px;
    border-top: 1px solid var(--border);
    border-bottom: 1px solid var(--border);
  }
  .carousel-head {
    display: flex;
    align-items: center;
    min-height: 44px;
    margin-bottom: 8px;
  }
  .carousel-title {
    flex: 1 1 auto;
    margin: 0;
    font-size: 13px;
    font-weight: 700;
    line-height: 1.4;
    letter-spacing: 0.1em;
  }
  /* A phone slides the track with a finger; the arrows are for wider screens. */
  @media (max-width: 599px) {
    .carousel-head .icon-link {
      display: none;
    }
  }
  .carousel-track {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    gap: 16px;
    overflow-x: auto;
    overscroll-behavior-x: contain;
    scroll-snap-type: x proximity;
    scrollbar-width: none;
  }
  .carousel-track::-webkit-scrollbar {
    display: none;
  }
  .carousel-card {
    flex: none;
    width: 152px;
    scroll-snap-align: start;
  }
  .carousel-card-community {
    width: 240px;
  }
  /* A card a little narrower than the track shows the next one (F44-AC24). */
  @media (max-width: 599px) {
    .carousel-card-community {
      width: min(240px, 72%);
    }
  }
  .carousel-card-body {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
    box-sizing: border-box;
    height: 100%;
    padding: 16px 12px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    text-align: center;
  }
  .carousel-card-link {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    max-width: 100%;
    color: var(--foreground);
    text-decoration: none;
  }
  .carousel-face {
    position: relative;
    display: grid;
    place-items: center;
    width: 48px;
    height: 48px;
    overflow: hidden;
    border-radius: var(--radius-full);
    font-weight: 700;
    line-height: 1;
  }
  .carousel-face-person {
    background: var(--border);
  }
  .carousel-face-logo {
    border-radius: var(--radius);
  }
  .carousel-face img {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .carousel-face img[hidden] {
    display: none;
  }
  .carousel-names {
    display: block;
    max-width: 100%;
  }
  .carousel-name {
    display: block;
    overflow: hidden;
    font-size: 14px;
    font-weight: 600;
    line-height: 1.7;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .carousel-sub {
    display: block;
    overflow: hidden;
    color: var(--muted-foreground);
    font-size: 13px;
    line-height: 1.6;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .carousel-description {
    display: -webkit-box;
    overflow: hidden;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    min-height: 3.2em;
    margin: 0;
    color: var(--muted-foreground);
    font-size: 13px;
    line-height: 1.6;
  }
  .carousel-card-body .follow-form {
    margin-top: auto;
  }
</style>`
