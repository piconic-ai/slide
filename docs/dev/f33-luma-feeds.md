# Luma の配信の実装設計

[Luma の配信でコミュニティに紐づける](../features/f33-luma-feeds.md) を実装するための契約。ここでは、取得の流れ、間隔と上限の守り方、記録の表、失敗の扱い、模擬配信、運営の画面を扱う。コミュニティの側(紐づけ用リンク、`community_feed_events`)は [コミュニティの実装設計](f30-communities.md) にある。

## Luma の規約との関係

サービスが外へ取りに行くのは、Luma のカレンダーの「iCal で購読」の配信だけである(D-02)。Luma の利用規約は、Luma が用意した公開の手段以外の方法で、自動でサービスにアクセスすることを禁じている。iCal の購読は、カレンダーの持ち主が公開し、カレンダーのアプリが読むための公開の機能なので、その範囲で使う。カレンダーのアプリと同じ程度の頻度(1 日 1 回、同じ配信は 1 時間に 1 回まで)で、条件付きの取得を使い、名乗った User-Agent とそのヘルプのページで、何をなぜ読むかを明かす。Luma のページ、API、カレンダーのページからの番号の割り出しには、アクセスしない。規約の文言そのものの確認は、依頼者が行う(人の確認)。

## ファイル

| ファイル | 層 | 役割 |
| --- | --- | --- |
| `src/feeds/limits.ts` | 純粋 | 間隔、上限、User-Agent などの決まった値 |
| `src/feeds/luma-url.ts` | 純粋 | 取りに行ける唯一の URL の検査(D-67) |
| `src/feeds/feed-answer.ts` | 純粋 | 要求の見出し、応答の状態の意味、失敗の種類 |
| `src/feeds/ical.ts` | 純粋 | iCal から Luma のイベントの鍵だけを取り出す |
| `src/feeds/luma-client.ts` | client | Luma へ取りに行く唯一の関数 `readLumaFeed` |
| `src/feeds/schedule.ts` | 純粋 | 読んだ結果から次の記録を決める。`Retry-After` の解析 |
| `src/feeds/store.ts` | store | 記録の表と門の読み書き |
| `src/feeds/reader-routes.ts` | routes | 門を取り、読み、記録し、コミュニティに入れる流れ。定期の実行と前倒しの入口 |
| `src/feeds/feed-mode.ts` | 純粋 | 設定から、取得の先(Luma、模擬配信、なし)を決める |
| `src/feeds/mock-feed.ts`、`src/feeds/mock-routes.ts` | 純粋、routes | 模擬配信 |
| `src/feeds/operator-page.ts`、`src/feeds/operator-routes.ts` | pages、routes | 運営の画面の「止まった配信」 |

## 取得の口

Luma への取得は、`src/feeds/luma-client.ts` の `readLumaFeed(url, validators, transport)` だけが行う。ソースの中で `fetch(` を書くのは、この 1 か所(`lumaTransport`)である。`src/feeds/one-fetch.test.ts` が、ソースの中で `api.lu.ma` を含むファイルと、`fetch` を呼ぶファイルを突き合わせて、これを確かめる(F33-AC17)。

`readLumaFeed` は、どの経路で呼ばれても、次を必ず通す。

1. **URL の検査(D-67)。** `lumaFeedTarget` が、`https://api.lu.ma/ics/get?entity=calendar&id=cal-…` の形を、サービスが書く綴りそのままで受け付ける。ホスト、ポート、利用者名、パス、クエリの名前と数、フラグメントを固定で比べる。違えば、何も送らずに `refused` で失敗する。紐づけ用リンクの検査(`checkCommunityLink`)と同じ形だが、取りに行く直前にもう一度、独立に確かめる。
2. **見出し(D-64、D-66)。** User-Agent は `slide.community-bot/1.0 (+https://slide.community/help/bot)`。前の応答の `ETag` と `Last-Modified` があれば、`If-None-Match` と `If-Modified-Since` を付ける。cookie や認可の見出しは付けない。
3. **リダイレクトを追わない(D-67)。** `redirect: 'manual'` で送り、3xx はすべて `redirect` の失敗にする。
4. **大きさと待ち時間(D-64)。** `Content-Length` が 2 MB を超えれば読まずに打ち切る。本文は流れのまま数え、2 MB を超えたところで読むのをやめる(`too_large`)。要求から本文の最後までを 10 秒で打ち切る(`timeout`)。打ち切りは、送り手が中断の合図を無視しても効く。

