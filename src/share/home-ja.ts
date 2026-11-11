import { html } from 'hono/html'
import type { HomeCopy, HomeSection } from './home'
import { slideUrl, toolsFigure } from './home-mock'

const sandboxFigure = html`${slideUrl('@someone/deck')}
  <div class="mock-slide">
    <div class="mock-title">このスライドは、枠の外に出ようとする</div>
    <div class="mock-code">top.location = "https://evil.example"</div>
    <div class="mock-button">親ページを偽サイトへ移動させる命令を実行する</div>
    <div class="mock-log">
      ✕ top navigation … sandbox が遮断（allow-top-navigation なし）
    </div>
    <span class="mock-no">9</span>
  </div>
  <div class="mock-url">
    &lt;iframe sandbox="allow-scripts allow-same-origin"
    referrerpolicy="no-referrer"&gt; · 配信 origin は管理画面と別
  </div>`

const reviewFigure = html`${slideUrl('@kobaken/hono-on-workers · AI レビュー')}
  <div class="mock-card">
    <div class="mock-card-head">
      <span
        >AI レビュー · 著者が公開 · スライド本文とノートだけを読んで評価</span
      >
      <span class="mono">22/25</span>
    </div>
    <div class="mock-review">
      <ul class="mock-axes">
        <li class="is-selected"><span>試せる</span><span>●●●●○</span></li>
        <li><span>文脈が足りる</span><span>●●●●●</span></li>
        <li><span>具体的</span><span>●●●●○</span></li>
        <li><span>独自の知見</span><span>●●●●○</span></li>
        <li><span>読みやすい</span><span>●●●●●</span></li>
      </ul>
      <div class="mock-finding">
        <b>試せる 4/5</b>
        <p>
          15 ページのバックオフと 18 ページのキャッシュ TTL
          は、読む人が値を変えて挙動を確かめられる。3
          ページのアーキテクチャ図は静止画のままで、ここは試せない。
        </p>
        <small class="mono">p.15, p.18 / p.3</small>
      </div>
    </div>
    <div class="mock-card-foot">
      総評:
      手を動かしながら読める、実装者向けの記事。数字と判断理由が揃っている。
    </div>
  </div>`

const notesFigure = html`${slideUrl('@kobaken/hono-on-workers')}
  <div class="mock-card">
    <div class="mock-card-head">
      <span>Hono on Workers · 24 ページ · ノートあり</span>
      <span class="mock-toggle"
        ><b>ノートで読む</b><span>スライドでめくる</span></span
      >
    </div>
    <div class="mock-notes">
      <div class="mock-note-row">
        <div class="mock-thumb">なぜ Workers なのか</div>
        <p>
          <small class="mono">14</small>isolate
          ベースなのでコールドスタートがほぼなく、D1 と R2
          が同じ境界の中にいます。スライド配信は「小さなファイルを大量に読む」ワークロードなので、CPU
          時間 10ms の制限があっても困りません。
        </p>
      </div>
      <div class="mock-note-row">
        <div class="mock-thumb">指数バックオフ</div>
        <p>
          <small class="mono">15</small
          >このページのデモは手元で動かしてください。倍率 2 で 5 回なら、合計で
          7.5 秒待つことになります。配信側は 3 回で諦めて 503
          を返し、クライアント側で再読み込みしてもらう設計にしました。
        </p>
      </div>
    </div>
  </div>`

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
    <dt>デッキ</dt>
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
    // The address bar sits above the live slide the page renders.
    figure: { live: 'backoff', path: '@kobaken/hono-on-workers' },
  },
  {
    id: 'touch-safe',
    title: '知らない人のスライドも、安心して開ける。',
    status: 'wip',
    body: [
      '知らない人が作った動くスライドには、本来リスクがあります。勝手に別のページへ飛ばされたり、ファイルをダウンロードさせられたり、ログイン中のサービスを操作されたりするおそれです。',
      'slide は sandbox 付きの iframe を管理画面とは別の origin から配信します。親ページを偽のログイン画面へ移動させる、別タブを開く、ファイルを落とす、フォームを送る、といった操作はブラウザが止め、slide のログイン情報にも届きません。スライドから外部への通信を制限する仕組みは、これから加えます。',
    ],
    figure: sandboxFigure,
  },
  {
    id: 'touch-review',
    title: '良いものに、たどり着きやすく。',
    status: 'spec',
    body: [
      'AI が量産した中身のないスライドや記事に、うんざりしたことはないでしょうか。slide では、公開されたスライドとノートを AI が読み、試せるデモがあるか、文脈が足りているか、具体的か、独自の知見があるかをレビューします。著者が公開を選んだレビューだけが表示され、読む前に中身の手応えがわかります。',
      'AI で作ること自体は止めません。AI を使って質の高いコンテンツを作ったなら、レビューはそれを裏付けます。読む人の時間を、良いものに向けるための仕組みです。',
    ],
    figure: reviewFigure,
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
    figure: notesFigure,
  },
  {
    id: 'learn-course',
    title: 'コースで学べる。',
    status: 'spec',
    body: [
      'クリエイターは複数のデッキを順番に並べて、1 つのコースとして公開できます。各回にノートと動くデモがついているので、読んで、手を動かして、次に進む、という学び方ができます。',
      'どこまで読んだかは手元に残り、途中の回からでも再開できます。動画講座と違って、気になる 1 枚を検索して開き、そこだけ試すこともできます。',
    ],
    figure: courseFigure,
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
      '知を共有しあう循環を続けるには、お金を切り離せません。本を 1 冊書くほどの手間をかけたコースには、値段をつけて売れます。1 回目は無料で読めるので、買う人は中身を確かめてから決められます。良かったデッキには、投げ銭でお礼を送れます。登壇のあとの「良かった」を、言葉だけでなく形にして渡せます。',
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
  title: 'さわって、わかる',
  statusLabels: { done: '実装完了', wip: '実装中', spec: '仕様検討中' },
  hero: {
    heading: 'さわって、わかる。',
    lead: 'スライドを読むだけで終わらせません。読む人が自分の手でデモを動かして確かめられるので、会場にいなかった人も「見た」ではなく「わかった」まで届きます。書き手は、いつものツールで作った HTML を push するだけです。',
    start: 'GitHub ではじめる',
    tryIt: 'さわってみる',
    figure: heroFigure,
  },
  recentHeading: '最近公開されたスライド',
  groups: { touch: 'さわる', learn: 'わかる', creators: 'クリエイターへ' },
  readerSections,
  learnSections,
  creatorSections,
  outro: {
    body: 'GitHub アカウントでログインして、最初のデッキを push してください。公開前は作者だけが見られる URL で確認できます。',
  },
}
