# 計測の実装設計

[運営が使われ方を知る](../features/f40-operator-metrics.md)の設計です(作業 A)。何が使われ、どこで詰まっているかを、人を追わずに、週ごとの数字で知る仕組みを書きます。依頼者が行う設定(Analytics Engine の dataset、読み取り用のトークン)の手順は[計測の設定の手順](metrics-setup.md)にあります。

## 方針

- 記録は Workers Analytics Engine に書く(D-71)。外部の解析サービス、外部の script は使わない。CSP に新しい origin を足さない(F40-AC16)。
- 書くのは、出来事の種類、スライドやコミュニティの番号、理由の区分、参照元のホスト名、表示言語、件数だけ。IP アドレス、メールアドレス、利用者の番号、Cookie の値、端末を見分ける値は、**型に入れる場所が無い**(`MetricEvent`)。
- 書く口は 1 つ(`record`)。binding が無い環境では何もせず、書く処理が失敗しても応答を遅らせず、壊さない(D-08、F40-AC22、F40-AC24)。
- 1 日 1 回、前の日の件数を読み、D1 の日ごとの集計に写す(D-75)。運営の画面の週ごとの表は D1 から出す(D-76)。Analytics Engine の記録は 3 か月で消えるが、集計は残る。
- 作者の数のように D1 から正確に数えられるものは、D1 から数える。標本化された記録から数えない。

## 出来事の一覧(D-72)

`src/metrics/events.ts` の `MetricEvent` が、書ける出来事のすべてです。出来事ごとに、持てる項目が決まっています。「書く場所」は、出来事を書く 1 行がある場所です。

| 出来事(`name`) | 何を数えるか | 書く場所 | 付ける項目 | 受け入れ条件 |
| --- | --- | --- | --- | --- |
| `upload_started` | 置く操作を始めた数。同じ試行の再送は数えない | `src/uploads/api.ts` の `startUpload` | `source`(`browser`・`mcp`) | F40-AC5 |
| `upload_finished` | 置く操作が終わった数(版が ready になった数)。同時の finalize のうち、ready にした 1 つだけが数える | `src/uploads/api.ts` の finalize | `source`、スライドの番号 | F40-AC1、F40-AC5 |
| `upload_refused` | 置くのを断った数 | `src/uploads/api.ts`(`startUpload`、`requireAuthor`) | `reason`(`too_many_files`・`file_too_large`・`deployment_too_large`・`author_bytes_exceeded`・`daily_starts_exceeded`・`deck_limit`・`not_allowed`) | F40-AC6 |
| `deck_published` | 公開された数。値は、版が ready になってから公開されるまでの秒数 | `src/publication/routes.ts`(API と画面の 2 つ) | スライドの番号、値(秒) | F40-AC2、F40-AC7 |
| `deck_opened` | 読者がスライドを開いた数。作者が自分で開いたもの、作者だけの確認用の表示は数えない | `src/share/routes.ts`、`src/embed/routes.ts` | `via`(`page`・`embed`)、スライドの番号、参照元のホスト名 | F40-AC3、F40-AC10、F40-AC11 |
| `login_code_sent` | ログインのコードを送った数(招待されていない宛先は、送らないので数えない) | `src/auth/login-routes.ts` | なし | F40-AC4 |
| `login_code_entered` | コードが入れられた数 | `src/auth/login-routes.ts` | `outcome`(`accepted`・`rejected`) | F40-AC4 |
| `article_published` | 記事を公開した数(下書きから公開へ) | `src/articles/routes.ts` | スライドの番号 | F40-AC8 |
| `related_link_added` | 関連リンクを足した数(画面と AI エージェントの道具) | `src/decks/routes.ts`、`src/mcp/article-api.ts` | スライドの番号 | F40-AC8 |
| `citation_made` | ほかのスライドへのリンクを含む版が置かれた数 | `src/uploads/api.ts` の finalize | なし | F40-AC8 |
| `oembed_served` | 埋め込みの方法を、ほかのサイトに答えた数(oEmbed) | `src/embed/routes.ts` | なし | F40-AC8 |
| `community_created` | コミュニティを作った数 | `src/communities/routes.ts` | コミュニティの番号 | F40-AC8 |
| `community_followed` | コミュニティのフォローが新しく増えた数 | `src/communities/follow-routes.ts` | コミュニティの番号 | F40-AC8 |
| `author_followed` | 作者のフォローが新しく増えた数 | `src/follows/routes.ts` | なし | F40-AC8 |
| `export_downloaded` | 書き出しを受け取った数。HEAD は数えない | `src/exports/export-routes.ts` | `what`(`slide`・`article`・`info`・`account`・`picture`) | F40-AC8 |
| `mcp_tool_called` | AI エージェントの道具の呼び出し。書けるアカウントの呼び出しだけ | `src/mcp/server-routes.ts` の `guarded` | `tool`(道具の名前) | F40-AC9 |
| `help_search_empty` | ヘルプの検索で 0 件だった語 | `src/help/routes.ts` | 語(50 文字まで) | F40-AC12 |
| `help_article_viewed` | ヘルプの記事の閲覧 | `src/help/routes.ts` | 記事(`<狙い>/<名前>`) | F40-AC13 |
| `help_to_contact` | ヘルプの記事から、お問い合わせへ進んだ数 | `src/app/routes.tsx`(お問い合わせのページ) | 記事(`<狙い>/<名前>`) | F40-AC13 |
| `screen_error` | エラーのページを出した数。メンテナンスは、予定したものなので数えない | `src/app/routes.tsx`(`notFound` と `onError`) | `kind`(`not_found`・`server_error`)、答えた経路の型(`/slides/:deck` のような形) | F40-AC14 |