戻り値は判別可能な union(`FeedAnswer`)で、例外を投げない。

| 種類 | 内容 |
| --- | --- |
| `full` | 200。本文と、記録する `ETag`・`Last-Modified`(長すぎるものは記録しない) |
| `not_modified` | 304。送った値を保つ(応答が新しい値を名乗れば、それにする) |
| `failed` | `refused`、`redirect`、`http_error`、`rate_limited`(429)、`unavailable`(503)、`too_large`、`timeout`、`network`、`not_calendar`(と、読み始めに仮に書く `interrupted`)。429 と 503 は `Retry-After` を添える |

送り手(`transport`)は、本番では Workers の `fetch`、ローカルの起動では模擬配信、テストでは差し替えたものである。送り手を替えても、検査と打ち切りは `readLumaFeed` の中で行う。

## 読む

`lumaEventKeys`(`src/feeds/ical.ts`)が、iCal(RFC 5545)の折り返しを戻し、`VEVENT` の中の `URL` の行と、`DESCRIPTION` の中の URL を読む(D-69)。どちらが Luma の実物の位置かは決まっていないので、両方を読む。読んだ URL を `eventRefOf`(D-22)でそろえ、Luma のイベントの鍵だけを返す。イベント名、日時、場所は返さない(D-60)。1 つの配信から読む鍵は 2000 個までにする。

返した鍵は、作業 C の `addFeedEvents(db, { linkId, keys, now })` で、そのコミュニティに入れる。配信から消えた鍵は外さない(D-68)。

本文が `BEGIN:VCALENDAR` で始まらないときは、`not_calendar` の失敗にする。

## 記録の表

migration `0053_luma_feeds.sql`。

| 表 | 列 | 内容 |
| --- | --- | --- |
| `luma_feeds` | `url`(主キー)、`read_at`、`not_before`、`due_at`、`retry_until`、`etag`、`last_modified`、`failures`、`last_failure`、`stopped_at` | 配信ごとの記録。時刻は秒 |
| `luma_feed_gate` | `id`(1 だけ)、`busy_until`、`next_start_at` | Luma への取得の門。時刻はミリ秒 |

`luma_feeds` は、紐づけ用リンクの行ではなく、配信の URL を鍵にする。リンクを外して足し直しても同じ配信として扱い、1 時間に 1 回の決まりを外さない。外部キーを持たないので、作業 C がリンクを消すときに、この表を気にしなくてよい。配信の中身の列は持たない(D-60)。

| 列 | 意味 |
| --- | --- |
| `read_at` | 最後に取りに行った日時。まだなら NULL |
| `not_before` | これより前には取りに行かない(1 時間の間隔、失敗の後の待ち、`Retry-After`) |
| `due_at` | 次に読む予定の日時。読んだ 1 日の 10 分前。前倒しの依頼でいまにする |
| `retry_until` | 429・503 の `Retry-After` が示した日時 |
| `etag`、`last_modified` | 前の 200 の応答の値 |
| `failures` | 続けて失敗した回数 |
| `last_failure` | 最後の失敗の種類 |
| `stopped_at` | 5 回続けて失敗して止まった日時。運営が再開するまで読まない |

## 間隔と上限

- **1 日 1 回(D-61)。** 読み終えると `due_at` を、取りに行った 1 日後の 10 分前にする。毎時の実行の開始は数分ずれるので、ちょうど 1 日後にすると、ときどき次の回を待って 25 時間あく。定期の実行は、`due_at` を過ぎた配信を、古い順に読む。
- **同じ配信は 1 時間に 1 回まで(D-62)。** 取りに行く前に、`not_before` を過ぎていることを確かめ、同じ文で `read_at` をいまに、`not_before` を 1 時間後にする。前倒しの依頼は `due_at` をいまにするだけで、`not_before` を動かさない。何度依頼しても、1 時間以内に 2 回は取りに行かない。
- **同時に 1 本、1 分に 10 本まで(D-63)。** 取りに行く前に、`luma_feed_gate` の 1 行を 1 つの UPDATE で取る。`busy_until` が過ぎていて、`next_start_at` が過ぎているときだけ取れる。取ると `busy_until` を 30 秒後(打ち切りの 10 秒より長い)に、`next_start_at` を 6 秒後にする。終わったら `busy_until` を戻す。始まりの間が必ず 6 秒あくので、どの 1 分にも 10 本を超えない。読む人が途中で落ちても、30 秒で門は開く。定期の実行と前倒しの依頼は、別の isolate で同時に動きうるが、門は D1 の 1 行なので、1 か所で守られる。

