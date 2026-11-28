import { html } from 'hono/html'
import { defineArticle } from '../../article'
import { SERVICE_NAME } from '../../../site/service'

export default defineArticle({
  order: 50,
  form: 'howto',
  related: ['community/remove-event-talk', 'community/create-community'],
  ja: {
    title: 'スライドをイベントの発表として並べる',
    lead: () =>
      html`スライドの関連リンクに、勉強会やカンファレンスのイベントのページの
      URL
      を入れると、そのスライドがイベントの発表として、イベントのページに並びます。`,
    body: () =>
      html`<p>主催者がイベントを登録する必要はありません。</p>
        <h2>並べかた</h2>

        <ol>
          <li>
            スライドの編集の画面の「関連リンク」の枠に、イベントのページの URL
            を入れて「追加する」を押します。次の形の URL
            は、種類が「イベント」になります。
            <ul>
              <li>
                connpass:
                <code>https://グループ名.connpass.com/event/番号/</code>、<code
                  >https://connpass.com/event/番号/</code
                >
              </li>
              <li>
                Doorkeeper:
                <code>https://グループ名.doorkeeper.jp/events/番号</code>
              </li>
              <li>
                Luma:
                <code>https://luma.com/文字列</code
                >、<code>https://lu.ma/文字列</code>、<code>https://luma.com/event/evt-…</code>(コミュニティのカレンダーにあるイベントなら、どちらの形でも同じイベントに並びます)
              </li>
            </ul>
            上の形ではない、ほかのサービス(Peatix、TECH PLAY
            など)のイベントは、いまのところ並びません。
          </li>
          <li>
            リンクの行の下に、どこに並ぶか(「(コミュニティ名)
            のページに並びます。」「リンクのページに並びます。」)が出ます。どこにも並ばない行には、出ません。
          </li>
          <li>
            スライドが一般公開されると、そのイベントのページに並びます。同じイベントの
            URL
            を入れたほかの作者のスライドも、同じページに並びます。スライドが入っているイベントは、スライドの編集の画面の「発表したイベント」の枠で確かめられます。
          </li>
        </ol>
        <h2>決まり</h2>

        <ul>
          <li>
            クエリ(<code>?</code> の後ろ)、末尾の
            <code>/</code
            >、ホスト名の大文字小文字が違っても、同じイベントです。<code
              >lu.ma</code
            >
            と <code>luma.com</code> も同じです。connpass
            は、グループ名が違っても無くても、番号が同じなら同じイベントです。
          </li>
          <li>1 本のスライドは、いくつのイベントにも入れます。</li>
          <li>
            イベントのページに並ぶのは、一般公開中のスライドだけで、一般公開の新しい順です。
          </li>
          <li>
            照らすのは関連リンクだけです。スライドの本文や記事の中のリンクでは、イベントに入りません。
          </li>
          <li>
            ${SERVICE_NAME}
            は、イベントのページを取りに行きません。イベントの日時と場所は出しません。
          </li>
        </ul>`,
  },
  en: {
    title: 'List your slides as talks at an event',
    lead: () =>
      html`Put the URL of the page of a meetup or a conference event into the
      related links of your slides, and the slides are listed as a talk on the
      event’s page.`,
    body: (n) =>
      html`<p>The organizers do not need to register the event.</p>
        <h2>How to list slides</h2>

        <ol>
          <li>
            In the “Related links” area on the edit page of the slides, enter
            the URL of the event’s page and press “Add”. URLs of these forms get
            the kind Event:
            <ul>
              <li>
                connpass:
                <code>https://group-name.connpass.com/event/number/</code>,
                <code>https://connpass.com/event/number/</code>
              </li>
              <li>
                Doorkeeper:
                <code>https://group-name.doorkeeper.jp/events/number</code>
              </li>
              <li>
                Luma: <code>https://luma.com/name</code>,
                <code>https://lu.ma/name</code>,
                <code>https://luma.com/event/evt-…</code> (for an event on a
                community’s calendar, either form lists it as the same event)
              </li>
            </ul>
            An event on another service (Peatix, TECH PLAY and so on) is not
            listed for now.
          </li>
          <li>
            Under the row of the link, one sentence says where it is listed
            (“Listed on the page of (community).” or “Listed on the page of this
            link.”). A row listed nowhere has none.
          </li>
          <li>
            When the slides are public, they are listed on the event’s page,
            together with other authors’ slides that link to the same event. The
            “Events presented at” area on the edit page shows the events the
            slides are in.
          </li>
        </ol>
        <h2>The rules</h2>

        <ul>
          <li>
            The same event, even with a different query (after <code>?</code>),
            a trailing <code>/</code> or capital letters in the host name.
            <code>lu.ma</code> and <code>luma.com</code> are the same too. On
            connpass, the same number is the same event, whatever the group
            name, or none.
          </li>
          <li>One slide can be in any number of events.</li>
          <li>
            An event’s page lists only public slides, the most recently made
            public first.
          </li>
          <li>
            Only related links count. A link in the slides themselves or in the
            article does not put them in an event.
          </li>
          <li>
            ${SERVICE_NAME} does not fetch the event’s page, and shows no date
            or place for it.
          </li>
        </ul>`,
  },
})