意図した判断:

- **「置かれたスライド」は終わった数**。新しいスライドと新しい版を分けない。分けるには、finalize で版の順番を引く必要があり、読みの重さに見合わない。運営が知りたいのは、置く操作が最後まで通る数である。
- **「埋め込み」の使われた数は、oEmbed の応答**。ブログの側で埋め込みの方法を尋ねられた数であり、埋め込みの表示は `deck_opened`(`via` = `embed`)で別に数える(F40-AC11)。埋め込みのコードを画面でコピーした数は、サーバーに届かないので数えない(次の節)。
- **作者の数は D1 から数える**。記録からは数えない。
- **`citation_made` は、再送された finalize で重なりうる**。引用の記録は、版が ready になる前に行われ、再送で 2 度行われることがある。ready にした 1 つの要求だけが数えるので、重ならない。

## 記録の形(Analytics Engine の 1 行)

出来事 1 つが、データセット(`slide_events`)の 1 行になります。

| 場所 | 中身 |
| --- | --- |
| `index1` | 出来事の名前。**唯一の index**(標本化の鍵) |
| `blob1` | `detail`。出来事ごとの区分(`source`、`reason`、`outcome`、`what`、`tool`、`via`、`kind`)、ヘルプの検索の語、ヘルプの記事。無ければ空 |
| `blob2` | 参照元。ホスト名か、`internal`(サービスの中からの移動)。無ければ空。`deck_opened` だけ |
| `blob3` | 表示言語(`ja`・`en`)。分からなければ空 |
| `blob4` | スライドかコミュニティの番号。無ければ空 |
| `blob5` | 答えた経路の型(`screen_error` だけ)。無ければ空 |
| `double1` | 出来事の値。持つのは `deck_published`(秒)だけ。持たない出来事は、doubles を空にする |
| `timestamp` | Analytics Engine が自動で付ける。日は UTC |

- index を出来事の名前にするのは、標本化が index ごとに行われるため。たくさん起きる `deck_opened` が標本化されても、まれな出来事(`deck_published`、`upload_refused`)は、すべて残る。
- 順番は固定で、足すときは末尾に足す(値は位置で読む)。
- 1 回の呼び出しで書く行は、数行まで。1 回の Worker の呼び出しで書けるのは 250 行まで。index は 1 つ(96 バイト以内)、blob は 20 個まで、blob の合計は 16 KB まで。この行は、blob を 5 つ、1 つあたり数十文字しか使わない。
- 書くときに、値を検査する(`dataPointOf`)。番号は `^[A-Za-z0-9_-]{1,64}$`、区分は `^[a-z0-9_]{1,40}$`、記事は `<狙い>/<名前>`。検査に通らない出来事は、行にしない(null)。型を強制した呼び出しでも、検査が止める。

