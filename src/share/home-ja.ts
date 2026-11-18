import { html } from 'hono/html'
import type { HomeCopy, HomeSection } from './home'
import { slideUrl, toolsFigure } from './home-mock'

const courseFigure = html`${slideUrl('@kobaken/courses/workers-from-zero')}
  <div class="mock-card">
    <div class="mock-card-head">
      <b>Cloudflare Workers をゼロから動かす</b>
      <span>全 4 回 · 92 ページ · kobaken</span>
    </div>
    <ol class="mock-course">
      <li>
        <span class="mock-thumb"></span>
        <span
          >1. Workers の実行モデル<small
            >isolate、コールドスタート、CPU 時間の制限 · 22 ページ</small
          ></span
        >
        <span>読んだ</span>
      </li>
      <li>
        <span class="mock-thumb"></span>
        <span
          >2. Hono でルーティングとミドルウェア<small
            >ルーターの評価順、c.env、Bindings の型 · 26 ページ</small
          ></span
        >
        <span>読んだ</span>
      </li>
      <li class="is-current">
        <span class="mock-thumb"></span>
        <span
          >3. D1 と R2 をつなぐ<small
            >Drizzle のマイグレーション、R2 の署名なし配信 · 24 ページ</small
          ></span
        >
        <span>ここから</span>
      </li>
      <li class="is-locked">
        <span class="mock-thumb"></span>
        <span
          >4. GitHub Actions から OIDC で公開する<small
            >id-token、audience、短命の認証情報 · 20 ページ</small
          ></span
        >
        <span>まだ</span>
      </li>
    </ol>
  </div>`

const aiFigure = html`<dl class="mock-kv">
  <div>
    <dt>OGP 画像</dt>
    <dd>ページごとに自動生成</dd>
  </div>
  <div>
    <dt>文字起こし</dt>
    <dd>ノートを記事の文章に</dd>
  </div>
  <div>
    <dt>翻訳</dt>
    <dd>en / zh / ko</dd>
  </div>
  <div>
    <dt>アクセス解析</dt>
    <dd>ページ到達率と離脱点</dd>
  </div>
</dl>`

const thanksFigure = html`<dl class="mock-kv">
  <div>
    <dt>コース</dt>
    <dd>値段をつけて売る</dd>
  </div>
  <div>
    <dt>スライド</dt>
    <dd>投げ銭でお礼を受け取る</dd>
  </div>
</dl>`

const readerSections: readonly HomeSection[] = [
  {
    id: 'touch-demo',
    title: 'デモを動かせる。',
    status: 'done',
    body: [
      'HTML スライドは画像や PDF ではなく、ブラウザで動くプログラムのまま届きます。発表者がデモに使った入力欄やスライダーは、読む人の手元でもそのまま動きます。発表で見せた 1 ケースだけでなく、自分が気になるケースを入れて挙動を確かめられます。',
      '右の例は、リトライの待ち時間を説明するスライドです。倍率と回数を変えると、何回目に何秒待ち、合計でどれだけかかるかがその場で変わります。',
    ],
    figure: { live: 'backoff', path: '@kobaken/hono-on-workers' },
  },
  {
    id: 'touch-safe',
    title: '知らない人のスライドも、安心して開ける。',
    status: 'wip',
    body: [
      '知らない人が作った動くスライドには、本来リスクがあります。勝手に別のページへ飛ばされたり、ファイルをダウンロードさせられたり、ログイン中のサービスを操作されたりするおそれです。',
      'slide は sandbox 付きの iframe を管理画面とは別の origin から配信します。親ページを偽のログイン画面へ移動させる、別タブを開く、ファイルを落とす、フォームを送る、といった操作はブラウザが止め、slide のログイン情報にも届きません。スライドは外部と通信できます。API を使うデモや Web フォントを動かすためです。読者をだます内容を見つけたら通報でき、運営がスライドの非表示やアカウントの停止で対応します。',
    ],
    figure: { live: 'sandbox', path: '@someone/slide' },
  },
  {
    id: 'touch-review',
    title: '良いものに、たどり着きやすく。',
    status: 'spec',
    body: [
      'AI が量産した中身のないスライドや記事に、うんざりしたことはないでしょうか。slide では、公開されたスライドとノートを AI が読み、試せるデモがあるか、文脈が足りているか、具体的か、独自の知見があるかをレビューします。著者が公開を選んだレビューだけが表示され、読む前に中身の手応えがわかります。',
      'AI で作ること自体は止めません。AI を使って質の高いコンテンツを作ったなら、レビューはそれを裏付けます。読む人の時間を、良いものに向けるための仕組みです。',
    ],
    figure: { live: 'review', path: '@kobaken/hono-on-workers · AI レビュー' },
  },
]

