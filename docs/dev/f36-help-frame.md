# ヘルプの枠の実装設計

[ヘルプで答えを見つける](../features/f36-help-answers.md) のうち、枠の部分(作業 H1)の設計である。記事の持ち方、URL、検索、検索エンジンへの指定、いまの節の移し先を決める。このスコープで増える機能の記事と、各画面から記事へのリンクは作業 H2 が足す。

## 何を作ったか

- `/help`(入口)、`/help/<狙い>`(記事の一覧)、`/help/<狙い>/<記事>`(1 記事)、`/help?q=<語>`(検索の結果)。
- 記事は 1 つのファイルに 1 つ。ファイルを足すだけで、一覧と検索に出る。
- 変更の前の節は、42 の記事に分けて移した(下の対応表)。
- サービスの中の `/help#<id>` のリンクを、記事の URL に直した。

層は [設計の決まり](architecture.md) に従う。記事、狙い、索引、検索は純粋な処理で、ページの組み立ては `pages.ts`、経路は `routes.ts` にある。

| ファイル | 層 | 役割 |
| --- | --- | --- |
| `src/help/aims.ts` | 純粋 | 8 つの狙いの順と、名前と 1 行の説明 |
| `src/help/article.ts` | 純粋 | 記事の型(`Article`)と `defineArticle` |
| `src/help/articles/<狙い>/<記事>.ts` | 純粋 | 1 記事。日本語と英語 |
| `src/help/registry.generated.ts` | 純粋(生成) | 記事のファイルの一覧。手で編集しない |
| `src/help/catalog.ts` | 純粋 | 一覧の並び、検索、関係する記事、登録の誤りの検査 |
| `src/help/default-catalog.ts` | 純粋 | 生成した一覧から作る実際の目録 |
| `src/help/numbers.ts` | 純粋 | コードの定数を本文へ差し込む(`helpNumbers`) |
| `src/help/search.ts` | 純粋 | 語の読み取り、索引、順位、抜き出し |
| `src/help/links.ts` | 純粋 | 画面から記事へ単独で置くリンク(`helpArticleLink`) |
| `src/help/paths.ts` | 純粋 | URL の組み立てと `HELP_BOT_PATH` |
| `src/help/pages.ts` | pages | 入口、一覧、記事、検索の結果の HTML |
| `src/help/routes.ts` | routes | 経路と、索引を 1 度だけ作ること |
| `scripts/help-registry.mjs` | — | 記事のファイルを数えて `registry.generated.ts` を書く |

## 記事の持ち方

1 記事は `src/help/articles/<狙い>/<記事>.ts` で、`defineArticle` の結果を `export default` する。狙いと記事の名前は、ディレクトリとファイルの名前である。URL は `/help/<狙い>/<記事>` で、どの表にも書かない。

```ts
export default defineArticle({
  order: 10,                       // 一覧の並び。同じなら記事の名前の順
  form: 'howto',                   // 'howto' は番号つきの手順(<ol>)を持つ。'reference' は一覧や決まりで答える
  related: ['start/code-not-arrived'], // 関係する記事。3 つまで
  ja: { title: '…', lead: () => html`…`, body: (n) => html`…` },
  en: { title: '…', lead: () => html`…`, body: (n) => html`…` },
})
```

| 項目 | 決まり |
| --- | --- |
| `title` | したいことそのもの(D-49)。画面の文言に合わせる。日本語は 40 字まで、英語は 80 字まで |
| `lead` | 最初の 1 文で、答えを言う。1 文だけで、段落や見出しを含まない。一覧と検索の結果で、本文なしで読まれる |
| `body` | 手順は番号つきの列(`<ol>`)、うまくいかないときの理由と対処が続く。小見出しは `<h2>`。`<h1>` と `<h3>` 以下は使わない(ページが `<h1>` を持つ) |
| `form` | `howto` の記事は、日本語と英語の両方の本文に `<ol>` を持つ。テストが確かめる |
| `related` | `<狙い>/<記事>` で、3 つまで。存在しない記事、自分自身、同じ記事の重複は誤りになる |
| 数字 | 上限や条件の数字は、`body` と `lead` が受け取る `n`(`helpNumbers()`)から差し込む。本文に数字を直接書かない(F36-AC11) |