## 失敗

失敗すると、`failures` を 1 足し、すぐにはやり直さない(D-65)。

- 次に読んでよい日時は、1 時間 × 2^(失敗の回数 - 1)、上限 1 日。1 回目は 1 時間後、2 回目は 2 時間後、4 回目は 8 時間後。
- 429 と 503 に `Retry-After`(秒数か HTTP の日付)があれば、その日時と比べて遅い方にし、`retry_until` にも記録する。ただし 7 日より先を示すものは待たず、ふつうの失敗の 1 回として数える(運営に見えないまま何年も止まらないように。第三スコープの進行役の決め)。
- **途中で終わった読み取り。** 門を取って配信を確保するとき、同じ文で、`interrupted` で失敗したものとしての記録(回数を 1 足し、次の日時を進めたもの)を先に書く。読み終えたら本当の結果で書き直す。Worker が CPU の上限などで打ち切られても、失敗に数えられ、その配信が次の実行でいちばん先に選ばれ続けることはない。
- **検証子を付けない取得。** そのリンクの配信からまだ 1 件もイベントが入っていないときは、`If-None-Match` と `If-Modified-Since` を付けない。紐づけ用リンクを外して付け直すと、リンクの行は新しくなるが記録は URL で残るので、古い検証子で 304 が返り続けて、イベントが入らなくなるのを防ぐ。
- 5 回続けて失敗すると、`stopped_at` を記録して止まる。止まった配信は、定期の実行でも前倒しの依頼でも読まない。
- 成功(200 か 304)すると、`failures` を 0 にする。

## 定期の実行と前倒し

- **定期の実行(F33-AC14)。** すでにある毎時の Cron Trigger(`wrangler.jsonc` の `17 * * * *`)の中で、`due_at` を過ぎた配信を古い順に、1 回の実行で 60 本まで読む。6 秒おきなので、60 本で 6 分である。各配信の `due_at` は読んだ 1 日の少し前なので、どの配信も 1 日 1 回読まれる。カレンダーが 60 × 24 を超えるまでは、1 日のうちに読み終わる。`wrangler.jsonc` は変えない。
- **紐づけ用リンクを足したとき(F33-AC2)。** コミュニティを作ったとき、編集で紐づけ用リンクを保存したときに、そのとき足された Luma のリンクの記録の `due_at` をいまにし、応答の後(`waitUntil`)に読む。1 時間以内に読んでいれば、`not_before` が止めるので、読まずに次の定期の実行を待つ。
- **どのカレンダーにも無い Luma のイベントのリンクが保存されたとき(F33-AC3)。** 関連リンクを足したとき、種類を「イベント」に変えたときに、その鍵が `community_feed_events` に無ければ、止まっていない全部の配信の `due_at` をいまにし、応答の後に読む。
- 応答の後に読むのは、数本まで(`waitUntil` の時間の内)。依頼した配信を、ほかの読み残しより先に読む。門が開くのを待つのは 1 回 7 秒までで、読めなかった配信は `due_at` を過ぎたまま残り、次の定期の実行で読まれる。

## 模擬配信

テストと通しの確認では、Luma に取りに行かない(D-69)。ローカルの起動でだけ、固定の iCal を返す模擬配信を使う。

