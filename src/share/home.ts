import { html } from 'hono/html'
import type { HtmlEscapedString } from 'hono/utils/html'

type Html = HtmlEscapedString | Promise<HtmlEscapedString>

/**
 * Where a promised capability stands. The top page shows the product as it
 * is meant to be, so each section carries its state instead of hiding
 * unbuilt parts.
 */
export type SectionStatus = 'done' | 'wip' | 'spec'

export const STATUS_LABELS: Readonly<Record<SectionStatus, string>> = {
  done: '実装完了',
  wip: '実装中',
  spec: '仕様検討中',
}

export type HomeSection = Readonly<{
  id: string
  title: string
  status: SectionStatus
  /** Explanatory paragraphs; plain text, escaped on output. */
  body: readonly string[]
  /** A mock of the screen the section describes. */
  figure: Html
}>

export const statusBadge = (status: SectionStatus) =>
  html`<span class="status status-${status}">${STATUS_LABELS[status]}</span>`

const slideUrl = (path: string) =>
  html`<div class="mock-url">slide.example/${path}</div>`

const backoffFigure = html`${slideUrl('@kobaken/hono-on-workers')}
  <div class="mock-slide">
    <div class="mock-title">指数バックオフ: 何回目に、何秒待つか</div>
    <div class="mock-controls">
      <span>倍率</span><span class="mock-range"></span><span>×2</span>
      <span>回数</span><span class="mock-range short"></span><span>5 回</span>
    </div>
    <ol class="mock-timeline">
      <li><b>1回目</b><i></i><small>0s</small></li>
      <li><b>2回目</b><i></i><small>+0.5s</small></li>
      <li><b>3回目</b><i></i><small>+1s</small></li>
      <li><b>4回目</b><i></i><small>+2s</small></li>
      <li><b>5回目</b><i></i><small>+4s</small></li>
    </ol>
    <div class="mock-note">
      初回 500ms。上段は試行、下段はその前に待つ時間。合計 7.5s。
    </div>
    <span class="mock-no">15</span>
  </div>`

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

const toolsFigure = html`<pre class="mock-yaml">
permissions:
  id-token: write
steps:
  - run: npm run build
  - uses: piconic-ai/slide@&lt;commit-sha&gt;
    with:
      directory: dist
      deck: hono-on-workers</pre>`

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