記事の本文から別の記事へ移すときは、`<a href="/help/<狙い>/<記事>">` と書く。行き先が存在することは、テスト(`articles.pure.test.ts`)が全記事について確かめる。

`<狙い>` は `src/help/aims.ts` の 8 つに限る。記事の名前は、小文字の英数字をハイフンでつないだ短い英語で、`routes`・`api`・`middleware`・`store`・`client`・`page`・`pages`・`schema` は使わない(ファイル名がこれで終わると、層の検査が別の層と読むため)。

## URL の決まり

| URL | 内容 |
| --- | --- |
| `/help` | 入口。検索の欄と 8 つの狙い。`?q=` が空か、無いときも入口 |
| `/help?q=<語>` | 検索の結果 |
| `/help/bot` | Luma の配信を読むボットの説明。URL も内容も変えない(D-46) |
| `/help/<狙い>` | 狙いの一覧。`<狙い>` は下の表の 8 つだけ |
| `/help/<狙い>/<記事>` | 1 記事 |
| 上のどれでもない `/help/…` | `404` |

| 狙い | URL の名前 |
| --- | --- |
| はじめる | `start` |
| スライドを置く・直す | `slides` |
| 記事とリンクを添える | `articles` |
| 読む・共有する | `sharing` |
| つながる | `community` |
| AI エージェント | `agent` |
| アカウントとデータ | `account` |
| 安全と規約 | `safety` |

`/help/bot` は、経路の登録で `/help/:aim` より先に置く。加えて、`bot` は狙いの名前にならない(テストが確かめる)ので、狙いを足しても `/help/bot` は隠れない。

外に貼られた `/help#<id>` は、フラグメントがサーバーに届かないので `/help` の入口に着く(F36-AC27)。移し替えはしない。

## 記事の一覧をどう作るか(登録の表を持たない)