## 書く口

`src/metrics/` にあります。層は[設計の決まり](architecture.md)に従います。

| ファイル | 層 | 役割 |
| --- | --- | --- |
| `events.ts` | 純粋 | `MetricEvent`(書ける出来事と、その項目)、`dataPointOf`(出来事から行を作る)。新しい出来事は、ここに型と作り方を足すまで、コンパイルが通らない |
| `referrer.ts` | 純粋 | `referrerOf`(Referer からホスト名だけを取り出す)、`ownHostsOf` |
| `term.ts` | 純粋 | `searchTermOf`(ヘルプの検索の語を、書けるなら 50 文字までにして返す) |
| `refusal.ts` | 純粋 | `refusalClassOf`(置くのを断った例外から、理由の区分を読む) |
| `help-referrer.ts` | 純粋 | `helpArticleOfReferrer`(お問い合わせのページの Referer から、来たヘルプの記事を読む) |
| `event-store.ts` | store | `writeDataPoint`(データセットへ書く。待たない。例外は名前だけをログに残して捨てる) |
| `ready-store.ts` | store | 版が ready になった時刻を読む(公開までの時間のため) |
| `record-routes.ts` | routes | `record(env, event, lang?)`、`recordFrom(c, event)`(言語を付ける)、`afterResponse`(応答の後に仕上げる)。決して例外を投げない |
| `published-routes.ts` | routes | `recordPublished`。公開までの時間は、binding があるときだけ、応答の後に読む |

- `record` は `MetricEvent` だけを受け取る。呼ぶ側が、IP アドレスや Cookie を渡す場所が無い(F40-AC15)。
- binding が無い(`env.ANALYTICS` が無い)ときは、`record` は何もしない。公開までの時間の読みも、binding が無ければ行わない。
- 書く処理の失敗は、`metric_write_failed`(出来事の名前だけ)をログに残して捨てる。例外の文面は、通信の送り先やデータを含みうるので、ログに出さない。
- `waitUntil` が使えるときは、D1 を読む仕上げ(公開までの時間)を応答の後に回す。使えないとき(テスト、手元の道具)は待つ。書く処理そのもの(`writeDataPoint`)は待たない。
- 層の決まり(`scripts/layers.test.mjs`)のため、`src/site/errors.ts` は触らず、エラーの数は `src/app/routes.tsx` の `notFound` と `onError` の前後で書く。`HTTPException` は、意図して返す答えなので数えない。

### 参照元とヘルプの検索の語(D-73)

- 参照元は、`Referer` からホスト名だけを残す。パス、クエリ、ポート、ユーザー情報は捨てる。サービス自身(`PUBLIC_ORIGIN`、`OPERATOR_ORIGIN`、`CONTENT_ORIGIN` とその下の名前)からの移動は `internal` にまとめる。web でない参照元、読めない参照元、**IP アドレスで名指された参照元**は、何も残さない(IP アドレスを書かないため)。
- ヘルプの検索の語は、0 件だったものだけを書く。空白をつめ(NFKC)、50 **文字**(UTF-16 の単位ではなく文字。絵文字を半分に切らない)までにする。メールアドレス(`@`)、IP アドレス、web の住所、24 文字以上の英数字の並び(token や鍵の貼り付け)の形をしている語は、**切る前の全体で**調べ、当たれば書かない。自分のアドレスを検索欄に入れた人の入力が、記録に残らないため。
- お問い合わせへ進んだ数は、サーバーに届く要求で数える。お問い合わせのページ(`/contact`)が、来た元のヘルプの記事を `Referer` から読む。元の記事は、サービス自身の `/help/<狙い>/<名前>` に限る。ほかのサイトからは数えない。

