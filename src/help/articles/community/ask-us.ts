import { html } from 'hono/html'
import { defineArticle } from '../../article'

export default defineArticle({
  order: 130,
  form: 'reference',
  related: ['community/create-community', 'community/delete-community'],
  ja: {
    title: 'ハンドルの変更などを運営に頼む',
    lead: () =>
      html`ハンドルの変更、管理者の移し替え、イベント名の修正は、<a
          href="/contact"
          >お問い合わせ</a
        >から運営に頼めます。`,
    body: (n) =>
      html`<ul>
        <li>
          ハンドルの変更。前のハンドルは ${n.handleHoldDays}
          日の間だれも使えず、その間、前の URL は新しい URL へ移ります。
        </li>
        <li>
          管理者の移し替え(グループの主催者でない人が作っていたときなど)。
        </li>
        <li>イベント名の修正(コミュニティの無いイベントなど)。</li>
      </ul>`,
  },
  en: {
    title: 'Ask us to change a handle and more',
    lead: () =>
      html`You can ask the service through <a href="/contact">Contact</a> to
        change a handle, move admins and fix an event name.`,
    body: (n) =>
      html`<ul>
        <li>
          A new handle. No one can take the old one for ${n.handleHoldDays}
          days, and meanwhile its URL moves to the new one.
        </li>
        <li>
          Moving the admins (when someone who does not run the group made it,
          for example).
        </li>
        <li>Fixing an event’s name (of an event with no community, say).</li>
      </ul>`,
  },
})