記事の一覧は、記事のファイルから作る。Worker は wrangler(esbuild 0.25.12)で束ねる。esbuild は Vite の `import.meta.glob` を展開せず、呼び出しをそのまま残すので、実行時に失敗する。2026-11-26 に、`import.meta.glob("./a/*.ts", { eager: true })` をこの esbuild で束ねて、そのまま出力されることを確かめた(Vite の機能: <https://vite.dev/guide/features#glob-import>)。そこで、ディレクトリを数える小さなスクリプトで一覧を書く。

- `scripts/help-registry.mjs` が `src/help/articles/<狙い>/<記事>.ts` を数え、`src/help/registry.generated.ts` を書く。
- 記事を足す人は、ファイルを置いて `pnpm help:registry` を実行する(または `pnpm build`、`pnpm dev`、`pnpm deploy`。どれも先頭でこのスクリプトを実行する)。表を手で直さない。
- 一覧がファイルの実際とずれていると、`scripts/help-registry.test.mjs` が落ちる。直し方は `pnpm help:registry` で、メッセージにも書いてある。
- 一覧は 1 行 1 記事で、並びは名前の順。別々の記事を足す 2 つのブランチは、たいてい衝突せずに取り込める。衝突したら、`pnpm help:registry` で書き直す。

`catalogProblems`(`src/help/catalog.ts`)が、一覧の誤り(知らない狙い、形の違う名前、重複、関係する記事の誤り)を文で返し、`catalog.pure.test.ts` が実際の一覧に誤りがないことを確かめる。

## ページ

3 段のページは、`src/help/pages.ts` の 4 つの関数が描く。置くものと順番は、02-PAGES.md の 04〜07 のとおりである。

- 入口: 検索の欄、8 つの狙い(名前は一覧へのリンク、1 行の説明、記事を 3 つまで)、お問い合わせへのリンク。狙いは幅 600px 以上で 2 列、未満で 1 列。カードにしない。
- 狙いの一覧: パンくず、題名、記事ごとに題名(リンク)と最初の 1 文。「安全と規約」の一覧の末尾に `/help/bot` へのリンクを置く。
- 記事: パンくず(いまのページに `aria-current="page"`)、題名、最初の 1 文、本文、関係する記事(あるときだけ)、「解決しないときは」。
- 検索の結果: 検索の欄(語が入っている)、「(語)の記事 n 件」と各記事、または 0 件の文と狙いの一覧。

CSP は 2 つある。検索の欄を持つ入口と検索の結果は、これまでの `PLAIN_PAGE_POLICY` の `form-action 'none'` を `'self'` に変えたもの(`HELP_SEARCH_PAGE_POLICY`)で、検索の欄が `/help` に送るためである。ほかの指定は変えない。フォームのない狙いの一覧と記事は、これまでと同じ `PLAIN_PAGE_POLICY`(`HELP_PAGE_POLICY`)を使う。フォームのないページどうしの移動(規約から記事など)は、ページの読み込みにならず、枠の中で行われる。入口へは、フォームを禁じるページ(規約など)から移ると、ページを読み込み直す。

## 検索

`/help?q=<語>` は、サーバーで、記事の題名と本文を探す。外部の検索サービスも、新しい script も使わない(D-50)。

### 語の読み取り(`parseQuery`)

| 入力 | 扱い |
| --- | --- |
| 無い、空、空白だけ(全角を含む) | 検索ではない。入口を出す(F36-AC19) |
| 64 字を超える | 64 字(文字の数。絵文字を半分に切らない)で切る。エラーにしない。切ったあとの語を欄に戻す(F36-AC20) |
| 空白で分けた語が 5 つを超える | 先頭の 5 つだけ。語は、すべてを含む記事を探す(AND) |
| 英数字も文字も含まない語(記号だけ、絵文字だけ) | 探す対象にしない。語が残らなければ 0 件(「?」が多くの本文に合ってしまうのを避ける) |
| HTML を含む | そのまま文字として扱う。欄にも結果の文にも、エスケープして出す(F36-AC21) |

日本語は語に分けず、部分一致で探す(D-50)。空白で語を分けるのは、「sign in」のように複数の語を打った人のためである。

長さの上限 64 字は、欄の `maxlength` と同じ値(`MAX_QUERY_CHARS`)にした。上限の値は F36 の未決事項で、決めた(F36 の「決めたこと」に書き写した)。

### 索引

- 索引は、記事のファイルから、最初の検索のリクエストで 1 度だけ作る(`routes.ts` が Promise を持つ)。記事の `lead` と `body` を実際に描き、タグを除き、実体参照を戻し、空白を 1 つにして文字列にする。ページが出す文章と同じなので、本文を直しても索引が古くならない。
- 日本語と英語の両方を持つ。表示言語にかかわらず、両方を探す(F36-AC16)。語が両方の言語の記事に合うときは、表示言語の記事の抜き出しを出す。抜き出しが別の言語のときは、`<p lang="…">` で言語を示す。
- 比較のために畳み込む(`fold`): 全角と半角、互換の形、大文字と小文字をそろえる。畳み込みは文字ごとに行い、長さを変える文字(`ß` など)はそのままにするので、畳み込んだ文字列の位置が元の文字列の位置に等しい。抜き出しは、この位置で元の文章を切る。語は、半角の濁点つきカタカナのように、全体を見ないと 1 文字にならないものがあるので、全体を畳み込む(`foldQuery`)。

### 順位

記事ごとに、言語ごとの点を付け、高い方を取る。同点は、表示言語の記事を先にする。

| 語が合う場所 | 点(語ごとの合計) |
| --- | --- |
| 題名 | 1000 |
| 最初の 1 文 | 100 |
| 本文(出てくる回数。最大 9) | 1 から 9 |

語が複数のときは、すべての語がその記事のどこかに含まれていなければならない。5 語までなので、題名の 1000 点は、最初の 1 文と本文のどんな組み合わせ(5 語で最大 545)より大きい。題名に合う記事が、本文だけに合う記事より必ず上に出る(F36-AC15)。同点は、一覧の読む順(狙いの順、`order`、記事の名前)で並べる。

### 抜き出し

最初に合った場所の前 30 字、後ろ 90 字(合計 120 字ほど)を切り出す。サロゲートペアと英単語の途中で始めない。合った語は、`{ text, mark }` の列として返し、ページが `<mark>` で包む。`text` はすべて文字列で、ページが `hono/html` のエスケープを通して出すので、入力も記事の文章も、HTML として解釈されない。記事の文章に `<title>` と書いてあっても、`<mark>&lt;title&gt;</mark>` と出る(`routes.test.ts`)。

### 大きさの見積もり

2026-11-26 に、42 の記事で測った。

| 項目 | 値 |
| --- | --- |
| 記事の数 | 42 |
| 索引の文字数(題名と本文、日本語と英語) | 43,426 字(日本語 14,879、英語 28,547) |
| 畳み込んだ写しを含めた大きさ(UTF-8 の見積もり) | 137 KB |
| 索引を作る時間(1 回) | 約 21 ms |
| 1 回の検索 | 約 0.12 ms |

記事が 100 に増えても、300 KB ほどで、検索は 1 ms に届かない見込みである。索引は Worker の isolate ごとに 1 度作る。D1 も KV も使わない。記事が数百を超え、検索が遅くなったときに、索引の持ち方を見直す。

## 検索エンジンへの指定

- 入口、狙いの一覧、記事は検索に載せる(D-51)。`src/site/indexing.ts` の `isIndexablePath` が、`/help/<狙い>` と `/help/<狙い>/<記事の形の名前>` を許す。記事が無いときは `404` で、成功でないので載らない(`X-Robots-Tag: noindex, nofollow` が付く)。
- 検索の結果(`/help?q=<語>`)は載せない。応答に `X-Robots-Tag: noindex` を付け、`<meta name="robots" content="noindex">` も出す。`Link` の `alternate` も付けない(結果のページを別の言語で指す意味がない)。
- 入口、狙いの一覧、記事は、`Link: <…>; rel="alternate"; hreflang="ja"|"en"|"x-default"` を付ける(F36-AC23)。既存の `alternateLinks` に乗せた。

## `/help/bot`

URL も内容も変えない。`src/site/help-bot-page.ts` はそのままで、`HELP_BOT_PATH` を `src/help/paths.ts` に移した。「安全と規約」の一覧から、題名だけのリンクで移れる。

## メンテナンス中

ヘルプの経路は、メンテナンスの確認(`app.use(maintenance, …)`)より前に登録するので、メンテナンス中も読める(D-119)。ヘルプは D1 を読まない。テスト(`routes.test.ts`)は、触ると例外を投げる `DB` を渡し、`MAINTENANCE=on` で、入口、狙いの一覧、記事、検索の結果、`/help/bot` のすべてが `200` で開くことを確かめる。

## 変更の前の節の移し先

変更の前のヘルプは、16 の節が 1 枚のページに並んでいた。1 つの節が複数の「したいこと」を含むときは、記事を分けた。記事の題名は、画面の文言に合わせて直してよい(F36)。内容は変えていない。変えたのは、次の 3 種類だけである。

1. 各記事の最初の 1 文を、答えとして取り出した(元の文のままのものと、元の内容から言い直したものがある)。
2. 「〜の節を読んでください」を、記事へのリンクに直した(6 か所、日本語と英語で 12 文)。
3. 小見出しは、記事が 1 つの話だけを持つときは外した(題名が同じ話をするため)。

移し替えが文のまま行われたことは、変更の前の本文を文ごとに分け、移し先の記事に含まれるかを確かめて、664 文のうち 648 文が一致し、残り 16 文が上の 1 の言い直し(4 文)と 2 のリンクへの直し(12 文)であることを、手作業の検査(この PR の作成時)で確かめた。`src/help/moved-content.pure.test.ts` は、変更の前のテストが確かめていた内容(数字、画面の文言、条件)を、移し先の記事に対して確かめる。

| 変更の前の節 | 移し先の記事(`/help/<狙い>/<記事>`) |
| --- | --- |
| ログイン(`login`) | `start/sign-in`(ログインする)、`start/invitation-only`(招待されているか確かめる)、`start/code-not-arrived`(ログインのコードが届かないとき)、`account/change-email`(メールアドレスを変える、受信箱を失ったとき) |
| プロフィール(`profile`) | `account/edit-profile`(プロフィールを書く)、`account/profile-picture`(プロフィール画像を変える)、`account/email-privacy`(メールアドレスがほかの人に見えるか確かめる) |
| 置き方(`upload`) | `slides/upload`(スライドを置く)、`slides/accepted-files`(置けるファイルの形を確かめる)、`slides/limits`(置ける大きさと本数の上限を知る)、`slides/replace`(スライドを差し替える)、`slides/url-name`(URL の名前を変える) |
| 記事(`article`) | `articles/write`(記事を書く)、`articles/publish`(記事を公開する、公開を止める)、`articles/embed-page`(記事にスライドのページを入れる)、`articles/markdown`(記事に使える書き方を知る)、`agent/write-article-draft`(AI エージェントに記事の下書きを書いてもらう) |
| 関連リンク(`links`) | `articles/related-links`(関連リンクを足す) |
| ページごとの共有(`page-share`) | `sharing/page-url`(ページを指す URL を共有する)、`sharing/page-numbers`(ページ番号の決まりを知る) |
| 引用(`citations`) | `community/cite-slides`(ほかのスライドを引用する)、`community/see-citations`(引用されたことを知る) |
| ブログへの埋め込み(`embed`) | `sharing/embed-in-blog`(ブログにスライドを埋め込む) |
| AI エージェントから置く(`agent`) | `agent/connect`(AI エージェントをつなぐ)、`agent/capabilities`(AI エージェントにできること、できないことを知る)、`agent/revoke`(AI エージェントの接続を取り消す) |
| フォロー(`follow`) | `community/follow-people`(人をフォローする)、`community/unfollow`(フォローをやめる) |
| イベントの発表(`events`) | `community/list-event-talks`(スライドをイベントの発表として並べる)、`community/event-names`(イベント名を直す)、`community/remove-event-talk`(スライドをイベントのページから外す) |
| コミュニティ(`communities`) | `community/create-community`(コミュニティを作る)、`community/link-rules`(紐づけ用リンクを決める)、`community/community-admins`(コミュニティを管理する)、`community/follow-community`(コミュニティをフォローする)、`community/delete-community`(コミュニティを削除する)、`community/ask-us`(ハンドルの変更などを運営に頼む) |
| ブロック(`block`) | `safety/block-user`(人をブロックする)、`safety/block-vs-mute`(ブロックとミュートの違いを知る) |
| 安全について(`safety`) | `safety/external-access`(知らない人のスライドを安全に開く) |
| 規約(`terms`) | `safety/terms`(利用規約を読む)。作業 T のページ `/terms` へのリンクを持つ短い記事 |
| プライバシー(`privacy`) | `safety/privacy`(プライバシーポリシーを読む)。`/privacy` へのリンクを持つ短い記事 |

`safety/terms` と `safety/privacy` は、いまの仮のページへのリンクと、「仮のページ」という注記だけを持つ。作業 T が文面を載せたあと、作業 H2 が「禁止されていること」など(F36-AC34、F36-AC35)に書き直す。

## 画面からの記事へのリンク

サービスの中の `/help#<id>` は、すべて記事の URL に直した(D-47)。

| 場所 | 旧 | 新 |
| --- | --- | --- |
| 記事の編集のページの「Markdown ガイド」 | `/help#article` | `/help/articles/markdown` |
| ブロックの確認のページ | `/help#block` | `/help/safety/block-user` |
| コミュニティを作るページ | `/help#communities` | `/help/community/create-community` |

単独で置くリンクは `helpArticleLink(狙い, 記事, 文言)`(押せる高さ 44px の `help-link`)で作る。`links.test.ts` が、ソースの中に `/help#` が残っていないこと、`/help/…` と書かれた URL とこの関数の引数が、実際の記事を指すことを確かめる(F36-AC26、F36-AC48)。

## 作業 H2 が記事を足すとき

1. `src/help/articles/<狙い>/<記事>.ts` を作る。形は、同じ狙いの記事(たとえば `start/sign-in.ts`)をまねる。
2. `pnpm help:registry` を実行し、`src/help/registry.generated.ts` の変更を commit に含める。
3. 日本語と英語の `title`、`lead`、`body` を書く。上限の数字は `helpNumbers()` に足して `n` から差し込む。
4. `pnpm test:pure src/help/articles.pure.test.ts src/help/catalog.pure.test.ts` を実行する。形の誤り(最初の 1 文が 2 文、`howto` に `<ol>` が無い、関係する記事が存在しない、英語に日本語が混じる、など)が出る。
5. 検索の目当ての語は、`src/help/search.pure.test.ts` の F36-AC49 の表に足す。

## 確かめていないこと

- 実際のブラウザでの見え方は、`verify-slide` で 1280px と 375px で撮って確かめる(PR に添える)。
- 検索エンジンが実際に索引を作ることは、ローカルでは確かめられない。応答の `X-Robots-Tag`、`<meta name="robots">`、`Link` ヘッダーを確かめるだけである。

## 第四スコープの記事(作業 H2)

H1 の枠に、このスコープで増えた機能の記事を足した。URL の名前と題名は [ヘルプで答えを見つける](../features/f36-help-answers.md#未決事項) の表にある。

- 記事の言葉は、画面の言葉と合わせる。かぎ括弧の中の言葉は、`src/help/screen-words.test.ts` が、サービスのソースにあることを確かめる(F36-AC9)。画面の言葉を直したら、このテストが記事の古い言葉を知らせる。例を示す引用(エージェントへの頼み方、値を入れた表示)は、テストの `NOT_SCREEN_WORDS` に名前を挙げる。
- 利用規約とプライバシーポリシーの条は、番号ではなく、条の題と位置(`id`)で指す(D-132)。`src/help/legal-links.ts` が、題から条を探し、`/terms#article-<番号>` のリンクを作る。文面を差し替えて番号が動いても、リンクは題についていく。題が無くなると、リンクは文面のページに戻り(行き先が無いページにならない)、`src/help/fourth-scope-articles.pure.test.ts` が失敗する。
- 「禁止されていること」の日本語の一覧は、利用規約の「禁止事項」の号を、そのまま描く(言葉を合わせるため)。英語の一覧は訳で、号の数が変わるとテストが失敗する。
- `safety/terms` と `safety/privacy` は、文面が下書きのあいだだけ、下書きであることを書く(`legalIsDraft`)。施行日が入ると、その 1 段落が消える。
- 記事に数字を足すときは、`helpNumbers()` に足す(書き出しの 1 つの zip の上限、1 ページの本数、取り出す URL の期限、1 回に返すファイルの数を足した)。
- 記事を足したら、`src/help/moved-content.pure.test.ts` の `ADDED_ARTICLES` に足す。

### 画面から記事へのリンク(作業 H2)

迷いやすい画面から、対応する記事へ 1 回で行ける(D-52)。リンクの置き場と行き先は、`src/help/frame-places.ts` の表 `FRAME_HELP` が 1 か所で持つ。枠の中のリンクは `frameHelpLink(場所, lang)` が、枠の見出しか説明のすぐ下の注記として 1 つだけ描く(押せる高さ 44px の `help-link`)。1 つの枠に 1 つまで(F36-AC41)。

| 場所 | 行き先(`/help/<狙い>/<記事>`) |
| --- | --- |
| 設定「プロフィール」 | `account/edit-profile` |
| 設定「アカウント」 | `account/change-email` |
| 設定「データを書き出す」 | `agent/export-with-agent`(「AI エージェントで書き出す方法」。`EXPORT_AGENT_HELP_PATH`) |
| 設定「AI エージェントから置く」 | `agent/connect` |
| 設定「管理しているコミュニティ」 | `community/community-admins` |
| 設定「ブロックしている人」「ミュートしている人」 | `safety/block-vs-mute` |
| 設定「退会」 | `account/before-leaving` |
| 1 本の管理「ダウンロード」 | `account/export-slide` |
| スライドの編集の「スライド」の枠 | `slides/replace` |
| 1 本の管理(運営が非表示にしているとき) | `safety/hidden-slide` |
| コミュニティの編集 | `community/community-admins` |
| AI エージェントの接続の許可 | `agent/capabilities` |
| 書き出しを断ったときの画面 | `account/export-slide` |
| 「アカウントは停止中です」 | `safety/appeal` |
| ログイン(新しい登録を止めているとき) | `start/sign-up` |
| ログイン(コードの送信が集中している、請求が多すぎるとき) | `start/code-not-arrived` |
| ドロップの枠の、置けなかった理由(大きさ、本数、置けるスライドの本数) | `slides/limits` |
| ドロップの枠の、新しいスライドを今日はこれ以上置けないとき(`new_author_limit`。F36-AC37) | `slides/daily-limit` |
| ドロップの枠の、置けなかった理由(ファイルの形、名前、zip の中身) | `slides/accepted-files` |
| ドロップの枠の、ログインが切れているとき | `start/sign-in` |
| ドロップの枠の、このアカウントでは受け取れないとき | `safety/appeal` |
| ドロップの枠の、作者として登録されていないとき(`not_registered`) | `start/sign-up` |

「通知」と「表示言語」の枠には、対応する記事が無いので、リンクを置かない。ドロップの枠の理由は、`src/drops/help-place.ts` が理由ごとに行き先を決め(純粋)、`public/drop.js` が理由の文のあとに `help-link` を足す。ログインしていない人の「招待制です」の理由は、招待を外すと出ない理由なので、リンクを置かない。

### AI エージェントの道具が断る答え(F36-AC47)

道具が断るとき、答えに `help`(記事の絶対の URL)を足す。`src/mcp/refusal-help.ts` が、断りの符号から記事を決め(`reconnect_required` は `agent/reconnect`、`not_allowed` は `safety/appeal`、置く量の上限は `slides/limits`、新しい登録者の本数の上限(`new_author_limit`)は `slides/daily-limit`、`get_slide_files` の続きの断りは `agent/export-with-agent`)、`guarded` が答えに足す。断りの文は変えない。記事が無い符号には足さない。

### 記事の見直しと、検索の目当ての語(作業 H2)

- すべての記事の最初の 1 文を、D-49 に照らして見直した。答えになっていなかった 5 本を直した: `slides/limits`(上限の数を最初の 1 文に差し込む)、`articles/write`、`articles/publish`(画面のどのボタンを押すか)、`safety/block-vs-mute`(違いそのもの)、`safety/external-access`(ブラウザが何を許さないか)。
- 利用者が打ちそうな語を、日本語と英語で 10 個ずつ選び(このスコープの記事の分。F36-AC37 の記事の分として、日本語と英語で 2 個ずつ足した)、目当ての記事が上から何番目に出るかを確かめた(`search.pure.test.ts` の F36-AC49)。足した 4 個も含めて、1 番目に出る(下の表の 20 個は H2 の分)。出なかった 2 語(英語の「appeal」「reconnect」)は、記事の英語の題名を直して出るようにした(検索の仕組みは変えていない)。

| 言語 | 語 | 目当ての記事 | 順位 |
| --- | --- | --- | --- |
| 日本語 | 書き出す | account/export-all | 1 |
| 日本語 | 置き直す | account/reupload-zip | 1 |
| 日本語 | メンテナンス | safety/maintenance | 1 |
| 日本語 | 禁止 | safety/prohibited | 1 |
| 日本語 | 非表示 | safety/hidden-slide | 1 |
| 日本語 | 異議 | safety/appeal | 1 |
| 日本語 | 連絡先 | safety/operator | 1 |
| 日本語 | 退会 | account/before-leaving | 1 |
| 日本語 | 登録 | start/sign-up | 1 |
| 日本語 | 預かっている情報 | safety/data-we-keep | 1 |
| 英語 | export | account/export-all | 1 |
| 英語 | reconnect | agent/reconnect | 1 |
| 英語 | maintenance | safety/maintenance | 1 |
| 英語 | prohibited | safety/prohibited | 1 |
| 英語 | hidden | safety/hidden-slide | 1 |
| 英語 | appeal | safety/appeal | 1 |
| 英語 | operator | safety/operator | 1 |
| 英語 | leave | account/before-leaving | 1 |
| 英語 | sign up | start/sign-up | 1 |
| 英語 | information we keep | safety/data-we-keep | 1 |
| 日本語 | これ以上置けません | slides/daily-limit | 1 |
| 日本語 | 新しいスライド | slides/daily-limit | 1 |
| 英語 | any more today | slides/daily-limit | 1 |
| 英語 | today | slides/daily-limit | 1 |

### 保存した版の記事と、帯からのリンク(作業 H2、F36-AC32)

- `sharing/read-offline`(通信が切れてもスライドを読む)と `sharing/stored-version`(「保存した版を表示しています」と出たとき)を足した。帯の言葉(「接続できないため、保存した版を表示しています」「もう一度読み込む」)は、`src/offline/shell-pages.ts` の言葉を、`screen-words.test.ts` が確かめる。1 日と 20 本は `helpNumbers()` の `offlineDays`、`offlineSlides`(`src/offline/limits.ts` の定数)から差し込む。ブラウザーの設定で保存したものを消す方法は、[実装設計](f37-offline-reading.md#保存したものを利用者が消す方法ヘルプの材料)の材料のとおりである。
- 帯(`storedBandSlot`)に、`sharing/stored-version` へのリンクを 1 つ足した(`viewer-notice-help`、押せる高さ 44px)。通信が切れているあいだは、ヘルプのページも開けないので、このリンクが効くのは、通信はできるが版の origin だけが応えないときと、通信が戻ったあとである。
