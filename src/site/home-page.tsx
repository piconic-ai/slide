import { Hono } from 'hono'
import { raw } from 'hono/html'
import { jsxRenderer } from 'hono/jsx-renderer'
import { BfScripts } from '@barefootjs/hono/scripts'
import { RecentDecks } from '@/components/RecentDecks'
import { pageStyle, siteHeader } from '../decks/pages'
import { homeFeatures, homeHero, homeOutro, homeStyle } from '../share/home'
import { siteFooter } from './footer'

/**
 * The top page, generated once at build time. Everything but the recent
 * decks is fixed, so readers get a static file and only the list is
 * fetched. The renderer gives BfScripts the context it collects into.
 */
// Only the path matters: the switcher links back to the top page.
const topUrl = new URL('/', 'https://slide.invalid')

export const homeSite = new Hono()
  .use(jsxRenderer(({ children }) => <>{children}</>, { docType: true }))
  .get('/', (c) =>
    c.render(
      <html lang="ja">
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width" />
        <title>さわって、わかる - Slide</title>
        {pageStyle}
        <script src="/share.js" defer></script>
        <body>
          {siteHeader}
          {homeStyle}
          {homeHero}
          <section className="features">
            <h2 id="recent">最近公開されたスライド</h2>
            <RecentDecks />
          </section>
          {homeFeatures}
          {homeOutro}
          {raw(siteFooter('ja', topUrl))}
          <BfScripts />
        </body>
      </html>,
    ),
  )
