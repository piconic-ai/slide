import { HomeCommunities } from '@/components/HomeCommunities'
import type { Lang } from './i18n'

/**
 * Where the top page shows a signed-in visitor what the communities they
 * follow got lately, above the new slides of the people they follow
 * (F31-AC3). The page is a static file, so the list is fetched after it
 * loads; a visitor who follows no community gets no section at all.
 */
export const HomeCommunitiesFrame = ({ lang }: { lang: Lang }) => (
  <HomeCommunities lang={lang} />
)
