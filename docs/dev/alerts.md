# 通知の実装設計

[運営が異常に気づく](../features/f39-operator-alerts.md)のうち、運営への通知(作業 M)の設計です。バックアップ(作業 B)、メンテナンスの中身(作業 N)、登録の急増とメールの送りすぎの数え方(作業 R)は、ここの口を呼びます。通知が届いたときに何をするかは、[通知の手順](alerts-runbook.md)にあります。

## 方針

- 条件を数えるだけで判断できる通知は、Worker が自分で送る。Cloudflare のアラートに任せるのは、5xx の割合、上限に当たった数、請求額の 3 つだけ(D-07)。
- 通知は 2 段。「すぐ」は Discord の webhook へ送る。「翌日」は D1 にため、1 日 1 回、1 通のメールにまとめる(D-55)。
- 通知の本文は、種類、件数、リンクだけ(D-58)。メールアドレス、IP アドレス、利用者の名前を入れる場所が、型にない。
- 通知を送れなくても、呼んだ側の処理は止まらない。失敗はログに残す。webhook が無い環境では、その機能だけが何もせず、運営の画面に「未設定」と出る(D-08)。

## 通知の一覧

D-56 の行です。「数え方」は、何をどの表(または入力)から数えて、通知にするかです。しきい値は仮で、設定で変えられます([しきい値](#しきい値))。

| 種類(`AlertKind`) | 条件 | 急ぎ | 送る人と数え方 |
| --- | --- | --- | --- |
| `login_mail_failed` | ログインのメールの送信失敗が、1 時間に 3 回 | すぐ | `src/auth/login-routes.ts` が失敗を `alert_signals` に 1 行ずつ残し、直近 1 時間の数がしきい値に達したら通知する |
| `cron_failed` | 処理の失敗 1 回 | 翌日 | `runCronTask`(`src/app/cron-routes.ts`)が、失敗を捕まえたときに処理の名前つきで通知する。同じ処理が 1 日に何回失敗したかが、翌日のメールに入る |
| `luma_feed_stopped` | 止まった配信が 1 つ | 翌日 | 毎日 22 時(UTC)に、`luma_feeds.stopped_at` が直近 1 日のものを数える |
| `report_received` | 通報が 1 件 | 翌日 | 毎日 22 時(UTC)に、`reports.created_at` が直近 1 日のものを数える |
| `d1_size` | 5 GB(上限 10 GB の半分) | 翌日 | 毎日 19 時(UTC)に、D1 の大きさを測り、しきい値を超えていたら、MB 単位の大きさを件数として通知する |
| `backup_failed` | 1 回 | 翌日 | 作業 B が通知の口を呼ぶ |
| `signup_surge`、`mail_flood` | 作業 R | すぐ | 作業 R が通知の口を呼ぶ |
| `maintenance` | 作業 N | すぐ | 見張りの Worker が、`503` のヘッダー `X-Slide-Maintenance` を見て、開始、見込みの超過、終了を Discord に 1 回ずつ送る。サービスは D1 を使えないことがあるので、サービスの口は通らない。文は `watcher/src/watch-text.ts` が持ち、題名は `kindTitle('maintenance', 副種別)` と同じことをテストが確かめる([メンテナンスの実装設計](maintenance.md#見張りの-worker-とのやりとり)) |
| `deploy_check_failed` | 1 回 | すぐ | 作業 D の反映のスクリプトが、Discord の webhook を直接呼ぶ(サービスの Worker の外で動くため) |
| `page_unreachable` | 5 分ごとの確認が 2 回続けて失敗 | すぐ | 見張りの Worker(サービスの Worker ではない。[見張りの Worker](#見張りの-worker)) |

Cloudflare のアラートに任せる 3 つ(5xx の割合、上限に当たった数、請求額)の設定は、[通知の手順](alerts-runbook.md)にあります。

## 通知を送る口

`src/alerts/` にあります。層は[設計の決まり](architecture.md)に従います。

| ファイル | 層 | 役割 |
| --- | --- | --- |
| `notice.ts` | 純粋 | 種類と急ぎ(`ALERT_URGENCY`)、`Notice` の型、`noticeOf`、`cronFailedNotice`。件数は 0 以上の整数、リンクはサービスか文書の道筋(`/operations#alerts`、`docs/dev/…`)か https の住所に限る。リンクは、運営の画面の定数(`OPERATOR_LINKS`)と、種類ごとの手順(`runbookLink`)の一覧に**一致するものだけ**を通す。形を調べるのではなく一覧と照らすので、利用者のハンドルや slug、アドレス、ホスト、`//host`、16 進の IP のような文字列は、どんな形でも通らない。`cron_failed` だけ処理の名前(`^[a-z][a-z0-9]*(_[a-z0-9]+)*$`、40 文字まで)を、`maintenance` だけ副種別(`started`、`ended`、`overrun`)を持つ |
| `notice-text.ts` | 純粋 | 種類ごとの固定の文言、件数の単位、本文の組み立て。出す直前に、本文に `@` と IPv4・IPv6 の形が無いことを確かめ、あれば送らない |
| `thresholds.ts` | 純粋 | `ALERT_THRESHOLDS` の解析 |
| `webhook-url.ts` | 純粋 | secret が Discord の webhook の住所かどうかを確かめる |
| `alert-store.ts` | store | `alerts` 表の読み書き。同じ種類の間引きと記録は 1 つの SQL |
| `discord-client.ts` | client | webhook へ POST する。結果は「送れた」「断られた(状態)」「失敗(時間切れか通信)」だけ |
| `notify-routes.ts` | routes | `notifierOf(env)`。上の部品をつなぐ。決して reject しない |

### webhook の住所の扱い

- `DISCORD_WEBHOOK_URL` は secret。`wrangler.jsonc` にも、ログにも、運営の画面にも出さない。ローカルでは `.dev.vars` ではなく、keychain からの環境変数で入れる。
- 使う前に、https、Discord の host(`discord.com`、`ptb.discord.com`、`canary.discord.com`、`discordapp.com`)、`/api/webhooks/<id>/<token>`(間に `v10` のような版が入ってもよい)の形だけを通す。ポート、ユーザー情報、クエリ、フラグメント、ほかの道筋は通さない。通らない値は「未設定」と同じに扱い、ログには `webhook_invalid` とだけ残す。値は出さない。
- 送るときは redirect を追わない。時間切れは 5 秒。本文は `allowed_mentions: { parse: [] }` で、だれにも通知が飛ばない。`SUPPRESS_EMBEDS` で、リンクの展開もしない。
- 失敗のログは、種類と、状態の番号か理由(`timeout`、`network`)だけ。例外の文面は出さない(通信の例外の文面には、送り先が入ることがあるため)。

## 同じ通知を繰り返さない

「すぐ」の通知は、同じ種類を 1 時間に 1 回まで(D-58)。`maintenance` は副種別(開始、終了、見込みの超過。D-120)ごとに間引く。10:00 の開始の 20 分後の終了は、別の副種別なので送られ、同じ副種別は 1 時間に 1 回になる。`alerts` 表に、送る前に 1 行(`sending`)を足す。足すのは、同じ種類の `sending`、`sent`、`not_configured` の行が直近 1 時間に無いときだけで、確かめることと足すことは 1 つの SQL なので、同時に来た通知のうち 1 つだけが通る。送れたら `sent` にする。Discord が 429 以外の 4xx(削除された、トークンが違う)で断ったら `refused` にし、`sent` と同じに間引きに数える。死んだ webhook に、通知のたびに POST しない(1 時間に 1 回だけ試す)。429、5xx、通信の失敗、時間切れは `failed` にし、間引きに数えない。届いていない通知が次の 1 時間を塞がないため。Worker が送信の途中で止まり、`sending` のまま残った行は、5 分を過ぎたら間引きに数えず、運営の画面では「送信に失敗」として出す。webhook が無いときは、`not_configured` の行を 1 つ足し(これも間引きに数える)、ログに `alert_not_sent` を 1 行残す。

「翌日」の通知は間引かない。毎回 `queued` の行を足し、翌日のメールで、種類ごと(`cron_failed` は処理の名前ごと)に件数を足して 1 行にする。

## 翌日のメール

1 日 1 回、23 時(UTC。日本の朝 8 時)の `dailyTask` で、`queued` の行を 1 通にまとめて、運営の宛先へ送る(D-59)。宛先は `ALERT_MAIL_TO`、無ければお問い合わせの宛先。送る口は、ログインのコードと同じ(`mailerOf`)。`queued` が 0 件の日は送らない。送れたら、メールを作った最後の行までを `mailed` にし、送れなかったら `queued` のまま残して、翌日にまとめて送る。メールの本文は、通知の本文と同じ決まり(種類、件数、リンクだけ)で、組み立てた本文に `@` と IP アドレスの形が無いことを確かめてから送る。

## しきい値

`ALERT_THRESHOLDS`(JSON の var)で変える。どの名前も無くてよく、無い名前は既定になる。読めない値(未知の名前、範囲の外、型の違い)があれば、設定の全部を捨てて既定にする。半分だけ読んで通知が黙るのを避けるため。

| 名前 | 既定 | 意味 |
| --- | --- | --- |
| `loginMailFailures` | 3 | ログインのメールの送信失敗が、この回数に達したら通知する |
| `loginMailWindowSeconds` | 3600 | 上の数える幅(秒)。1 日(失敗を残す期間)まで |
| `d1SizeBytes` | 5000000000 | D1 の大きさ。これを超えたら翌日のメールに入る |
| `throttleSeconds` | 3600 | 「すぐ」の同じ種類の間隔(秒) |

見張りの Worker のしきい値(失敗の回数、確認する URL)は、その Worker の設定にある。

## 持つもの(D1)

| 表 | 何を持つか | migration |
| --- | --- | --- |
| `alerts` | 通知 1 件が 1 行。種類、急ぎ、件数、リンク、処理の名前(`cron_failed` だけ)、時刻、状態(すぐ: `sending`・`sent`・`failed`・`refused`・`not_configured`、翌日: `queued`・`mailed`)、副種別(`maintenance` だけ)。急ぎと状態の組み合わせ、`mailed_at` が `mailed` のときだけあることは、CHECK で守る。30 日を過ぎた(待っていない)行は、翌日のメールの後で消す | `0061_alerts.sql` |
| `alert_signals` | 数えるための出来事。種類と時刻だけ。ログインのメールの送信失敗を数える。1 日を過ぎた行は、書くときに消す。数える窓(`loginMailWindowSeconds`)は、この保存の期間(1 日)を超えて指定できない | `0062_alert_signals.sql` |

どちらも、メールアドレス、IP アドレス、利用者の番号を持たない。

## 翌日のメールが二重に送られうること

メールを送った後、`queued` の行を `mailed` にする更新が失敗すると、行は `queued` のまま残り、翌日に同じ内容がもう一度送られる(1 日 1 回の cron なので、この二重送信は許容する。送れなかったのに `mailed` にして通知を失うより良い)。

## cron のログの形(D-60)

`runCronTask` が、どの処理にも、終わるたびに 1 行足す。

```json
{"event":"cron_task","task":"feeds_read","outcome":"ok","count":3,"ms":412}
```

`outcome` は `ok` か `failed`、`count` は処理が返した数の合計(返さない処理は 0)、`ms` はかかった時間。今ある `event`(処理の名前と `<名前>_error`)は消さず、残す。失敗を捕まえて続ける動きは変わらず、失敗は `cron_failed` の通知(翌日)にもなる。

## D1 の大きさ(D-61)

1 日 1 回(19 時 UTC)、何も変えない問い合わせを 1 つ流し、応答の `meta.size_after`(「問い合わせが終わった後のデータベースの大きさ」)を読む。`PRAGMA page_count` は、D1 の文書の PRAGMA の一覧に無いので使わない。大きさをログ(`{"event":"d1_size","bytes":…}`)に残し、しきい値を超えていたら `d1_size` を翌日の通知にする。文書は `size_after` の単位を書いていない(例の値 16384 は、バイトと合う)ので、最初に 1 度、D1 の「Metrics」の Storage (Bytes) と見比べる([通知の手順](alerts-runbook.md))。

## 見張りの Worker

`watcher/` に、サービスの Worker とは別の設定(`watcher/wrangler.jsonc`)で置く。サービスの Worker のコード(`src/`)を読み込まない。サービスが壊れたときに、一緒に壊れないため。webhook の住所の検査など、小さな処理は重ねて持つ。

- Cron で 5 分ごと(`*/5 * * * *`)に、トップ、viewer、配信 origin の 3 つの住所を取りに行く。住所は設定の var(`WATCH_URLS`)で持つ。https でユーザー情報もポートも無い住所だけを通す。自分の machine で試すときだけ `http://localhost` も通す。テストでは、模擬の応答を使う。
- 前の回までの結果(失敗が何回続いているか、通知したか)は、見張りの Worker 自身の Durable Object(SQLite)に置く。サービスの D1 や KV に置くと、サービスが壊れたときに、見張りも状態を失うため。資源をあらかじめ作る必要がなく、`wrangler deploy` で足りる。
- 失敗は、1 回では知らせない。2 回続けて失敗すると、すぐの通知を送る。戻ったときに、1 回送る(通知をした住所だけ)。同じ住所の「開けません」は 1 時間に 1 回まで。
- 失敗は、通信の失敗、時間切れ(5 秒)、5xx。メンテナンス中は確認を止める。メンテナンス中の見分け方は、応答が `503` で、ヘッダー `X-Slide-Maintenance` があること(`isMaintenanceAnswer`)。メンテナンスの扱いには上限がある(`maintenanceChecksToFail`、既定 72 回。5 分ごとで 6 時間)。確認がメンテナンスに当たったまま上限を超えたら、次の確認からは失敗として数える。メンテナンスは意図して止めるもので、終わる。終わらない、またはヘッダーの誤りが障害を隠すことを、ここで防ぐ。
- **制約**: 見張りは、404 と 3xx も「開いている」とみなす(Worker と D1 が答えているかを見るため、ページがあるかは見ない)。viewer と配信 origin の既定の住所は存在しないページで、404 が返ることが正常である。ページが消えた、リンクが切れた、といったことは、この見張りでは分からない。

## Cloudflare のアラートのためのログの項目(D-62)

条件に使える、決まった形のログを足す。

- `{"event":"http_5xx","origin":"management|content|operator","status":502}`: 5xx で返したとき 1 行。ただし、サービスが意図して返す 503(メンテナンス、ログインが設定されていない)は、ヘッダー `X-Slide-Intended` を付け、`{"event":"http_unavailable","origin":"…"}` として数える。5xx の割合には入らない。
- `{"event":"http_limited","origin":"…","group":"auth|uploads|management|viewer|content|other","status":429}`: 429 で返したとき 1 行。

どちらも IP アドレス、道筋、利用者を持たない。割合の分母は、Workers Logs が自動で残す呼び出しのログを使う。

## 確かめた公式の文書(2026-11-26)

| 文書 | 確かめたこと |
| --- | --- |
| [Workers Logs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/) | `console.log` の JSON の項目が自動で取り出され、検索できる。保存は無料 3 日、有料 7 日(最大)。呼び出しのログは、`invocation_logs = false` にしない限り残る。1 件 256 KB まで |
| [Monitors(旧 Observability のアラート。ベータ)](https://developers.cloudflare.com/notifications/monitors/) | ダッシュボードの「Observability > Alerts > Monitors」(または「Alerts > Monitors」)。しきい値、異常検知、SLO(成功した割合)の 3 つ。SQL API の 1 つのデータセットを読む。webhook は全プランで使える。変更履歴は [2026-10-02](https://developers.cloudflare.com/changelog/post/2026-10-02-monitors/) |
| [SQL API のデータセット](https://developers.cloudflare.com/analytics/sql-api/datasets/) | Workers のログは `logs.workersLogs`(列は、導入の API で確かめる。文書は `timestamp`、`scriptName`、`logType` だけを載せている) |
| [Budget alerts](https://developers.cloudflare.com/billing/manage/budget-alerts/) | 「Manage Account > Billing > Billable Usage > Create budget alert」。従量課金の累計が、しきい値(米ドル)を超えたとき、メールを 1 通送る。従量課金(Pay-as-you-go)のアカウントだけ。使うのを止めない |
| [Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/) | UTC。1 つの Worker に複数の cron を書ける。変更が全体に行き渡るまで最大 15 分。ローカルでは `/cdn-cgi/local/scheduled` で動かせる |
| [D1 の返す値](https://developers.cloudflare.com/d1/worker-api/return-object/) | `meta.size_after` は「問い合わせが成功した後のデータベースの大きさ」。単位は書いていない |
| [D1 の上限](https://developers.cloudflare.com/d1/platform/limits/) | 1 つのデータベースは 10 GB(有料)。増やせない |
| [D1 の SQL 文](https://developers.cloudflare.com/d1/sql-api/sql-statements/) | 使える PRAGMA の一覧に、`page_count` と `page_size` は無い |
| [D1 の指標](https://developers.cloudflare.com/d1/observability/metrics-analytics/) | ダッシュボードの D1、データベース、「Metrics」に Storage (Bytes)。31 日まで |
| [Discord: Execute Webhook](https://docs.discord.com/developers/resources/webhook) | `POST /webhooks/{id}/{token}`、`content` は 2000 文字まで、`allowed_mentions`、`flags`(`SUPPRESS_EMBEDS`)。`wait` を付けないと 204 |

確かめられなかったこと: Observability のアラートの「5xx の割合」を 1 つの条件で書く方法。Monitors の SLO は「悪い出来事の数」と「全部の出来事の数」の 2 つの問い合わせで割合を見るので、これで書ける見込みだが、`logs.workersLogs` の列の名前は文書にない。依頼者が、導入の API で確かめる([通知の手順](alerts-runbook.md))。
