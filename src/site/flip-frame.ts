import { framesSlides } from './home-flip'

/**
 * The browser side of a card turned into its slides (F44-AC27, AC28): what
 * a frame holds once it has loaded, where the focus goes, and when the card
 * leaves the screen. The decisions are in home-flip.ts.
 */

/** The document in a frame of the service's own origin; null where it cannot be read. */
const documentOf = (frame: HTMLIFrameElement) => {
  try {
    return frame.contentDocument
  } catch {
    return null
  }
}

/** Whether the frame holds the slides: not a 404 the browser refused to frame. */
export const frameHoldsSlides = (frame: HTMLIFrameElement) =>
  framesSlides(documentOf(frame))

/**
 * Puts the focus in the slides, so the keys that turn pages reach them
 * where the card was chosen by key.
 */
export function focusSlides(frame: HTMLIFrameElement) {
  const slides = documentOf(frame)?.querySelector<HTMLIFrameElement>('#deck')
  ;(slides ?? frame).focus()
}

/**
 * Calls `leave` when none of the element is on the screen any longer, and
 * returns what stops the watch. Where the browser cannot tell, it never
 * calls: the card stays until another is opened.
 */
export function watchLeaving(element: Element, leave: () => void) {
  if (typeof IntersectionObserver === 'undefined') return () => {}
  const observer = new IntersectionObserver((entries) => {
    if (entries.some((entry) => !entry.isIntersecting)) leave()
  })
  observer.observe(element)
  return () => observer.disconnect()
}