const learnSections: readonly HomeSection[] = [
  {
    id: 'learn-notes',
    title: '話した言葉と、いっしょに読める。',
    status: 'spec',
    body: [
      '発表者が口で話した内容は、スライドだけでは残りません。かといって、ノートをそのまま載せても読みにくいままです。そこで slide は、スライドとノートをもとに AI が文章の下書きを用意し、書き手が整えたうえで、1 本の記事として読める形にします。会場にいなかった人も、なぜそう設計したのかまで追えます。',
      'ノートで読むか、スライドでめくるかは読む人が切り替えられます。どちらの表示でも URL は同じで、ページ番号で特定の 1 枚に飛べます。',
    ],
    figure: { live: 'notes', path: '@kobaken/hono-on-workers' },
  },
  {
    id: 'learn-course',
    title: 'コースで学べる。',
    status: 'spec',
    body: [
      'クリエイターは複数のスライドを順番に並べて、1 つのコースとして公開できます。各回にノートと動くデモがついているので、読んで、手を動かして、次に進む、という学び方ができます。',
      'どこまで読んだかは手元に残り、途中の回からでも再開できます。動画講座と違って、気になる 1 枚を検索して開き、そこだけ試すこともできます。',
    ],
    figure: courseFigure,
  },
]

const eventFigure = html`${slideUrl('@kobaken/hono-on-workers')}
  <div class="mock-card">
    <div class="mock-card-head">
      <b>Workers Meetup Kyoto #12</b>
      <span>2026-10-24 · #workerskyoto</span>
    </div>
    <ol class="mock-course">
      <li>
        <span class="mock-thumb"></span>
        <span>D1 のマイグレーションで困ったこと<small>@aoi</small></span>
        <span>Speaker Deck</span>
      </li>
      <li>
        <span class="mock-thumb"></span>
        <span>Durable Objects で順番を守る<small>@ren</small></span>
        <span>Docswell</span>
      </li>
      <li>
        <span class="mock-thumb"></span>
        <span>Queues で重い処理を後ろに回す<small>@mio</small></span>
        <span>slide</span>
      </li>
    </ol>
  </div>`

const citeFigure = html`${slideUrl('@kobaken/hono-on-workers')}
  <div class="mock-card">
    <div class="mock-card-head">
      <b>このスライドを引用しているスライド</b>
      <span>2 件</span>
    </div>
    <ol class="mock-course">
      <li>
        <span class="mock-thumb"></span>
        <span>Workers の CPU 時間を測る<small>@aoi</small></span>
      </li>
      <li>
        <span class="mock-thumb"></span>
        <span>リトライ設計の落とし穴<small>@ren</small></span>
      </li>
    </ol>
  </div>`

const postsFigure = html`${slideUrl('@kobaken/hono-on-workers')}
  <div class="mock-card">
    <div class="mock-card-head">
      <b>タイムライン</b>
      <span>X · Bluesky</span>
    </div>
    <ol class="mock-posts">
      <li>
        <small>@aoi · Bluesky</small>
        倍率を 3 にすると、5 回目でもう 2 分待つのか。手で動かすと腹落ちする。
      </li>
      <li>
        <small>@ren · X</small>
        6 ページ目のジッターの説明が、今日いちばんの収穫でした。
      </li>
    </ol>
  </div>`

