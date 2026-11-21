import type { Lang } from './i18n'
import { DROP_ACCEPT } from '../drops/accept'
import { homeText } from './home-text'

/**
 * Where slides are dropped on the top page, to put up a new slide. The
 * button starts disabled and /drop.js enables it, so where no script runs
 * nothing looks usable. The script takes a dropped or chosen file, says why
 * one is not taken, shows the progress, and opens the slide's page.
 *
 * This frame alone keeps a file for a visitor who is not signed in
 * (`data-drop-stash`): the page is a static file that does not know its
 * visitor, so the script asks who is signed in, keeps the file in the
 * browser, offers the way to sign in, and receives the file once the
 * visitor comes back signed in. For a signed-in visitor it also makes the
 * frame smaller.
 */
export const HomeDropFrame = ({ lang }: { lang: Lang }) => {
  const t = homeText[lang]
  return (
    <section
      className="drop-zone drop-zone-large"
      data-drop-zone="new"
      data-drop-stash
    >
      <h1 className="drop-title" data-drop-title>
        {t.dropTitle}
      </h1>
      <button
        type="button"
        className="button-secondary"
        data-drop-choose
        disabled
      >
        {t.chooseFile}
      </button>
      <input
        type="file"
        data-drop-input
        accept={DROP_ACCEPT}
        aria-label={t.chooseFile}
        hidden
      />
      <p className="drop-note" data-drop-note>
        {t.dropNote}
      </p>
      <script type="module" src="/drop.js"></script>
    </section>
  )
}
