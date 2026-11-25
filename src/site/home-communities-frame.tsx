import { HomeCommunities } from '@/components/HomeCommunities'
import type { Lang } from './i18n'

/**
 * Where the top page shows a signed-in visitor what the communities they
 * follow got lately, above the new slides of the people they follow
 * (F31-AC3). The page is a static file, so the list is fetched after it
 * loads. The Worker marks the page for a visitor who follows a community,
 * who alone gets the section's room from the start (F31-AC16); anyone else
 * gets no section at all (F31-AC6).
 */
export const HomeCommunitiesFrame = ({ lang }: { lang: Lang }) => (
  <HomeCommunities lang={lang} />
)
