'use client'

import { createSignal } from '@barefootjs/client'
import { HOME_TABS, homeTabId, type HomeTab } from '../src/site/home-shape'
import { homeText } from '../src/site/home-text'
import type { Lang } from '../src/site/i18n'
import { HomeCommunities } from './HomeCommunities'
import { HomeFollowing } from './HomeFollowing'
import { NewCommunities } from './NewCommunities'
import { RecentDecks } from './RecentDecks'

interface HomeTabsProps {
  /** The page's language, for the tab names and the lists. */
  lang: Lang
}

/** The tab after `from`, `by` steps on, going round at either end. */
const stepTab = (from: HomeTab, by: number): HomeTab => {
  const at = HOME_TABS.indexOf(from)
  return HOME_TABS[(at + by + HOME_TABS.length) % HOME_TABS.length] ?? from
}

/** The tab a key moves to, or null for a key the tabs leave alone. */
const tabForKey = (key: string, from: HomeTab): HomeTab | null => {
  if (key === 'ArrowRight') return stepTab(from, 1)
  if (key === 'ArrowLeft') return stepTab(from, -1)
  if (key === 'Home') return HOME_TABS[0]
  if (key === 'End') return HOME_TABS[HOME_TABS.length - 1] ?? from
  return null
}

/**
 * The top page's lists under one row of tabs (F03-AC158): recent slides,
 * recent communities, the people the visitor follows, and the communities
 * they follow. The page opens on recent slides, whoever visits, and the
 * tab is kept nowhere: not in the URL, not across visits (F03-AC159).
 *
 * Every panel is there from the start and fetches its list after the page
 * loads, as the sections they replace did; the tabs only show one of them.
 * The tabs follow the WAI-ARIA pattern (F03-AC160): one of them takes the
 * focus, and the arrow keys, Home and End move it and choose.
 */
export function HomeTabs(props: HomeTabsProps) {
  const [tab, setTab] = createSignal<HomeTab>('recent')
  const t = homeText[props.lang]
  const names: Readonly<Record<HomeTab, string>> = {
    recent: t.tabRecent,
    communities: t.tabCommunities,
    following: t.tabFollowing,
    'followed-communities': t.tabFollowedCommunities,
  }

  /** Choose a tab, and bring its button into the row's view (F03-AC171). */
  const choose = (next: HomeTab, focus: boolean) => {
    setTab(next)
    const button = document.getElementById(homeTabId(next))
    if (!button) return
    if (focus) button.focus()
    button.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }

  return (
    <div className="home-list home-tabs">
      <div
        role="tablist"
        aria-label={t.tabsLabel}
        className="home-tab-row"
        onKeyDown={(event: KeyboardEvent) => {
          const next = tabForKey(event.key, tab())
          if (next === null) return
          event.preventDefault()
          choose(next, true)
        }}
      >
        {HOME_TABS.map((name) => (
          <button
            key={name}
            type="button"
            role="tab"
            id={homeTabId(name)}
            aria-controls={`${homeTabId(name)}-panel`}
            aria-selected={tab() === name ? 'true' : 'false'}
            tabindex={tab() === name ? 0 : -1}
            onClick={() => choose(name, false)}
          >
            {names[name]}
          </button>
        ))}
      </div>
      <div
        role="tabpanel"
        id={`${homeTabId('recent')}-panel`}
        aria-labelledby={homeTabId('recent')}
        hidden={tab() !== 'recent'}
      >
        <RecentDecks lang={props.lang} active={tab() === 'recent'} />
      </div>
      <div
        role="tabpanel"
        id={`${homeTabId('communities')}-panel`}
        aria-labelledby={homeTabId('communities')}
        hidden={tab() !== 'communities'}
      >
        <NewCommunities lang={props.lang} active={tab() === 'communities'} />
      </div>
      <div
        role="tabpanel"
        id={`${homeTabId('following')}-panel`}
        aria-labelledby={homeTabId('following')}
        hidden={tab() !== 'following'}
      >
        <HomeFollowing
          lang={props.lang}
          active={tab() === 'following'}
          onShow={(next: HomeTab) => choose(next, true)}
        />
      </div>
      <div
        role="tabpanel"
        id={`${homeTabId('followed-communities')}-panel`}
        aria-labelledby={homeTabId('followed-communities')}
        hidden={tab() !== 'followed-communities'}
      >
        <HomeCommunities
          lang={props.lang}
          active={tab() === 'followed-communities'}
          onShow={(next: HomeTab) => choose(next, true)}
        />
      </div>
    </div>
  )
}
