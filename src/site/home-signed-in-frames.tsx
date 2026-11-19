/**
 * Where a signed-in visitor's own lists go on the top page: their slides,
 * then what the people they follow published. The page is a static file
 * that does not know its visitor, so both start hidden and without a
 * heading; the feature that fills a frame fetches its list after the page
 * loads and shows the frame only when there is something in it.
 */
export const HomeOwnSlidesFrame = () => (
  <section data-home-frame="own-slides" hidden></section>
)

export const HomeFollowingFrame = () => (
  <section data-home-frame="following" hidden></section>
)
