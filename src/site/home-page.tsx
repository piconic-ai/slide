import { Hono } from 'hono'
import { raw } from 'hono/html'
import { jsxRenderer } from 'hono/jsx-renderer'
import { BfScripts } from '@barefootjs/hono/scripts'
import { RecentDecks } from '@/components/RecentDecks'
import { pageStyle, siteHeader } from '../decks/pages'
import { homeCopy, homeFeatures, homeHero, homeOutro } from '../share/home'
import { homeStyle } from '../share/home-style'
import { siteFooter } from './footer'
import { LANGS, type Lang } from './i18n'
import { SERVICE_NAME } from './service'
import { HOME_ASSET_PATHS } from './home-assets'

// Only the path matters: the switcher links back to the top page.
const topUrl = new URL('/', 'https://slide.invalid')

const homePage = (lang: Lang) => {
  const copy = homeCopy[lang]
  return (
    <html lang={lang}>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width" />
      <title>{`${copy.title} - ${SERVICE_NAME}`}</title>
      {pageStyle}
      <script src="/share.js" defer></script>
      <body>
        {siteHeader(lang)}
        {homeStyle}
        {homeHero(copy)}
        <section className="features">
          <h2 id="recent">{copy.recentHeading}</h2>
          <RecentDecks lang={lang} />
        </section>
        {homeFeatures(copy)}
        {homeOutro(copy)}
        {raw(siteFooter(lang, topUrl))}
        <BfScripts />
      </body>
    </html>
  )
}

/**
 * The top page in every language, generated once at build time. Everything
 * but the recent decks is fixed, so readers get a static file and only the
 * list is fetched. The renderer gives BfScripts the context it collects into.
 */
export const homeSite = new Hono().use(
  jsxRenderer(({ children }) => <>{children}</>, { docType: true }),
)
for (const lang of LANGS)
  homeSite.get(HOME_ASSET_PATHS[lang], (c) => c.render(homePage(lang)))
