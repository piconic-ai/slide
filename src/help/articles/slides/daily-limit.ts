import { html } from 'hono/html'
import { defineArticle } from '../../article'

export default defineArticle({
  order: 35,
  form: 'howto',
  related: ['slides/limits', 'slides/replace', 'slides/upload'],
  ja: {
    title: '「今日はこれ以上置けません」と出たとき',
    lead: (n) =>
      html`登録から ${n.newAuthorDays} 日のあいだは、新しいスライドを置けるのは
      ${n.newAuthorWindowHours} 時間に ${n.newAuthorPerDay}
      本までなので、画面に出た日時まで待ってから、もう一度置いてください。`,
    body: (n) =>
      html`<ol>
          <li>
            「今日はこれ以上置けません」と出た文章の終わりにある日時(日本時間)を見ます。その日時から、また新しいスライドを置けます。
          </li>
          <li>
            その日時になったら、もう一度スライドをドロップします。AI
            エージェントから置いているときは、答えに同じ時刻が入っています。
          </li>
          <li>
            待てないときは、すでに置いたスライドに新しい版を置きます。差し替えは、数えません(<a
              href="/help/slides/replace"
              >差し替え方</a
            >)。
          </li>
        </ol>
        <h2>数え方</h2>
        <ul>
          <li>
            数えるのは、直近 ${n.newAuthorWindowHours}
            時間に、新しく置き始めたスライドです。${n.newAuthorWindowHours}
            時間より前のものは、数えません。
          </li>
          <li>新しい版への差し替えと、同じ送信のやり直しは、数えません。</li>
          <li>
            消したスライドも、数えます。消して置き直しても、置ける本数は増えません。
          </li>
          <li>
            ブラウザから置いても、ドロップで置いても、AI
            エージェントから置いても、同じ本数、同じ時刻です。
          </li>
          <li>
            登録から ${n.newAuthorDays} 日を過ぎると、この上限はかかりません。
          </li>
        </ul>
        <h2>うまくいかないとき</h2>
        <ul>
          <li>
            日時を過ぎても置けないときは、ページを読み込み直して、もう一度ドロップします。
          </li>
          <li>
            「置けるスライドの本数の上限に達しています」と出たときは、別の上限です(<a
              href="/help/slides/limits"
              >置ける大きさと本数の上限を知る</a
            >)。
          </li>
          <li>
            それでも置けないときは、<a href="/contact">お問い合わせ</a
            >ください。
          </li>
        </ul>`,
  },
  en: {
    title: "When it says “You can't put up any more today”",
    lead: (n) =>
      html`For the first ${n.newAuthorDays} days after you register, you can put
      up ${n.newAuthorPerDay} new slides in ${n.newAuthorWindowHours} hours, so
      wait until the time the screen shows, then put them up again.`,
    body: (n) =>
      html`<ol>
          <li>
            Read the time (Japan time) at the end of the message that says “You
            can't put up any more today”. From that time you can put up a new
            slide again.
          </li>
          <li>
            When that time comes, drop the slides once more. If an AI agent puts
            them up, its answer holds the same time.
          </li>
          <li>
            If you cannot wait, put a new version on a slide you already have.
            Replacing does not count (<a href="/help/slides/replace"
              >How to replace slides</a
            >).
          </li>
        </ol>
        <h2>How it is counted</h2>
        <ul>
          <li>
            What counts is the new slides you started in the last
            ${n.newAuthorWindowHours} hours. Slides from before that do not
            count.
          </li>
          <li>
            A new version of a slide, and sending the same thing again, do not
            count.
          </li>
          <li>
            A slide you deleted still counts. Deleting and putting up again does
            not make room.
          </li>
          <li>
            The number and the time are the same whether you put slides up from
            the browser, by dropping, or with an AI agent.
          </li>
          <li>
            After ${n.newAuthorDays} days from registering, this limit no longer
            applies.
          </li>
        </ul>
        <h2>If it does not work</h2>
        <ul>
          <li>
            If you still cannot put up slides after that time, reload the page
            and drop them once more.
          </li>
          <li>
            If it says “You have as many slides as one account may hold”, that
            is another limit (<a href="/help/slides/limits"
              >Know the limits on size and number</a
            >).
          </li>
          <li>If you still cannot, <a href="/contact">contact us</a>.</li>
        </ul>`,
  },
})