## サーバーに届かない画面の操作(D-74、F40-AC16)

D-72 の表を、1 行ずつ見直した。**画面からの送信は、足さない**。

| D-72 の測るもの | サーバーに届くか |
| --- | --- |
| 置く、公開する、開く、ログイン、記事、関連リンク、引用、コミュニティ、フォロー、書き出し、道具の呼び出し | 届く(経路が呼ばれる) |
| 参照元、埋め込みからの閲覧 | 届く(閲覧の要求の `Referer`) |
| ヘルプの 0 件の検索、記事の閲覧 | 届く(`/help`) |
| 記事から問い合わせに進んだ数 | 届く(進んだ先の `/contact` の要求) |
| エラーの数 | 届く(エラーのページを出す経路) |

ブラウザの中だけで完結する操作(埋め込みのコードのコピーなど)は、D-72 の表に無い。足していないので、CSP も、script も、変わらない。`navigator.sendBeacon` などの送信が要るようになったら、同じ origin への POST で足す。

## 標本化と数え方

Workers Analytics Engine は、書き込みが多いと、書くときと読むときに標本化する。1 行ごとに `_sample_interval`(標本の割合の逆数。1% なら 100)が付き、行ごとに違いうる。このため、**件数は `count()` ではなく `SUM(_sample_interval)` で数える**。

| 数えるもの | 標本化されない場合 | この設計(標本化に備える) |
| --- | --- | --- |
| 件数 | `count()` | `SUM(_sample_interval)` |
| 値の合計(公開までの秒) | `sum(double1)` | `SUM(double1 * _sample_interval)` |
| 値の平均 | `avg(double1)` | `SUM(double1 * _sample_interval) / SUM(_sample_interval)` |

- 一定の係数を掛けるのは誤り。行ごとの `_sample_interval` を使う。
- 精度は、行の数と分布で決まる。まれな値(ほとんど書かれない検索の語)は、標本化で見えなくなりうる。index を出来事の名前にしているので、標本化は出来事ごとに行われ、まれな出来事は影響を受けにくい。
- index の外の項目の種類を数える(異なり数)ことは、正確でない。**異なる人の数は数えない**(人ごとの追跡はしない)。
- D1 に写した集計の件数は、標本化から推計した値である。正確な値が欲しい数(作者の数)は、D1 の表から直接数える。

## 日ごとの集計(D1、2/3 で作る)

1 日 1 回、前の日(UTC)の件数を Analytics Engine から読み、D1 の表に写す(D-75)。migration `0066_metric_daily.sql`。

| 表 | 何を持つか |
| --- | --- |
| `metric_daily` | 1 行が、日(UTC。`YYYY-MM-DD`)・出来事・`detail`・参照元・言語・画面の組。持つのは、推計した件数(`events`。`SUM(_sample_interval)`)と、値の合計(`value_sum`。`SUM(double1 * _sample_interval)`)。主キーは組の 6 つ。スライドやコミュニティの番号は、集計で落とす |
| `metric_days` | 写し終えた日。日、写した時刻、書いた行数、打ち切ったか。空の日(出来事が無かった日)も 1 行になる |

- 読む問い合わせは 1 日に 1 つ。`FORMAT JSON` を付け、`WHERE timestamp >= toDateTime('<日> 00:00:00') AND timestamp < toDateTime('<次の日> 00:00:00')` で日の幅を切り、`GROUP BY` で出来事・`blob1`・`blob2`・`blob3`・`blob5` にまとめる。標本化の割合は `SUM(_sample_interval)` で補う。1 日の行は 5000 までで打ち切り、打ち切ったことは `metric_days` に残して、運営の画面に出す(件数の多い順に残す)。
- 写すのは、同じ日を **置き換える**形にする。その日の行を消してから、読んだ行を足す(1 つの `batch`)。同じ日を 2 回写しても、件数は 2 倍にならない(F40-AC17)。途中で失敗した日は `metric_days` に行が無いので、次の回にもう一度写される。
- cron は毎時の 1 つのまま、`daily('metrics_copy', 20, …)` を 1 行足す(20 時 UTC。日本の朝 5 時)。1 回で、前の日から 7 日前までの、まだ写していない日を古い順に写す。1 日の失敗が、ほかの日を止めない。
- 読み取りのトークンと、アカウントの番号は、設定の値(`ANALYTICS_READ_TOKEN`、`ANALYTICS_ACCOUNT_ID`)。無いときは何もしない(F40-AC23)。binding(`ANALYTICS`)が無いときも、何も書かれていないので、写さない。
- Cloudflare の API への通信は、`analytics-client.ts` だけが行う。テストでは、通信を模擬にして、実際には取りに行かない。