- **有効になる条件(F33-AC15)。** 設定 `LUMA_FEED_MOCK` が `on` で、かつ `PUBLIC_ORIGIN` のホストが `localhost` か `127.0.0.1` のときだけ。`wrangler.jsonc` には `LUMA_FEED_MOCK` を書かない。本番で設定してはいけない(設定しても、`PUBLIC_ORIGIN` が `https://slide.community` なので効かない)。`src/feeds/mock-config.test.ts` が、`wrangler.jsonc` にこの値が無いこと、本番の値では経路も送り手も無いことを確かめる。
- **Luma へ取りに行く条件。** `PUBLIC_ORIGIN` が `https://slide.community` で、`LUMA_FEED_MOCK` が無いときだけ(`feedModeOf`)。テスト(`https://slide.example`)や、模擬配信を有効にしていないローカルの起動では、記録の `due_at` は動くが、どこへも取りに行かない。
- **送り手。** 有効なとき、`readLumaFeed` の送り手を、同じ Worker の中の模擬配信の app に替える。外への通信は起きない。検査と打ち切りは、本番と同じく `readLumaFeed` が行うので、模擬配信にも `https://api.lu.ma/ics/get?...` の形の URL で取りに行く。
- **経路。** 有効なとき、`/__mock/luma/ics/get?entity=calendar&id=cal-…` が同じ応答を返す(curl での確認用)。無効なら 404。
- **応答の選び方。** カレンダーの番号(問い合わせの `id`)で選ぶ。

  | `id` | 応答 |
  | --- | --- |
  | `cal-mockSlow` | 11 秒待ってから 200 |
  | `cal-mockLarge` | 2 MB を 1 バイト超える 200(長さを名乗らない) |
  | `cal-mock429` | 429、`Retry-After: 7200` |
  | `cal-mock503` | 503、`Retry-After: 3600` |
  | `cal-mock500` | 500 |
  | `cal-mockRedirect` | 302、`Location: https://example.com/` |
  | `cal-mockHtml` | 200 の HTML |
  | ほか | 200 の固定の iCal と `ETag`・`Last-Modified`。`If-None-Match` か `If-Modified-Since` が付けば 304 |

- 固定の iCal は、`URL` の行に `https://lu.ma/slide-mock-one`、`DESCRIPTION` の中に `https://luma.com/slide-mock-two` を持つ。イベント名と日時も入れてあり、それが保存されないことを確かめるのに使う。
- 模擬配信は、届いた要求の User-Agent、`If-None-Match`、`If-Modified-Since` を、`luma_mock_request` としてログに出す。間隔と条件付きの取得の根拠に使う。

## 運営の画面

運営の画面(`src/operator/`)の、コミュニティの節の後ろに「止まった配信」の節を置く(F33-AC9)。止まった配信ごとに、配信の URL、それを持つコミュニティのハンドル、止まった日時、止まった理由(最後の失敗の種類)、続けて失敗した回数と、「再開する」のボタンを出す。配信の中身は出さない(D-60)。

「再開する」(`POST /feeds/resume`、ほかの操作と同じく同じ origin からの要求だけ)は、`failures` を 0 に、`stopped_at` と `last_failure` を NULL に、`due_at` をいまにし、`retry_until` も消す(運営が判断したため)。`not_before` は、最後に取りに行った 1 時間後より前にはしない。

## 確かめ方

| 受け入れ条件 | テスト |
| --- | --- |
| F33-AC5、F33-AC6、F33-AC7、F33-AC10、F33-AC11 | `src/feeds/feed-answer.pure.test.ts`、`src/feeds/luma-url.pure.test.ts`、`src/feeds/luma-client.test.ts`(送り手を差し替え、時刻を進める) |
| F33-AC12、F33-AC16 | `src/feeds/ical.pure.test.ts`、`src/db/luma-feeds-migration.test.ts` |
| F33-AC17 | `src/feeds/one-fetch.test.ts` |
| F33-AC1、F33-AC3、F33-AC4、F33-AC7、F33-AC8、F33-AC9、F33-AC13 | `src/feeds/schedule.pure.test.ts`、`src/feeds/reader.test.ts`(ローカルの D1、時刻と送り手を差し替える) |
| F33-AC2、F33-AC3、F33-AC14 | `src/feeds/early.test.ts`、`src/feeds/cron.test.ts` |
| F33-AC15 | `src/feeds/feed-mode.pure.test.ts`、`src/feeds/mock-feed.pure.test.ts`、`src/feeds/mock-config.test.ts` |
| F33-AC9(画面) | `src/feeds/operator.test.ts` |

Luma の実物の配信の形と応答(イベントの URL の位置、`ETag` の有無、`Retry-After` の形)は、ローカルでは確かめられない。依頼者が実物の配信 1 つで確かめる(人の確認)。