/** What readers get: touch, understand. */
export const readerSections: readonly HomeSection[] = [
  {
    id: 'touch-demo',
    title: 'デモを動かせる。',
    status: 'done',
    body: [
      'HTML スライドは画像や PDF ではなく、ブラウザで動くプログラムのまま届きます。発表者がデモに使った入力欄やスライダーは、読む人の手元でもそのまま動きます。発表で見せた 1 ケースだけでなく、自分が気になるケースを入れて挙動を確かめられます。',
      '右の例は、リトライの待ち時間を説明するスライドです。倍率と回数を変えると、何回目に何秒待ち、合計でどれだけかかるかがその場で変わります。',
    ],
    figure: backoffFigure,
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

export const learnSections: readonly HomeSection[] = [
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

/** What authors get. */
export const creatorSections: readonly HomeSection[] = [
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

const sectionHeading = (section: HomeSection) =>
  html`<h3 id="${section.id}">
    ${section.title} ${statusBadge(section.status)}
  </h3>`

/** A reader section: words on one side, the mocked screen on the other. */
const featureRow = (section: HomeSection, flip: boolean) =>
  html`<div class="feature${flip ? ' feature-flip' : ''}">
    <div class="feature-text">
      ${sectionHeading(section)}
      ${section.body.map((paragraph) => html`<p>${paragraph}</p>`)}
    </div>
    <div class="feature-figure">${section.figure}</div>
  </div>`

const featureColumn = (section: HomeSection) =>
  html`<div class="column">
    ${sectionHeading(section)}
    ${section.body.map((paragraph) => html`<p>${paragraph}</p>`)}
    ${section.figure}
  </div>`

const heroFigure = html`${slideUrl('@kobaken/b-tree-index')}
  <div class="mock-slide mock-cover">
    <div>なぜ検索は、1億件でも一瞬で返るのか</div>
    <span class="mock-no">1</span>
  </div>`

/** The top of the page: the one line, both ways in, and one slide. */
export const homeHero = html`<section class="hero hero-split">
  <div class="feature-text">
    <h1>さわって、わかる。</h1>
    <p>
      スライドを読むだけで終わらせません。読む人が自分の手でデモを動かして確かめられるので、会場にいなかった人も「見た」ではなく「わかった」まで届きます。書き手は、いつものツールで作った
      HTML を push するだけです。
    </p>
    <p class="actions">
      <a class="cta" href="/decks">GitHub ではじめる</a>
      <a class="cta cta-quiet" href="#touch">さわってみる</a>
    </p>
  </div>
  <div class="feature-figure">${heroFigure}</div>
</section>`

/** What reading and writing here are like, and where each part stands. */
export const homeFeatures = html`<section id="touch" class="features">
    <h2>さわる</h2>
    ${readerSections.map((section, index) => featureRow(section, index % 2 === 1))}
  </section>
  <section id="learn" class="features">
    <h2>わかる</h2>
    ${learnSections.map((section, index) => featureRow(section, index % 2 === 0))}
  </section>
  <section id="creators" class="features">
    <h2>クリエイターへ</h2>
    <div class="columns">${creatorSections.map(featureColumn)}</div>
  </section>`

export const homeOutro = html`<section class="hero">
  <h2>さわって、わかる。</h2>
  <p>
    GitHub アカウントでログインして、最初のデッキを push
    してください。公開前は作者だけが見られる URL で確認できます。
  </p>
  <p><a class="cta" href="/decks">GitHub ではじめる</a></p>
</section>`

/** Styles only the top page needs; the shared page style stays small. */
export const homeStyle = html`<style>
  .hero-split {
    display: flex;
    flex-wrap: wrap;
    gap: 32px;
    align-items: center;
  }
  .hero-split > .feature-text {
    flex: 1 1 320px;
  }
  .hero-split > .feature-figure {
    flex: 1 1 360px;
  }
  .hero .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
  }
  .cta-quiet {
    background: white;
    color: #153b70;
    border: 1px solid #c4cedd;
  }
  .features {
    border-top: 1px solid #d6dde8;
    margin-top: 48px;
    padding-top: 32px;
  }
  .features h2 {
    font-size: 14px;
    letter-spacing: 0.1em;
    color: #4f5f78;
    margin: 0 0 32px;
  }
  .features h3 {
    font-size: 24px;
    line-height: 1.35;
    margin: 0 0 12px;
  }
  .feature-text p,
  .column p {
    line-height: 1.9;
    color: #3b4a62;
    font-size: 15px;
    margin: 0 0 12px;
  }
  .status {
    display: inline-block;
    vertical-align: middle;
    font-size: 12px;
    font-weight: 600;
    line-height: 1;
    padding: 5px 8px;
    border-radius: 999px;
    white-space: nowrap;
  }
  .status-done {
    color: #1f6f43;
    background: #e6f4ea;
  }
  .status-wip {
    color: #153b70;
    background: #e7eef9;
  }
  .status-spec {
    color: #4f5f78;
    background: #eef1f6;
    border: 1px dashed #c4cedd;
  }
  .feature {
    display: flex;
    flex-wrap: wrap;
    gap: 32px;
    align-items: center;
    margin-bottom: 56px;
  }
  .feature-text {
    flex: 1 1 280px;
    min-width: 0;
  }
  .feature-figure {
    flex: 1.4 1 360px;
    min-width: 0;
  }
  /* Side by side only when wide; stacked, the heading always comes first. */
  @media (min-width: 760px) {
    .feature-flip > .feature-text {
      order: 2;
    }
  }
  .columns {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
    gap: 32px;
  }
  .column {
    min-width: 0;
  }
  .column h3 {
    font-size: 20px;
  }
  .mono {
    font-family: ui-monospace, Menlo, Consolas, monospace;
  }
  .mock-url {
    font-family: ui-monospace, Menlo, Consolas, monospace;
    font-size: 12px;
    color: #4f5f78;
    margin: 0 0 6px;
  }
  .mock-slide {
    position: relative;
    max-width: 100%;
    aspect-ratio: 16 / 9;
    box-sizing: border-box;
    padding: 20px 22px;
    border-radius: 8px;
    background: #111111;
    color: white;
    display: flex;
    flex-direction: column;
    gap: 10px;
    overflow: hidden;
    font-size: 12px;
  }
  .mock-cover {
    justify-content: center;
    font-size: clamp(20px, 3.4vw, 30px);
    font-weight: 700;
    line-height: 1.35;
  }
  .mock-title {
    font-size: 15px;
    font-weight: 700;
    line-height: 1.4;
  }
  .mock-no {
    position: absolute;
    right: 14px;
    bottom: 8px;
    font-size: 11px;
    color: #777777;
    font-family: ui-monospace, Menlo, monospace;
  }
  .mock-controls {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
    color: #aaaaaa;
  }
  .mock-range {
    display: inline-block;
    width: clamp(48px, 18vw, 110px);
    height: 4px;
    border-radius: 2px;
    background: linear-gradient(to right, white 40%, #444444 40%);
  }
  .mock-range.short {
    width: clamp(40px, 14vw, 90px);
    background: linear-gradient(to right, white 50%, #444444 50%);
  }
  .mock-timeline {
    list-style: none;
    margin: 0 10px;
    padding: 0;
    flex: 1 1 auto;
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-family: ui-monospace, Menlo, monospace;
  }
  .mock-timeline li {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    font-size: 11px;
  }
  .mock-timeline b {
    font-weight: 400;
  }
  .mock-timeline i {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: white;
  }
  .mock-timeline small {
    color: #888888;
    font-size: 10px;
  }
  .mock-note,
  .mock-log {
    color: #aaaaaa;
    font-size: 11px;
  }
  .mock-code,
  .mock-log,
  .mock-button {
    font-family: ui-monospace, Menlo, monospace;
  }
  .mock-button {
    align-self: flex-start;
    padding: 6px 10px;
    border: 1px solid #444444;
    border-radius: 5px;
    background: #1c1c1c;
  }
  .mock-card {
    border: 1px solid #d6dde8;
    border-radius: 8px;
    background: white;
    overflow: hidden;
    font-size: 13px;
  }
  .mock-card-head,
  .mock-card-foot {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    gap: 8px 12px;
    padding: 10px 14px;
    color: #4f5f78;
  }
  .mock-card-head {
    border-bottom: 1px solid #d6dde8;
  }
  .mock-card-foot {
    border-top: 1px solid #d6dde8;
  }
  .mock-toggle {
    display: inline-flex;
    border: 1px solid #c4cedd;
    border-radius: 6px;
    overflow: hidden;
  }
  .mock-toggle > * {
    padding: 4px 10px;
    font-weight: 600;
  }
  .mock-toggle > b {
    background: #152439;
    color: white;
  }
  .mock-review {
    display: flex;
    flex-wrap: wrap;
  }
  .mock-axes {
    list-style: none;
    margin: 0;
    padding: 0;
    flex: 1 1 200px;
    border-right: 1px solid #d6dde8;
  }
  .mock-axes li {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    padding: 10px 14px;
    border-bottom: 1px solid #eef1f6;
  }
  .mock-axes li span:last-child {
    font-family: ui-monospace, Menlo, monospace;
  }
  .mock-axes .is-selected {
    background: #152439;
    color: white;
  }
  .mock-finding {
    flex: 1.3 1 240px;
    padding: 14px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .mock-finding p {
    margin: 0;
    font-size: 13px;
    line-height: 1.7;
  }
  .mock-finding small {
    color: #4f5f78;
    font-size: 11px;
  }
  .mock-notes {
    padding: 14px;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  .mock-note-row {
    display: flex;
    gap: 12px;
    align-items: flex-start;
  }
  .mock-note-row p {
    margin: 0;
    font-size: 13px;
    line-height: 1.7;
    min-width: 0;
  }
  .mock-note-row small {
    display: block;
    color: #4f5f78;
    font-size: 11px;
  }
  .mock-thumb {
    flex: none;
    width: 112px;
    aspect-ratio: 16 / 9;
    box-sizing: border-box;
    padding: 6px;
    border-radius: 4px;
    background: #111111;
    color: white;
    font-size: 10px;
    font-weight: 700;
    display: flex;
    align-items: flex-end;
    line-height: 1.3;
  }
  .mock-course {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .mock-course li {
    display: flex;
    gap: 12px;
    align-items: center;
    padding: 10px 14px;
    border-bottom: 1px solid #eef1f6;
    line-height: 1.5;
  }
  .mock-course li:last-child {
    border-bottom: 0;
  }
  .mock-course li > span:nth-child(2) {
    flex: 1 1 auto;
    min-width: 0;
  }
  .mock-course li > span:last-child {
    flex: none;
    font-size: 12px;
    color: #4f5f78;
  }
  .mock-course .mock-thumb {
    width: 80px;
  }
  .mock-course small {
    display: block;
    font-size: 12px;
    color: #4f5f78;
  }
  .mock-course .is-current {
    font-weight: 600;
  }
  .mock-course .is-locked {
    color: #4f5f78;
  }
  .mock-course .is-locked .mock-thumb {
    background: #d6dde8;
  }
  .mock-kv {
    margin: 0;
    font-size: 14px;
  }
  .mock-kv > div {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    padding: 10px 0;
    border-bottom: 1px solid #d6dde8;
  }
  .mock-kv dt,
  .mock-kv dd {
    margin: 0;
  }
  .mock-kv dd {
    color: #4f5f78;
    text-align: right;
  }
  .mock-yaml {
    background: #111111;
    color: #dddddd;
    border: 0;
    border-radius: 6px;
    padding: 14px 16px;
    font-size: 12px;
    line-height: 1.7;
  }
  /* Recent decks scroll sideways; each snaps to the start edge. */
  .recent-list {
    list-style: none;
    /* Room for the focus ring, which the scroll container would clip. */
    margin: 0 -4px;
    padding: 4px 4px 12px;
    scroll-padding-inline: 4px;
    display: grid;
    grid-auto-flow: column;
    grid-auto-columns: min(300px, 80%);
    gap: 16px;
    overflow-x: auto;
    overscroll-behavior-x: contain;
    scroll-snap-type: x mandatory;
  }
  .recent-list > li {
    min-width: 0;
    scroll-snap-align: start;
  }
  .recent-cover {
    position: relative;
    aspect-ratio: 16 / 9;
    box-sizing: border-box;
    padding: 16px 18px;
    border-radius: 8px;
    background: #111111;
    display: flex;
    align-items: center;
    overflow: hidden;
  }
  .recent-cover:has(.card-title:focus-visible) {
    outline: 2px solid #153b70;
    outline-offset: 2px;
  }
  .recent-cover .card-title {
    color: white;
    font-size: 17px;
    font-weight: 700;
    line-height: 1.4;
    text-decoration: none;
    overflow-wrap: anywhere;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 3;
    overflow: hidden;
  }
  /* The whole cover opens the deck, not just its title text. */
  .recent-cover .card-title::after {
    content: '';
    position: absolute;
    inset: 0;
  }
  .recent-cover .card-title:focus {
    outline: none;
  }
  /* Last, so it wins over the base mock rules of the same specificity. */
  @media (max-width: 520px) {
    .mock-slide {
      aspect-ratio: auto;
      min-height: 200px;
    }
  }
</style>`