## 週ごとの表(3/3 で作る)

運営の画面の「計測」(第四スコープの指示書の 02-PAGES の 15)。D1 の `metric_daily` と、作者の数だけは D1 の本体の表から出す。

- 週は、月曜に始まる 7 日(UTC の日付で組む)。直近 12 週を既定にし、いまの週(途中)も含める。
- 行は D-72 の並び。測るもの(固定の行)と、出てきたものの上位の行(参照元、ヘルプの語・記事、エラーの経路、道具の名前)に分ける。上位の行は、12 週の合計の多い順に 10 まで。
- 詰まるところは、数と割合を並べる: ログインは「入れられた数 ÷ 送った数」、置くは「終わった数 ÷ 始めた数」。分母が 0 の週は、割合を出さない。
- 公開までの時間は、週の `value_sum ÷ events`(標本化を補った平均)を、分で出す。
- CSV は、画面の表と同じ内容(行の見出しと、週ごとの数。割合の列も)を出す。運営でない人には開かない。
- 「未設定」は、`ANALYTICS` が無いか、`ANALYTICS_READ_TOKEN` か `ANALYTICS_ACCOUNT_ID` が無いときに出す。何を設定すればよいかと、この手順の文書の場所を添える(D-08)。D1 から数えられる行(作者の数)と、写した集計は、設定が無くても出す。

## プライバシーポリシーとの突き合わせ(F40 の 7)

`legal/privacy.md` の記述と、記録するものを突き合わせた。文面は直していない。

| 記録するもの | プライバシーポリシーの記述 | 範囲 |
| --- | --- | --- |
| 出来事の種類、日時、スライドやコミュニティの番号、参照元のホスト名、表示言語 | 第 1 条 2 項の履歴情報(開いたページ、操作、日時、参照元)、第 2 条 3 号、第 3 条 1 項 6 号(使われ方を集計し、改善するため) | 収まる |
| IP アドレス、Cookie、端末とブラウザの種類 | 第 1 条 2 項は挙げるが、計測では記録しない | 記録しないので、ポリシーより狭い |
| メールアドレス、利用者の番号 | 記録しない | 記録しないので、第 3 条 2 項(個人を特定できない形で集計する)に合う |
| ヘルプで 0 件だった検索の語 | 第 2 条 2 号・3 号の「操作」「履歴情報」と読める。語を明示した記述は無い | 収まる(と読める)が、文面にはっきり書くか、依頼者が決める。語が個人を特定しうる形(メールアドレス、IP アドレス、web の住所、鍵のような並び)をしているときは書かない |
| 保存の期間 | 第 8 条 2 項は「履歴情報は (日数) 残す。件数の集計は、その後も残す」 | Analytics Engine は 3 か月で消える。D1 の集計は残る。集計に、参照元のホスト名とヘルプの語が**含まれる**ので、「件数の集計」に入れてよいかを、依頼者が決める(下) |

依頼者に決めてほしいこと:

1. 第 8 条 2 項の「(日数)」。計測の記録の保存は、Analytics Engine で 3 か月。ログの保存期間(作業 M)と合わせて、決める。
2. D1 の日ごとの集計は、日・出来事・区分・参照元のホスト名・言語・画面・件数を、無期限に残す。ヘルプの 0 件の語が、件数とともに残る。第 8 条 2 項の「件数の集計」に当たると読むか、一定の期間で語を消すか。消す場合は、`metric_daily` の `help_search_empty` の行を、期間を過ぎたら消す処理を足す。
3. 第 2 条・第 3 条に、ヘルプの検索の語を書くか。

