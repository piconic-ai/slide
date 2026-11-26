import { html } from 'hono/html'
import { defineArticle } from '../../article'
import { SERVICE_NAME } from '../../../site/service'
import { LUMA_FEED_FORM } from '../../../communities/link-rules'
import { HELP_BOT_PATH } from '../../paths'

export default defineArticle({
  order: 90,
  form: 'reference',
  related: ['community/create-community', 'community/list-event-talks'],
  ja: {
    title: '紐づけ用リンクを決める',
    lead: () =>
      html`紐づけ用リンクは、イベントを募集しているグループのページの URL です。`,
    body: (n) =>
      html`<p>1 つ以上、${n.communityLinks} 個まで入れられます。</p>
        <ul>
          <li>connpass: <code>https://グループ名.connpass.com/</code></li>
          <li>Doorkeeper: <code>https://グループ名.doorkeeper.jp/</code></li>
          <li>
            Luma: カレンダーの「iCal で購読」の
            URL(<code>${LUMA_FEED_FORM}</code>)。カレンダーのページの URL
            ではありません。
          </li>
          <li>自前のサイト: <code>https://ホスト名/</code>(トップだけ)</li>
        </ul>
        <ul>
          <li>
            イベントのページの URL
            のホスト名が、紐づけ用リンクのホスト名と同じなら、そのイベントの発表がコミュニティに入ります。コミュニティを作る前からあるイベントも入ります。
          </li>
          <li>
            Luma は、${SERVICE_NAME}
            がカレンダーの配信を読み、そこに並ぶイベントの発表を入れます(<a
              href="${HELP_BOT_PATH}"
              >配信を読むボット</a
            >)。
          </li>
          <li>
            connpass のイベントは、そのイベントのリンクがどれもグループ名の無い
            <code>https://connpass.com/event/番号/</code>
            のときは、どのコミュニティにも入りません。1
            本でもグループ名の付いたリンクがあれば、そのグループのコミュニティに入ります。
          </li>
          <li>
            <code>connpass.com</code>、<code>doorkeeper.jp</code>、<code
              >x.com</code
            >
            など、だれでも使うサイトのリンクは入れられません。グループのページか、自前のサイトのトップを入れます。
          </li>
          <li>
            1 つのリンクは、1
            つのコミュニティにだけ入れられます。ほかのコミュニティが使っているリンクは、入れられません。
          </li>
          <li>
            紐づけ用リンクを外すと、そのリンクで入っていたイベントが、コミュニティから外れます。スライドとイベントのページは残ります。
          </li>
          <li>グループの主催者かどうかは、${SERVICE_NAME} は確かめません。</li>
        </ul>`,
  },
  en: {
    title: 'Choose the links that gather talks',
    lead: () =>
      html`The links that gather talks are the URLs of the pages of the groups
      that hold your events.`,
    body: (n) =>
      html`<p>A community has at least one, up to ${n.communityLinks}.</p>
        <ul>
          <li>connpass: <code>https://group-name.connpass.com/</code></li>
          <li>Doorkeeper: <code>https://group-name.doorkeeper.jp/</code></li>
          <li>
            Luma: the calendar’s “Subscribe with iCal” address
            (<code>${LUMA_FEED_FORM}</code>), not the calendar’s page.
          </li>
          <li>Your own site: <code>https://host-name/</code> (the top only)</li>
        </ul>
        <ul>
          <li>
            When the host name of an event’s URL is the host name of a link, the
            talks at that event join the community, including events from before
            the community was made.
          </li>
          <li>
            For Luma, ${SERVICE_NAME} reads the calendar’s feed and adds the
            talks at the events in it (<a href="${HELP_BOT_PATH}"
              >the feed-reading bot</a
            >).
          </li>
          <li>
            A connpass event joins no community when every link to it is
            <code>https://connpass.com/event/number/</code>, with no group name.
            If even one link to it has a group name, it joins that group’s
            community.
          </li>
          <li>
            A site everyone uses, such as <code>connpass.com</code>,
            <code>doorkeeper.jp</code> or <code>x.com</code>, cannot be a link.
            Enter your group’s page or the top of your own site.
          </li>
          <li>
            A link belongs to one community only. A link another community uses
            cannot be added.
          </li>
          <li>
            Removing a link takes out the events it brought in. The slides and
            the event pages stay.
          </li>
          <li>${SERVICE_NAME} does not check that you organize the group.</li>
        </ul>`,
  },
})