const gatherSections: readonly HomeSection[] = [
  {
    id: 'gather-event',
    title: '同じ場の発表が、ひとところに。',
    status: 'wip',
    body: [
      '勉強会やカンファレンスの発表は、発表者ごとに別々のサービスへ散らばりがちです。slide は、スライドが発表されたコミュニティとイベントを作者名の下に示し、同じイベントのほかの発表をスライドの下に発表順で並べます。1 本を読み終えたら、その日の次の発表へ進めます。',
      'ほかのサービスで公開された発表も並びます。Speaker Deck と Docswell のスライドは、その場で開けます。イベントを登録する画面は、これから作ります。',
    ],
    figure: eventFigure,
  },
  {
    id: 'gather-cite',
    title: '引用で、スライドがつながる。',
    status: 'done',
    body: [
      '良い発表は、誰かの発表を踏まえています。スライドの中に別のスライドの共有 URL へのリンクを書くと、slide はそれを引用として読み取ります。',
      '引用されたスライドの下には引用しているスライドが、引用したスライドの下には引用元が並びます。読む人は、元の議論へさかのぼることも、その先の議論へ進むこともできます。',
    ],
    figure: citeFigure,
  },
  {
    id: 'gather-posts',
    title: '反応が、スライドの横に。',
    status: 'wip',
    body: [
      '発表への感想は SNS に流れて、数日で探せなくなります。slide は X と Bluesky の投稿を、スライドの横のタイムラインに並べます。読む人は、ほかの人がどう受け止めたかといっしょに読めます。',
      '投稿は作者が URL を入れて載せ、合わないものは外せます。Bluesky では、共有 URL を含む投稿を検索してまとめて追加できます。X の投稿を自動で集める方法は、検討中です。',
    ],
    figure: postsFigure,
  },
]

const creatorSections: readonly HomeSection[] = [
  {
    id: 'creator-ai',
    title: '公開の面倒は、AI に。',
    status: 'spec',
    body: [
      '公開したあとに増える作業を、AI が肩代わりします。ページごとの OGP 画像、スピーカーノートから記事の文章への整形、翻訳、どのページまで読まれたかの解析まで。発表者はスライドとノートを書くことに集中できます。',
    ],
    figure: aiFigure,
  },
  {
    id: 'creator-tools',
    title: 'いつものツールで。',
    status: 'done',
    body: [
      'Slidev、Marp、reveal.js、Peitho。HTML を出力するツールならどれでも、ビルド成果物をそのまま受け取ります。GitHub Actions から OIDC で認証するので、秘密鍵の発行も保管もいりません。push すると作者だけが見られる URL ができ、確認してから公開します。',
    ],
    figure: toolsFigure,
  },
  {
    id: 'creator-thanks',
    title: '学びに、お礼を。',
    status: 'spec',
    body: [
      '知を共有しあう循環を続けるには、お金を切り離せません。本を 1 冊書くほどの手間をかけたコースには、値段をつけて売れます。1 回目は無料で読めるので、買う人は中身を確かめてから決められます。良かったスライドには、投げ銭でお礼を送れます。登壇のあとの「良かった」を、言葉だけでなく形にして渡せます。',
      '受け取ったら、今度は自分が学んだ誰かに送る。受け取って終わりではなく、恩を次に送る循環を slide は大事にします。',
    ],
    figure: thanksFigure,
  },
]

const heroFigure = html`${slideUrl('@kobaken/b-tree-index')}
  <div class="mock-slide mock-cover">
    <div>なぜ検索は、1億件でも一瞬で返るのか</div>
    <span class="mock-no">1</span>
  </div>`

export const ja: HomeCopy = {
  title: 'さわって、わかって、あつまる',
  statusLabels: { done: '実装完了', wip: '実装中', spec: '仕様検討中' },
  hero: {
    heading: 'さわって、わかって、あつまる。',
    lead: 'スライドを読むだけで終わらせません。読む人が自分の手でデモを動かして確かめられるので、会場にいなかった人も「見た」ではなく「わかった」まで届きます。同じ場の発表、引用、SNS の反応がスライドのまわりに集まり、1 本から次の 1 本へ進めます。書き手は、いつものツールで作った HTML を push するだけです。',
    start: 'GitHub ではじめる',
    tryIt: 'さわってみる',
    figure: heroFigure,
  },
  recentHeading: '最近公開されたスライド',
  groups: {
    touch: 'さわる',
    learn: 'わかる',
    gather: 'あつまる',
    creators: 'クリエイターへ',
  },
  readerSections,
  learnSections,
  gatherSections,
  creatorSections,
  outro: {
    body: 'GitHub アカウントでログインして、最初のスライドを push してください。公開前は作者だけが見られる URL で確認できます。',
  },
}
