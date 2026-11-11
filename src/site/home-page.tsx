import { Hono } from 'hono'
import { raw } from 'hono/html'
import { jsxRenderer } from 'hono/jsx-renderer'
import { BfScripts } from '@barefootjs/hono/scripts'
import { BackoffDemo } from '@/components/BackoffDemo'
import { NotesDemo } from '@/components/NotesDemo'
import { RecentDecks } from '@/components/RecentDecks'
import { ReviewDemo } from '@/components/ReviewDemo'
import { SandboxDemo } from '@/components/SandboxDemo'
import { pageStyle, siteHeader } from '../decks/pages'
import {
  featureClass,
  featureText,
  homeCopy,
  homeFeatures,
  homeHero,
  homeOutro,
  isLive,
  learnFlip,
  readerFlip,
  type HomeSection,
  type LiveKind,
} from '../share/home'
import { slideUrl } from '../share/home-mock'
import { homeStyle } from '../share/home-style'
import { siteFooter } from './footer'
import { LANGS, type Lang } from './i18n'
import { SERVICE_NAME } from './service'
import { HOME_ASSET_PATHS } from './home-assets'

// Only the path matters: the switcher links back to the top page.
const topUrl = new URL('/', 'https://slide.invalid')

/** The client component behind a live figure. */
const liveSlide = (live: LiveKind, lang: Lang) => {
  switch (live) {
    case 'backoff':
      return <BackoffDemo lang={lang} />
    case 'sandbox':
      return <SandboxDemo lang={lang} />
    case 'review':
      return <ReviewDemo lang={lang} />
    case 'notes':
      return <NotesDemo lang={lang} />
  }
}

/** A section's figure: a mocked screen, or a live slide. */
const figureOf = (section: HomeSection, lang: Lang) =>
  isLive(section.figure) ? (
    <>
      {slideUrl(section.figure.path)}
      {liveSlide(section.figure.live, lang)}
    </>
  ) : (
    section.figure
  )

/** A group of sections: words beside a screen, alternating sides. */
const featureGroup = (
  id: string,
  heading: string,
  sections: readonly HomeSection[],
  flip: (index: number) => boolean,
  lang: Lang,
) => {
  const copy = homeCopy[lang]
  return (
    <section id={id} className="features">
      <h2>{heading}</h2>
      {sections.map((section, index) => (
        <div className={featureClass(flip(index))}>
          {featureText(copy, section)}
          <div className="feature-figure">{figureOf(section, lang)}</div>
        </div>
      ))}
    </section>
  )
}

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
        {featureGroup(
          'touch',
          copy.groups.touch,
          copy.readerSections,
          readerFlip,
          lang,
        )}
        {featureGroup(
          'learn',
          copy.groups.learn,
          copy.learnSections,
          learnFlip,
          lang,
        )}
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
