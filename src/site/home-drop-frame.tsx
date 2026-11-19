import type { Lang } from './i18n'
import { homeText } from './home-text'

/**
 * Where slides are dropped on the top page. For now it is the frame alone:
 * the button is disabled, so it is plain that nothing can be chosen yet.
 * Receiving a file, the picked and resuming states, and the smaller
 * signed-in form belong to the drop feature, which fills this frame.
 */
export const HomeDropFrame = ({ lang }: { lang: Lang }) => {
  const t = homeText[lang]
  return (
    <section className="drop-zone drop-zone-large" data-drop-zone="new">
      <p className="drop-title">{t.dropTitle}</p>
      <button type="button" className="button-secondary" disabled>
        {t.chooseFile}
      </button>
      <p className="drop-note">{t.dropNote}</p>
    </section>
  )
}
