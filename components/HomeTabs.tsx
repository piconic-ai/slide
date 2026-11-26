'use client'

import {
  createEffect,
  createQuery,
  createSignal,
  http,
} from '@barefootjs/client'
import type { HomeDiscover } from '../src/site/home-discover'
import { HOME_TABS, homeTabId, type HomeTab } from '../src/site/home-shape'
import { homeText } from '../src/site/home-text'
import type { Lang } from '../src/site/i18n'
import { HomeTimeline } from './HomeTimeline'

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
 * The top page's lists under one row of tabs (F44-AC1): every public slide,
 * and the slides of the people and communities the visitor follows. The page
 * opens on "all", whoever visits, and the tab is kept nowhere: not in the
 * URL, not across visits (F44-AC2).
 *
 * Both panels are there from the start and fetch their list after the page
 * loads; the tabs only show one of them. The tabs follow the WAI-ARIA
 * pattern (F44-AC3): one of them takes the focus, and the arrow keys, Home
 * and End move it and choose. The carousels of "all" are asked for here, so
 * that timeline is drawn once with them among its slides (F44-AC15).
 */
export function HomeTabs(props: HomeTabsProps) {
  const [tab, setTab] = createSignal<HomeTab>('all')
  const [discover, loadDiscover] = createQuery(
    () => http.get<HomeDiscover>('/api/home/discover'),
    {},
  )
  // Set on the client only: the request never runs on the server.
  const [discoverFailed, setDiscoverFailed] = createSignal(false)
  createEffect(() => setDiscoverFailed(loadDiscover.error() !== undefined))
  // How many follows and unfollows the carousels saved (F44-AC26).
  const [followChanges, setFollowChanges] = createSignal(0)
  const t = homeText[props.lang]
  const names: Readonly<Record<HomeTab, string>> = {
    all: t.tabAll,
    following: t.tabFollowing,
  }

  /** Choose a tab, and bring its button into the row's view. */
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
        id={`${homeTabId('all')}-panel`}
        aria-labelledby={homeTabId('all')}
        hidden={tab() !== 'all'}
      >
        <HomeTimeline
          lang={props.lang}
          scope="all"
          active={tab() === 'all'}
          discover={discover() ?? null}
          discovering={discover() === undefined && !discoverFailed()}
          onFollowChange={() => setFollowChanges(followChanges() + 1)}
        />
      </div>
      <div
        role="tabpanel"
        id={`${homeTabId('following')}-panel`}
        aria-labelledby={homeTabId('following')}
        hidden={tab() !== 'following'}
      >
        <HomeTimeline
          lang={props.lang}
          scope="following"
          active={tab() === 'following'}
          followChanges={followChanges()}
          onShow={(next: HomeTab) => choose(next, true)}
        />
      </div>
    </div>
  )
}