## 確かめた公式の文書(2026-11-26)

記憶ではなく、2026-11-26 に次のページを読んで確かめた。

| 文書 | 確かめたこと |
| --- | --- |
| [Get started](https://developers.cloudflare.com/analytics/analytics-engine/get-started/) | binding は wrangler の `analytics_engine_datasets` の `binding` と `dataset`。dataset は最初の書き込みで作られる。`writeDataPoint({ blobs, doubles, indexes })`。index は 1 つだけ(複数だと、その行は記録されない)。`await` は要らない。値は位置で読むので、順番を保つ。行ごとに `timestamp` が自動で付く |
| [Limits](https://developers.cloudflare.com/analytics/analytics-engine/limits/) | 1 回の呼び出しで、blob は 20 個、double は 20 個、index は 1 つ(96 バイト以内)。1 行の blob の合計は 16 KB まで。1 回の Worker の呼び出しで書ける行は 250 まで。保存は 3 か月 |
| [Sampling](https://developers.cloudflare.com/analytics/analytics-engine/sampling/) | 各行に `_sample_interval`(標本の割合の逆数)。行ごとに違いうるので、一定の係数は掛けない。件数は `sum(_sample_interval)`、合計は `sum(bytes * _sample_interval)`、平均は両者の割り算、分位数は `quantileExactWeighted`。index の外の項目の異なり数は正確でない。まれな値は見えないことがある。行ごとに一意な index(UUID)は集計を遅くする |
| [SQL API](https://developers.cloudflare.com/analytics/analytics-engine/sql-api/) | `POST https://api.cloudflare.com/client/v4/accounts/<account_id>/analytics_engine/sql`。本文は SQL の文字列。`Authorization: Bearer <token>`。トークンの権限は「Account \| Account Analytics \| Read」 |
| [SQL reference: Statements](https://developers.cloudflare.com/analytics/analytics-engine/sql-reference/statements/) | `FORMAT` は `JSON`(既定)、`JSONEachRow`、`TabSeparated`。JSON の応答は `meta`(列の名前と型)、`data`(行の配列)、`rows`(行の数)。表の名前は binding の dataset の名前。`LIMIT <n>\|ALL`、`OFFSET`。既定の時刻帯は `Etc/UTC` |
| [SQL reference: Date and time functions](https://developers.cloudflare.com/analytics/analytics-engine/sql-reference/date-time-functions/) | `toStartOfInterval`、`toDateTime(<式>[, '時刻帯'])`、`now()`、`formatDateTime`、`toUnixTimestamp` |
| [Querying from a Worker](https://developers.cloudflare.com/analytics/analytics-engine/worker-querying/) | Worker から SQL API を呼ぶ形。トークンは secret、アカウントの番号は変数。`200` が成功。応答の `data` は列の別名をキーにした行の配列 |

文書で確かめられなかったこと(依頼者が、実際の API で最初に 1 度確かめる。[計測の設定の手順](metrics-setup.md)):

- `timestamp` 列の型と、`toDateTime('YYYY-MM-DD hh:mm:ss')` の文字列での時刻の指定が、期待どおりの幅になること。
- `JSON` の応答で、`SUM(_sample_interval)` の値が数か、文字列か。64 ビット整数は、文字列で返る実装がある。応答の解析は、数と、数の形をした文字列の両方を受け取る。
- 問い合わせの行の数、実行時間、呼び出しの頻度の上限。文書のこれらのページに、数値が載っていない。1 日 1 回、1 つの問い合わせなので、通常は問題にならない見込みだが、確かめていない。
- ローカルの `wrangler dev` で、`writeDataPoint` が何も記録しないこと。記録の中身は、書く口を差し替えたテストで確かめた。実際に Analytics Engine へ書かれて、読めることは、本番相当の環境でのみ確かめられる。
