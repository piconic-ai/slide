import { Hono } from 'hono'
import { raw } from 'hono/html'
import { jsxRenderer } from 'hono/jsx-renderer'
import { BfScripts } from '@barefootjs/hono/scripts'
import { HomeTabs } from '@/components/HomeTabs'
import { siteFooter } from './footer'
import { siteHeader } from './header'
import { HOME_ASSET_PATHS } from './home-assets'
import { HomeDropFrame } from './home-drop-frame'
import { homeText } from './home-text'
import { LANGS, type Lang } from './i18n'
import { pageStyle } from './page-style'
import { pageScripts } from './shell'
import { SERVICE_NAME } from './service'

// Only the path matters: the switcher links back to the top page.
const topUrl = new URL('/', 'https://slide.invalid')

/**
 * The top page explains nothing: it begins with the place to drop slides,
 * and what dropping does says what the service is for. Under it, one row of
 * tabs holds the lists: recent slides, recent communities, the people the
 * visitor follows and the communities they follow (F03-AC158).
 */
const homePage = (lang: Lang) => (
  <html lang={lang}>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>{`${homeText[lang].title} - ${SERVICE_NAME}`}</title>
    {pageStyle}
    {pageScripts}
    {/* The lists are fetched by script. Where none runs, the tabs and their
        placeholders would stay for lists that never come. */}
    <noscript>
      <style>{'.home-list { display: none; }'}</style>
    </noscript>
    <body>
      {siteHeader(lang)}
      <main bf-region="page">
        <div className="page page-wide home" data-member="no">
          <HomeDropFrame lang={lang} />
          <HomeTabs lang={lang} />
        </div>
      </main>
      {raw(siteFooter(lang, topUrl))}
      <BfScripts />
    </body>
  </html>
)

/**
 * The top page in every language, generated once at build time. Everything
 * but the lists is fixed, so readers get a static file and only the lists
 * are fetched. The renderer gives BfScripts the context it collects into.
 */
export const homeSite = new Hono().use(
  jsxRenderer(({ children }) => <>{children}</>, { docType: true }),
)
for (const lang of LANGS)
  homeSite.get(HOME_ASSET_PATHS[lang], (c) => c.render(homePage(lang)))
