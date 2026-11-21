import { HomeFollowing } from '@/components/HomeFollowing'
import type { Lang } from './i18n'

/**
 * Where a signed-in visitor's own list goes on the top page: what the people
 * they follow published. The page is a static file that does not know its
 * visitor, so the frame starts as a placeholder of the section's full size
 * (shown only where the Worker saw a session; see `viewerMarked`) and
 * fetches the visitor's list after the page loads.
 */
export const HomeFollowingFrame = ({ lang }: { lang: Lang }) => (
  <HomeFollowing lang={lang} />
)
