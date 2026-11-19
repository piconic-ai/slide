import { HomeFollowing } from '@/components/HomeFollowing'
import { HomeOwnSlides } from '@/components/HomeOwnSlides'
import type { Lang } from './i18n'

/**
 * Where a signed-in visitor's own lists go on the top page: their slides,
 * then what the people they follow published. The page is a static file
 * that does not know its visitor, so both start empty and without a
 * heading; each fetches the visitor's lists after the page loads and shows
 * its section only when there is something in it.
 */
export const HomeOwnSlidesFrame = ({ lang }: { lang: Lang }) => (
  <HomeOwnSlides lang={lang} />
)

export const HomeFollowingFrame = ({ lang }: { lang: Lang }) => (
  <HomeFollowing lang={lang} />
)
