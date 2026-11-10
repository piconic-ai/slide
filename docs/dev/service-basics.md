# サービスの基本の備え

本人以外に開く前に、一般的な Web サービスとして備えるものの実装をまとめる。slide 固有の機能ではなく、よくある既定値を採用する。進み具合は [#47](https://github.com/piconic-ai/slide/issues/47) のチェックリストで管理する。

## セキュリティヘッダーと検索エンジン

管理 origin のすべての応答に、`src/site/middleware.ts` が Hono の `secureHeaders` の既定値を付ける。`X-Frame-Options` だけは `DENY` にした。主なヘッダーは次のとおり。ほかに `Origin-Agent-Cluster`、`X-DNS-Prefetch-Control`、`X-Download-Options`、`X-Permitted-Cross-Domain-Policies`、`X-XSS-Protection: 0` も付く。

| ヘッダー | 値 | 理由 |
| --- | --- | --- |
| `Strict-Transport-Security` | `max-age=15552000; includeSubDomains` | HTTPS 以外で開かせない。preload には登録しない |
| `X-Content-Type-Options` | `nosniff` | 宣言と違う種類として解釈させない |
| `X-Frame-Options` | `DENY` | 管理画面を他のページに埋め込ませない |
| `Referrer-Policy` | `no-referrer` | deck の URL や ID を外部に送らない |
| `Cross-Origin-Opener-Policy` / `Cross-Origin-Resource-Policy` | `same-origin` | 他の origin から window や応答を参照させない |

これらのヘッダーは、handler が同じ名前で付けた値を上書きする。別の値が必要なページは、middleware の設定を変える。`Content-Security-Policy` は対象外で、各ページが自分の内容に合わせて付ける。

トップページ（`/`）・`/robots.txt`・公開中の共有 URL（`/@handle/slug`）の 200 応答と、それを再検証した 304 応答以外には `X-Robots-Tag: noindex, nofollow` を付ける。handler が自分で `X-Robots-Tag` を付けた応答はその値を保つ。`/robots.txt` は `/api/`、`/auth/`、`/decks`、`/uploads/` を disallow にする。robots.txt はクロールを減らすためのもので、検索結果に出さない保証ではない。管理画面が検索に出ないのは、ログインが必要なためである。

content domain の応答は対象外とする。deployment ごとの origin のヘッダーは [公開管理の実装設計](f02-publication.md) で扱う。`public/` の静的ファイルは Worker が先に受け、管理 host でだけ `ASSETS` binding から middleware を通さずに返すため、このヘッダーは付かない。

## リクエスト頻度の上限

`src/site/rate-limit.ts` が、handler が D1・R2 に触れる前に、接続元 IP（`CF-Connecting-IP`）ごとの頻度を Workers の Rate Limiting binding で数える。上限を超えた request には `429` と `Retry-After: 60` を返す。`/api/` は `{ "error", "code": "rate_limited" }` の JSON、それ以外は text で返す。IPv6 の接続元は、アドレス単位ではなく /64 単位で数える。アップロードの CLI は 429 を受けると、`Retry-After` の秒数（最大 120 秒）だけ待ってから再送する。

| 対象 | binding | 1 分あたりの上限 |
| --- | --- | --- |
| `/auth`（ログイン） | `AUTH_RATE_LIMITER` | 30 |
| `/api/uploads` と `POST /api/decks/:deck/uploads` | `UPLOAD_RATE_LIMITER` | 600 |
| それ以外の `/api/` と `/decks` | `MANAGEMENT_RATE_LIMITER` | 120 |
| 共有 URL（`/@handle/slug`） | `VIEWER_RATE_LIMITER` | 600 |
| 版の origin（`d-<ID>.<コンテンツドメイン>`）への全 request | `CONTENT_RATE_LIMITER` | 3000 |

アップロードはファイルごとに 1 request を送るため、最大のファイル数（500）の deployment を 1 分で送れる上限にした。共有 URL と版の origin は、勉強会の参加者が会場の同じ IP から開くため大きくした。版の origin は 1 回の閲覧で資料の全ファイルを読むので、さらに大きい。版の origin の上限は host で選び、D1 で認可する前に数える。超えたら `private, no-store` の `429` を返す。トップページと、そこから最近公開されたスライドを読む `/api/public/` は、共有 URL と同じ上限で数える。`/robots.txt` と `/uploads/:id` の状態確認ページは数えない。

上限は `wrangler.jsonc` の `ratelimits` で変える。binding は Cloudflare の拠点ごとに数えるため、正確な上限ではなく、乱用を止める目安として使う。`CF-Connecting-IP` のない request は、ローカルの開発やテストからのものとみなし、数えない。インターネットから届く request には Cloudflare が必ずこの header を付け、利用者は書き換えられない。将来、Service binding など Worker 間の呼び出しを加える場合は、この扱いを見直す。

## アカウントごとの上限

アップロードの容量・回数と deck 数は、アカウントごとに数える。アカウントは deck の所有者（`decks.owner_user_id`）で、ほかのアカウントの使用量は自分の上限に影響しない。

| 上限 | 既定値 | `UPLOAD_LIMITS` の項目 | 超えたとき |
| --- | --- | --- | --- |
| 保持・予約の容量 | 50 MiB | `authorBytes` | 開始を 409 `author_bytes_exceeded` で拒否 |
| 24 時間のアップロード開始 | 50 回 | `startsPerDay` | 開始を 409 `daily_starts_exceeded` で拒否 |
| 同時アップロード | 1 件 | `activeSessions` | 429 `upload_busy` |
| 拒否の記録 | 24 時間で 20 件 | `refusalsPerDay` | 理由だけを返し、記録しない |
| deck 数 | 20 個 | `decks` | 新しい deck の接続を 409 で拒否 |

容量の既定値は、本人だけが使っていたときの上限をそのまま引き継いだ。開始回数は当初 5 回だったが、1 つの repository に複数の deck を置くと、push のたびに deck の数だけ開始を数える。3 つの deck を持つ見本の repository では、連携の確認とやり直しだけで 1 日の上限に達したため、50 回に上げた。保持できる容量は `authorBytes` で別に抑えているので、回数の上限は送り直しの繰り返しを止める目安として使う。deck 数はこれまで上限がなかったため、一般的な無料枠の目安として 20 個にした。上限に達しても、既存の deck の接続し直し（branch の変更など）はできる。

値は `wrangler.jsonc` の `UPLOAD_LIMITS` で変え、すべてのアカウントに同じ値を使う。特定のアカウントだけ上限を変える設定は、利用者を増やして必要になったときに加える。拒否の応答と記録の詳細は [F01 のアップロード](f01-local-slice.md) にまとめている。

## deck の削除

作者は deck の画面の下にある form から、deck を削除できる。誤操作を防ぐため、deck 名を入力してから送る。削除は 2 段階で進める。

1. **すぐに止める**（`src/decks/deletion.ts` の `markDeckDeleted`）：1 つの transaction で `decks.deleted_at` を記録し、公開と停止中の再開先を外す。あわせて repository の連携、作者限定の閲覧 session と launch を消し、受信中の session を `expired` にする。これで公開中の URL と作者限定の閲覧は 404 になり、アップロードの開始・受信・finalize は連携がないため拒否される。削除と同時に finalize した版も、CI の公開を `deck_deleted` として飛ばす。公開状態の変更・作者限定の launch・履歴の表示も、削除済みの deck には効かない。
2. **後で消す**（`purgeDeletedDecks`、cron）：削除から 24 時間（`purgeDelaySeconds`）を過ぎた deck について、deployment ごとに R2 の object を消してから D1 の行を消す。1 回の実行で消す deployment は 10 件までにし、残りは次の実行に回す。deployment がなくなった deck は、最後に deck の行と連携を消す。途中で失敗した deployment は行を残すため、次の実行でやり直す。

24 時間待つのは二つの理由からである。一つは、削除の前に検査を通った受信が object を書き終えるまでの時間を取るためである（`orphanGraceSeconds` 以上）。もう一つは、アカウントの 24 時間の開始回数と拒否の記録を、deployment の行から数えているためである。行を早く消すと、deck を削除して作り直すことで開始回数の上限を回避できてしまう。待っている間の object は容量にも数え続けるが、deck 数には数えない。同じ deck 名は、消し終えるまで接続し直せない（409）。消し終えた後は、同じ名前で新しい deck を作れる。

受信は lease を確かめてから R2 に書くため、書き込みがいつ終わるかには上限がない。そこで purge は、消した deployment の ID だけを `purged_prefixes` に残す。7 日ごとにその prefix を list し直し、後から届いた object を消す。30 日を過ぎた記録は忘れる。それより遅く届いた object は残るが、受信側の補償削除にも失敗した場合に限られるため、このリスクは受け入れる。

## 退会

作者はデッキ一覧の下にある form から退会できる。誤操作を防ぐため、GitHub のユーザー名を入力してから送る。`markAccountDeleted` が 1 つの transaction で、その作者のすべての deck を deck の削除と同じ手順で止め、作者の Better Auth user・provider account・ログイン session と固定 handle を消す。その後のファイルと記録は、deck の削除と同じ purge が消す。

作者について slide が持つのは、GitHub の ID とユーザー名、Better Auth の内部 ID・署名 cookie に対応する session・数値 ID 由来の noreply email、deck と連携した repository、受領した版とその workflow の記録で、どれも退会の時点か purge で消える。例外は二つある。deck を導入する前の試行で作った deployment は、どの deck にも属さないため消さない。Workers のログは、Cloudflare の保持期間が過ぎるまで残る。ログインは今も許可した本人に限っているので、退会した後にもう一度ログインすると、deck のない状態から始まる。

## 利用規約・プライバシーポリシー・問い合わせ窓口（仮）

`/terms`・`/privacy`・`/contact` に、仮であることを明記したページを置いた。各ページは載せる予定の項目だけを並べ、「ここに書いたことは約束や合意として扱わない」と示す。問い合わせの受付はまだ用意していない。管理 origin のすべてのページ（トップ、受領票、デッキの画面、エラーページ）の下に、この 3 ページへのリンクを付けた。中身は `src/site/legal-pages.ts`、フッターは `src/site/footer.ts` にまとめている。フッターには表示言語の切り替えもある([画面の言語](i18n.md))。

正式な文面は人が決める。決めたら、各ページの中身を差し替え、仮の表示を外す。不正な資料への対応は、通報と強制停止（#45）と合わせて決める。メンテナンス中も読めるように、メンテナンスと頻度の上限より前に置いている。仮のうちは検索エンジンに載せない（`noindex`）。正式な文面にしたら、`isIndexablePath` に加えて検索に載せるかを決める。

## エラーページとメンテナンス

管理 origin のエラーは、`src/site/errors.ts` がまとめて返す。どれも `Cache-Control: no-store` を付ける。

| 状況 | ページ | `/api/` |
| --- | --- | --- |
| 存在しない path | `404`、「ページが見つかりません」 | `{ "error": "Not found", "code": "not_found" }` |
| 想定していない例外 | `500`、「エラーが発生しました」 | `{ "error": "Internal error; retry later", "code": "server_error" }` |
| メンテナンス中 | `503`、「メンテナンス中です」、`Retry-After: 300` | `{ "error": "Under maintenance; retry later", "code": "maintenance" }` |

ページは外部の資源を読み込まず、厳しい CSP を付ける。想定していない例外は、画面には原因を出さず、log に path・例外の名前・先頭 200 文字のメッセージを残す。handler が意図して投げた `HTTPException`（`401` など）は、その応答と、投げる前に付けた header をそのまま返す。deck 固有の 404 や、アップロード API のエラーは、各 route が自分の形で返す。

メンテナンスは、secret `MAINTENANCE` に `on` を入れると始まり、消すと終わる。secret を変えると、Worker の新しい version がすぐに deploy される。build は要らない。ただし、`wrangler versions upload` で上げただけのコードがあれば、それも一緒に出る。段階的な deploy の途中では使えない。

メンテナンス中は、`/robots.txt` 以外の管理画面・API・アップロードと、content domain での配信がすべて `503` を返す。cron の掃除も止まる。D1 を復元するときのように、データに触れさせたくない作業の間に使う。robots.txt を残すのは、5xx を返すと crawler が全体を disallow とみなすため。アップロードの CLI は `Retry-After` を 120 秒までに切り詰めて 5 回まで再送するので、約 8 分待ってから失敗する。確認用 workflow は 10 分で timeout するため、その前に失敗として終わらないことがある。メンテナンスを終えると、アップロードの期限を過ぎた deployment は次の cron で期限切れになる。

```sh
pnpm exec wrangler secret put MAINTENANCE   # 値に on を入力する
pnpm exec wrangler secret delete MAINTENANCE
```

content domain での配信のエラー表示と、存在しない deck と公開停止中の deck を同じ表示にすることは、配信側（F02）で扱う。
