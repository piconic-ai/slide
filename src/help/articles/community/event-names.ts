import { html } from 'hono/html'
import { defineArticle } from '../../article'

export default defineArticle({
  order: 60,
  form: 'reference',
  related: ['community/list-event-talks'],
  ja: {
    title: 'イベント名を直す',
    lead: () =>
      html`イベント名は、そのイベントの関連リンクの題名のうち、最初に保存されたものです。`,
    body: () =>
      html`<p>
        後から別の題名で足しても変わりません。題名のあるリンクが無いときは、「connpass
        のイベント
        410635」のように、サービス名と番号で出ます。イベント名は、そのイベントが入っているコミュニティの管理者が、コミュニティの編集のページで直せます。コミュニティの無いイベントの名前は、お問い合わせを受けて運営が直します。
      </p>`,
  },
  en: {
    title: 'Fix the name of an event',
    lead: () =>
      html`An event’s name is the title of the first saved related link to it.`,
    body: () =>
      html`<p>
        Adding another title later does not change it. With no titled link, the
        service name and the number are shown, such as “connpass event 410635”.
        The admins of a community the event is in can fix the name on the
        community’s edit page. For an event with no community, the service fixes
        the name on request.
      </p>`,
  },
})
