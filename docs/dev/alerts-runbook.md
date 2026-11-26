# 通知の手順

[通知の実装設計](alerts.md)の通知が届いたときに何をするか、依頼者が最初に行う設定、仕組みごとに通知が届くことを確かめる方法、ログの保存期間を確かめる方法をまとめる。通知が届いたら、通知の「手順」の行にある見出しへ進む。

この文書の「確かめる」ことのうち、Cloudflare の画面と実際の Discord・メールが関わるものは、エージェントが確かめていない。依頼者が確かめる(「[確かめた日と、確かめていないこと](#確かめた日と確かめていないこと)」)。

## 目次

- [最初に行う設定](#最初に行う設定): [Discord の webhook](#discord-webhook)、[見張りの Worker](#見張りの-worker-の-deploy)、[Observability のアラート 2 つ](#observability-のアラート-2-つ)、[Budget alerts 9 段](#budget-alerts-9-段)
- [通知ごとの手順](#通知ごとの手順)
- [戻し方](#戻し方): 一つ前の版、メンテナンスの表示、D1 の Time Travel
- [わざと失敗を起こして確かめる](#わざと失敗を起こして確かめる)
- [ログと監査ログの保存期間を確かめる](#ログと監査ログの保存期間を確かめる)

## 最初に行う設定

依頼者が行う。エージェントは Cloudflare の画面、Discord、secret に触れない。

<a id="discord-webhook"></a>

### Discord の webhook

1. Discord で、通知を受けるサーバーのチャンネルを決める(運営の 1 人が見る専用のチャンネルを勧める)。
2. チャンネルの設定、「連携サービス」、「ウェブフック」、「新しいウェブフック」で webhook を作る。「ウェブフック URL をコピー」で、`https://discord.com/api/webhooks/<数字>/<トークン>` の形の URL を取る。この URL を知っている人は、チャンネルに書き込める。Git、チャット、issue に貼らない。
3. 本番の secret に登録する。`wrangler` が値を聞くので、そこへ貼る(コマンドの行には書かない)。

   ```sh
   pnpm exec wrangler secret put DISCORD_WEBHOOK_URL
   pnpm exec wrangler secret put DISCORD_WEBHOOK_URL -c watcher/wrangler.jsonc
   ```

   1 行目はサービスの Worker に、2 行目は見張りの Worker([次の節](#見張りの-worker-の-deploy))に入れる。
4. 翌日のメールを、お問い合わせの宛先とは別の宛先で受けるときだけ、同じ要領で `ALERT_MAIL_TO` を登録する。登録しなければ、お問い合わせの宛先(`contact@slide.community`)へ届く。
5. 確かめる: 運営の画面の「運用」、「通知」の枠から「未設定」の表示が消える。Discord の URL が違う形(`https://discord.com/api/webhooks/…` 以外)だと、値は使われず、枠は「未設定」のままになる。値は枠にも、ログにも出ない。

<a id="discord-webhook-の-url-が記録に残ったとき"></a>

**URL が記録に残るかもしれない。** 通知を送るときの `fetch` の URL には、トークンが入っている。サービスの Worker は `observability.traces.enabled: true` なので、fetch の span の URL の属性(公式の文書の一覧に `url.full`、`url.path` が載っている。2026-11-26 に読んだ)に、トークンが残るかもしれない。残るかは、本番で確かめていない。伏せる設定は、文書に見つからなかった。コードと `wrangler.jsonc` は変えていない。判断は、取り出すための URL と合わせて行う([残るリスク](f35-agent-export.md#残るリスクコードでは直せないもの))。

webhook のトークンが Workers Logs や traces に残ったと分かったら、webhook を作り直す。

1. Discord のチャンネルの設定、「連携サービス」、「ウェブフック」で、その webhook を削除する(削除すると、古い URL は使えなくなる)。
2. 上の 1〜3 のとおり、新しい webhook を作り、`DISCORD_WEBHOOK_URL` を、サービスの Worker と見張りの Worker の両方で入れ替える。
3. 古い URL を貼った場所(チャット、issue、手元のメモ)が無いかを探す。

webhook が無い間、すぐの通知は送られない。通知の記録は残り(枠に「送り先が未設定のため送らず」と出る)、サービスは今までどおり動く。

### 見張りの Worker の deploy

見張りの Worker(`watcher/`)は、サービスの Worker とは別の Worker で、`watcher/wrangler.jsonc` が設定である。サービスが壊れたときに、一緒に壊れないよう、サービスのコードも D1 も R2 も使わない。

1. `watcher/wrangler.jsonc` の `vars.WATCH_URLS` を確かめる。トップ、viewer、配信 origin の 3 つ。既定は、トップは `https://slide.community/`、viewer と配信 origin は存在しないページ(`/@healthcheck/watcher`、`d-healthcheck.slideusercontent.com`)で、404 が返ることで Worker と D1 が答えていることを見る。公開しているスライドの住所に変えてもよい。5xx と、通信の失敗、時間切れだけが失敗で、404 は失敗ではない。
2. 本番の反映の決まり([本番に反映する](deploy.md))に従い、変更を commit して push してから、きれいな checkout で deploy する。

   ```sh
   pnpm exec wrangler deploy -c watcher/wrangler.jsonc
   ```

3. Cron は 5 分ごと(`*/5 * * * *`)。変更が全体に届くまで最大 15 分かかる([Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/)、2026-11-26 に確かめた)。
4. 確かめる: Cloudflare の「Workers & Pages」で `slide-watcher` を開き、「Observability」の「Logs」に、5 分ごとの呼び出しの記録が出る。失敗が無い間は、1 行も `watch_` で始まるログが出ない。
5. しきい値を変えるときは `vars.WATCH_SETTINGS`(`failuresToTell`、`throttleSeconds`、`maintenanceChecksToFail`、`maintenanceOverrunSeconds`、`timeoutMs`)を書く。
6. メンテナンス中の見分け方: サービスが `503` と、ヘッダー `X-Slide-Maintenance`(`on`、または `on;until=<UTC>`)を返すと、見張りはメンテナンスとして扱い、「ページが開けません」を通知しない。ヘッダーの名前は `watcher/src/observe.ts` の `MAINTENANCE_HEADER` と `src/maintenance/switch.ts` の両方に書いてあり、テストが一致を確かめる([メンテナンスの実装設計](maintenance.md))。見張りは、メンテナンスの始まりと終わりを 1 回ずつ、終わる見込みを `maintenanceOverrunSeconds`(既定 1800 秒)過ぎても続いていれば 1 回、Discord に送る。メンテナンスの扱いには上限がある: 確認がメンテナンスに当たったまま `maintenanceChecksToFail`(既定 72 回。5 分ごとなら 6 時間)を超えたら、次の確認からは失敗として数え、2 回続けば「ページが開けません」が届く(終わらないメンテナンスと、ヘッダーの誤りが障害を隠すことを防ぐため)。

見張りの Worker 自体が止まったときは、だれも知らせない。月に 1 度、手順 4 のログが出ていることを見る。

### Observability のアラート 2 つ

5xx の割合と、上限に当たった数は、Cloudflare のアラートに任せる(D-07)。画面は「Observability」、「Alerts」、「Monitors」(ベータ。[Monitors](https://developers.cloudflare.com/notifications/monitors/)、2026-11-26 に確かめた)で、「Create a Monitor」から作る。条件に使うログの項目は、サービスの Worker が次の 1 行を出す(`src/alerts/response-log.ts`)。

| 出す場面 | 行 |
| --- | --- |
| 5xx で返したとき | `{"event":"http_5xx","origin":"management|content|operator","status":502}` |
| 429 で返したとき | `{"event":"http_limited","origin":"…","group":"auth|uploads|management|viewer|content|other","status":429}` |

行には、道筋も、住所も、利用者も入らない。

**確かめられていないこと**: Monitors の SQL が読む Workers のログのデータセットは `logs.workersLogs` で、文書は列の名前のうち `timestamp`、`scriptName`、`logType` しか載せていない。JSON のログの項目(`event`、`origin`)が、どの列から読めるかは、実物で確かめる。

```sh
curl --get "https://api.cloudflare.com/client/v4/analytics/sql/introspection" \
  --header "Authorization: Bearer <API のトークン>" \
  --data-urlencode "account_tag=<アカウントの ID>" \
  --data-urlencode "dataset_name=logs.workersLogs" \
  --data-urlencode "include_columns=true" \
  --data-urlencode "include_attributes=true"
```

(`cf sql datasets` でも一覧が見える。`attributes` の列があれば、`attributes['event']` のように読む。トークンは、このコマンドを打つ間だけのものを作り、終わったら消す。)

1. **5xx の割合**(D-56: 10 分間で 1% を超える、すぐ)
   - 種類: SLO。
   - 「悪い出来事」の問い合わせ: 上の列から、`event` が `http_5xx` で `origin` が `management` または `content` のログの数(`SELECT COUNT(*) AS value FROM logs.workersLogs WHERE …`)。
   - 「全部の出来事」の問い合わせ: 同じデータセットの、同じ `scriptName` の呼び出しのログ(Workers の呼び出しのログ。[Workers Logs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/) は、これを `cf-worker-event` の型と書く)の数。2 つの問い合わせの条件(時間、`scriptName`)をそろえる。
   - SLO の目標: 99(悪い割合が 1% を超えると発火)。短い窓は 10 分、長い窓は 30 分から始める。「最小の件数」に 20 を入れ、通信の少ない夜に 1 件の失敗で発火しないようにする。
   - 送り先: webhook に Discord の webhook を入れる(Discord の webhook の URL を、Monitors の destination にも別に登録する)。または、メール。
2. **上限に当たった数**(D-56: 普段の 10 倍、翌日)
   - 種類: 異常検知。
   - 問い合わせ: `event` が `http_limited` のログの数。グループごとに見たければ `group` で分けた問い合わせを足す。
   - 基準の窓は 24 時間、見る窓は 1 時間、「増えたとき」だけ、感度は初めは中くらいから始める。
   - 送り先: メール。通知を繰り返す間隔は 24 時間(翌日の扱い)。

どちらも、作った後に「プレビュー」で 7 日分を見て、普段の値を確かめる。確かめた値は、この文書の末尾の表に書く。

### Budget alerts 9 段

請求額の通知は、Budget alerts に任せる(D-56)。[Budget alerts](https://developers.cloudflare.com/billing/manage/budget-alerts/)(2026-11-26 に確かめた)は、従量課金(Pay-as-you-go)のアカウントだけで使え、月の累計がしきい値を超えると、メールが 1 通届く。使うのを止めない(止めたいときは、別の「spending limit」を使う)。

1. 「Manage Account」、「Billing」、「Billable Usage」、「Create budget alert」。
2. 次の 9 つを、1 つずつ作る。しきい値は米ドル。名前は `budget-10` のように金額で付ける。

   | 名前 | しきい値(USD) |
   | --- | --- |
   | `budget-10` | 10 |
   | `budget-15` | 15 |
   | `budget-20` | 20 |
   | `budget-25` | 25 |
   | `budget-30` | 30 |
   | `budget-35` | 35 |
   | `budget-40` | 40 |
   | `budget-45` | 45 |
   | `budget-50` | 50 |

3. 送り先のメールは、運営が読むアドレスを入れる(9 つとも同じ)。
4. 請求の周期が変わると数え直される。通知が来たら[請求額の通知](#budget)へ。

## 通知ごとの手順

通知は、Worker が送るもの(Discord、翌日のメール)と、Cloudflare が送るものがある。どれも、**最初に見るもの**、**よくある原因**、**戻し方**の順に書く。戻し方は、[戻し方](#戻し方)の 3 つ(一つ前の版、メンテナンス、D1 の Time Travel)から選ぶ。

通知の本文には、種類と件数と、ここへのリンクしか入らない。利用者の個人の情報は入らないので、利用者を探すときは、運営の画面を使う。

<a id="page-unreachable"></a>

### ページが開けません(見張りの Worker、すぐ)

- 最初に見るもの: 通知の名前(トップ、viewer、配信 origin)。実際にブラウザで開く。Cloudflare の「Workers & Pages」の `slide` の「Observability」で、直近のエラーの行(`unhandled_error`、`http_5xx`)を見る。[Cloudflare のステータス](https://www.cloudflarestatus.com/)も見る。
- よくある原因: 直前の反映の失敗(コードの誤り、migration とコードの食い違い)、D1 か R2 の障害、secret の消去、Cloudflare 側の障害、見張りの Worker に設定した確認先の住所の誤り(1 つの住所だけが通知されるとき)。
- 戻し方: 反映の直後なら、一つ前の版に戻す。D1 が壊れたなら、メンテナンスを表示してから、Time Travel で戻す。開けるようになると、見張りが「ページが開けるようになりました」を 1 回送る。

<a id="login-mail-failed"></a>

### ログインのメールの送信に失敗しています(すぐ)

- 最初に見るもの: 通知の件数(1 時間に 3 回以上)。ログの `login_code_unsent`(名前だけで、アドレスは出ない)。Cloudflare の Email Sending の画面で、送信の状態と、送信元のドメインの認証(SPF・DKIM・DMARC)を見る。
- よくある原因: `MAIL_API_TOKEN` の失効や権限の誤り、送信元のドメインの認証の外れ、Email Sending の上限、Cloudflare 側の障害。
- 戻し方: トークンを作り直して `wrangler secret put MAIL_API_TOKEN`。直前の反映が原因なら、一つ前の版に戻す。直るまで新しい登録を止めたいなら、メンテナンスの表示を使う(ログインの画面ごと止まる)。1 時間に 1 回しか通知されないので、直った後に件数が減るのを、ログで確かめる。

<a id="signup-surge"></a>

### 新しい登録が急に増えています(すぐ。作業 R)

- 最初に見るもの: 運営の画面の「運用」、「新しい登録」の枠の、直近 1 時間と 24 時間の登録の数。
- よくある原因: 招待を開いた直後の通常の増加、ボットによる登録。
- 戻し方: 「新しい登録を止める」を押す(押しても、登録済みの人はログインできる)。

<a id="mail-flood"></a>

### ログインのメールが多く送られています(すぐ。作業 R)

- 最初に見るもの: 運営の画面の「新しい登録」の枠と、Email Sending の送信数。
- よくある原因: ボットによるコードの請求の連打。
- 戻し方: 「新しい登録を止める」。Turnstile の設定(`TURNSTILE_SITE_KEY`、`TURNSTILE_SECRET`)が入っていることを確かめる。

<a id="maintenance"></a>

### メンテナンスの知らせ(すぐ。作業 N)

- 最初に見るもの: 運営の画面の「メンテナンスの予定」の枠(開始、終了の見込み、理由)。この通知は、見張りの Worker が、サービスの `503` のヘッダー(`X-Slide-Maintenance`)を見て送る。D1 を復元している最中にも送れるよう、サービスを通らない(運営の画面の通知の一覧には載らない)。
- よくある原因: 予定したメンテナンスの開始と終了。終わる見込みを過ぎて続いているときは、作業が長引いている。
- 戻し方: 終わるなら `wrangler secret delete MAINTENANCE`。復元の最中なら、[D1 を復元する](deploy.md#d1-を復元する)の手順の最後まで進める。

<a id="deploy-check-failed"></a>

### 反映の後の確認に失敗しました(すぐ。作業 D)

- 最初に見るもの: 反映のスクリプトの出力(どの確認が失敗したか)。同じ時刻に、見張りの Worker からも「ページが開けません」が届いていないか。
- よくある原因: 反映した版の誤り、migration の食い違い。
- 戻し方: 一つ前の版に戻す。migration を含んでいたら、前の版のコードが新しいスキーマで動くかを[本番に反映する](deploy.md#戻す)で確かめてから戻す。

<a id="cron-failed"></a>

### 定期の処理が失敗しました(翌日のメール)

- 最初に見るもの: メールの処理の名前と回数。Cloudflare の「Observability」で、その処理のログの行(`<名前>_error`、`event` が `cron_task` で `outcome` が `failed` の行)を見る。毎時の処理が毎回失敗していれば、回数は 24 近くになる。
- よくある原因: D1 や R2 の一時的な障害(回数が少ない)、直前の反映の誤り(反映の時刻から失敗が続く)、外のサービスの障害(Luma など)。
- 戻し方: 反映の直後から続いているなら、一つ前の版に戻す。D1 そのものが落ちているときは、通知を D1 にためられないため、このメールには載らない。見張りの Worker のトップの通知が頼りになる。

<a id="luma-feed-stopped"></a>

### Luma の配信が止まりました(翌日のメール)

- 最初に見るもの: 運営の画面の「運営」ページの「止まった配信」。止まった理由(`last_failure`)と、止まった日時。
- よくある原因: Luma 側のカレンダーの削除や非公開(`refused`、`http_error`)、Luma の障害や上限(`rate_limited`、`unavailable`)、取得の失敗が 5 回続いたこと。
- 戻し方: Luma のカレンダーが生きているなら、「配信を再開」を押す。次の定期の実行で読まれる。消えたカレンダーは、コミュニティの管理者に、リンクを外すよう伝える。

<a id="d1-size"></a>

### D1 の大きさがしきい値を超えました(翌日のメール)

- 最初に見るもの: メールの MB の数。Cloudflare の「D1」、`slide`、「Metrics」の「Storage (Bytes)」。ログの `d1_size` の行(`bytes`)。上限は 1 つのデータベースで 10 GB で、増やせない([D1 の上限](https://developers.cloudflare.com/d1/platform/limits/)、2026-11-26 に確かめた)。しきい値は 5 GB(上限の半分)。
- よくある原因: 利用者の増加による通常の伸び、`mail_outbox` のように消えるはずの表が消えていない、記録の表の肥大。
- 戻し方: 行の多い表を調べて、不要な行を消す方法を決める(自動では消さない)。10 GB に近づいたら、新しい登録を止め、データベースを分ける設計を別に相談する。`size_after` の単位の確認は、[確かめた日と、確かめていないこと](#確かめた日と確かめていないこと)にある。

<a id="report-received"></a>

### 通報が届きました(翌日のメール)

- 最初に見るもの: 運営の画面の「運営」ページの「通報されたスライド」。理由と、通報した人数。
- よくある原因: 不適切なスライド、権利の侵害の申し立て、嫌がらせの通報。
- 戻し方: [不正なスライドの知らせに対応する](abuse-response.md)に従う。スライドの非表示、アカウントの停止は、運営の画面から行う。

<a id="backup-failed"></a>

### バックアップに失敗しました(翌日のメール。作業 B)

- 最初に見るもの: 運営の画面の「運用」、「バックアップ」の枠の、最後に写した日時と失敗。
- よくある原因: バックアップのバケットの権限や名前の誤り、R2 の障害、1 回で写しきれない量(次の回で続きから進む)。
- 戻し方: 設定を直して、次の回(巡回の途中なら次の時間、でなければ翌日の 18 時 UTC)を待つ。設計は [R2 のバックアップの実装設計](backup.md)。バケットの作り方と、ファイルの戻し方は [R2 をバックアップから戻す](deploy.md#r2-をバックアップから戻す)。失敗が続いても、通知は 20 時間に 1 回である。バックアップのバケットを空にしてしまったときの、記録のやり直しも、その節にある。

<a id="http-5xx"></a>

### 5xx の割合(Cloudflare のアラート、すぐ)

- 最初に見るもの: アラートの `origin`(管理、配信、運営)。「Observability」で `http_5xx` の行の `status` を見る(500 は Worker の誤り、502・503・504 は Cloudflare か下流)。
- よくある原因とは戻し方: 「ページが開けません」と同じ。

<a id="rate-limited"></a>

### 上限に当たった数(Cloudflare のアラート、翌日)

- 最初に見るもの: `http_limited` の行の `group`(どの上限か)と `origin`。
- よくある原因: ボットの連打、1 つの会場からの多数の読者(閲覧と配信の上限は大きい)、1 つの利用者が `wrangler.jsonc` の上限を超える使い方をしたこと。
- 戻し方: 上限の値は `wrangler.jsonc` の `ratelimits` にある。誤検知なら値を上げ、攻撃なら Cloudflare の WAF で対処する(この文書の範囲外)。

<a id="budget"></a>

### 請求額(Budget alerts、翌日)

- 最初に見るもの: 「Billing」、「Billable Usage」で、どの製品が増えたか。
- よくある原因: 通常の伸び、R2 や Workers の呼び出しの急な増加、ボットのアクセス。
- 戻し方: 増えた原因を止める(上限の見直し、登録を止める、メンテナンス)。通知は 9 段で、前の月に 50 ドルを超えたなら、超えた額を見直す。

## 戻し方

どれも本番を変える操作である。依頼者が行うか、許可を得てから行う。詳細は[本番に反映する](deploy.md#戻す)にある。

### 一つ前の版に戻す

Cloudflare の「Workers & Pages」、`slide`、「Deployments」で、戻したい版の「Rollback」。または次のコマンド。直前の版に戻るので、版の ID を渡すと、選んだ版に戻る。

```sh
pnpm exec wrangler rollback
```

戻せるのは直近 100 版までで、30 日を過ぎた版は消えていることがある。D1 の中身は戻らない([Rollbacks](https://developers.cloudflare.com/workers/configuration/versions-and-deployments/rollbacks/)、2026-11-26 に確かめた)。migration を含む反映を戻すときは、前の版のコードが新しいスキーマで動くかを確かめる。

### メンテナンスを表示する

サービスの全ページを 503 にして、読み書きを止める。

```sh
pnpm exec wrangler secret put MAINTENANCE   # 値に on を入力する
pnpm exec wrangler secret delete MAINTENANCE
```

1 行目で始まり、2 行目で終わる。切り替えはすぐ(build は要らない)。[サービスの基本の備え](service-basics.md#エラーページとメンテナンス)にある。作業 N が、予告と終わる見込みの扱いを足す。

### D1 を Time Travel で復元する

過去の任意の時点に戻せる(Workers Paid は 30 日、Free は 7 日。[Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/)、2026-11-26 に確かめた)。**元のデータベースを上書きする**ので、先にメンテナンスを表示する。

```sh
pnpm exec wrangler d1 time-travel info slide
pnpm exec wrangler d1 time-travel info slide --timestamp="2026-11-26T03:00:00+00:00"
pnpm exec wrangler d1 time-travel restore slide --timestamp=<UNIX の秒>
```

復元は、戻す前の bookmark を返す。間違えたら、その bookmark を `--bookmark=` に渡して元に戻せる。復元の前後の手順(メンテナンス、migration、版の戻し)は、[D1 を復元する](deploy.md#d1-を復元する)にある。

## わざと失敗を起こして確かめる

通知の仕組みごとに、一度、わざと失敗を起こして、通知が届くことを確かめる。確かめるのは依頼者である。**ローカルで、実際の Discord のテスト用チャンネルとローカルの D1 で行うのを基本にする。** 本番の設定と secret は書き換えない(書き換えると deploy になり、deploy は[本番に反映する](deploy.md)の決まり、つまり commit と push の後に、きれいな checkout の push 済みの commit から行うことになる)。本番で確かめたいものは、別の Worker を使う手順にしてある。

準備(ローカル):

1. `pnpm dev` で起動する。ローカルの D1 に migration を適用する(`pnpm exec wrangler d1 migrations apply slide --local`)。
2. テスト用のチャンネルで webhook を作り、環境変数 `DISCORD_WEBHOOK_URL` に入れて起動する(`.dev.vars` に書かない)。メールは `MAIL_OUTBOX=on` で、`mail_outbox` の表に書かれる(`wrangler d1 execute slide --local --command "SELECT subject, body FROM mail_outbox"`)。
3. 時刻つきで Cron を動かす: `curl "http://localhost:8787/cdn-cgi/local/scheduled?cron=17+23+*+*+*&time=<時刻>"`。`time` で動かす時刻を指定できる(形式は [Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/) の「ローカルでの確かめ方」に従う。この手順は、エージェントが実際に動かして確かめていない)。その時刻の時(UTC)で、毎時の処理に加え、その時の日次の処理が動く(19 時 D1 の大きさ、22 時 通報と配信の数え上げ、23 時 翌日のメール)。

| 仕組み | わざと起こす | 届くことの確認 |
| --- | --- | --- |
| ログインのメール(すぐ) | ローカルで `MAIL_API_TOKEN` に誤った値、`MAIL_ACCOUNT_ID`、`MAIL_FROM` を入れ(Turnstile も入れる)、招待したアドレスで 3 回ログインのコードを求める。ローカルで行う(本番のログインは止めない) | 3 回目に Discord に 1 件届く。4 回目、5 回目は届かない。本文にアドレスがない。運営の画面の「通知」の枠に「Discord に送信済み」 |
| cron の失敗(翌日) | ローカルの D1 で `ALTER TABLE luma_feeds RENAME TO luma_feeds_off` を実行し、Cron を 2 回動かす(`feeds_read` が失敗する)。確認の後で `ALTER TABLE luma_feeds_off RENAME TO luma_feeds` に戻す | 23 時の実行の後、`mail_outbox` に 1 通あり、「定期の処理が失敗しました(feeds_read): 2 回」がある |
| 通報(翌日) | ローカルで、ほかの利用者のスライドを通報する(`verify-slide` の流れ) | 22 時と 23 時の実行の後、メールに「通報が届きました: 1 件」と、運営の画面へのリンク |
| Luma の配信の停止(翌日) | ローカルの D1 で、`luma_feeds` の行の `stopped_at` を現在の時刻に、`last_failure` を `network` にする | 同上、「Luma の配信が止まりました: 1 件」 |
| D1 の大きさ(翌日) | ローカルで `ALERT_THRESHOLDS` に `{"d1SizeBytes": 1}` を入れ、19 時の実行の後に 23 時の実行 | ログの `d1_size` の行に `bytes`。メールに「D1 の大きさがしきい値を超えました: N MB」 |
| 知らせることがない日(翌日) | 上のどれも起こさずに、23 時の実行 | `mail_outbox` に、新しい行が増えない |
| 見張りの Worker(すぐ) | ローカルで `pnpm exec wrangler dev -c watcher/wrangler.jsonc --test-scheduled` を、`DISCORD_WEBHOOK_URL`、`WATCH_URLS`(`http://localhost` の住所だけ使える)を指定して起動し、`/cdn-cgi/local/scheduled` を 2 回呼ぶ。確認先を、止めたローカルの Worker にして失敗させる。本番の見張りの設定は書き換えない。本番で届くことを確かめるときは、別の Worker `slide-watcher-check`(`watcher/wrangler.check.jsonc`。開けない住所だけを見る)を使う。変更を commit して push した後、きれいな checkout の push 済みの commit で、`pnpm exec wrangler secret put DISCORD_WEBHOOK_URL -c watcher/wrangler.check.jsonc`(テスト用チャンネルの webhook)と `pnpm exec wrangler deploy -c watcher/wrangler.check.jsonc` を行い、10 分待つ。済んだら `pnpm exec wrangler delete --name slide-watcher-check` で消す | ローカル: 1 回目は届かない。2 回目に Discord に「ページが開けません」。確認先を戻して呼ぶと「ページが開けるようになりました」が 1 回。`slide-watcher-check`: 10 分のうちに、3 つの住所それぞれの「ページが開けません」が届く(戻りの通知は、消す前に届かなくてよい) |
| webhook が未設定(すぐ) | `DISCORD_WEBHOOK_URL` を入れずに、ログインのメールの失敗を 3 回 | 通知は送られず、ログに `alert_not_sent` が 1 行。運営の画面に「未設定」。ログインの画面は今までどおり |
| 5xx の割合のアラート | Monitors の画面で、作ったアラートの目標を一時的に 100% にする(または件数のしきい値を 0 にする)。通常のアクセスが少しでもあれば発火する。確認後に元に戻す | 送り先に通知が届く |
| 上限に当たった数のアラート | 異常検知の感度を一時的に最大にするか、しきい値の型のアラートを一時的に作って 0 件を超えるとする | 送り先にメールが届く |
| Budget alerts | 一時的に、いまの月の累計より低い額(例: 0.01 ドル)の通知を作る | メールが 1 通届く。確認後に消す |

確かめたら、[確かめた日と、確かめていないこと](#確かめた日と確かめていないこと)の表に日付を書く。

## ログと監査ログの保存期間を確かめる

漏えいしたときの対応の手順は、ここには書かない(D-64)。ここは、記録がどれだけ残るかを確かめるための手順で、結果はプライバシーポリシーの履歴情報の `(日数)`(第四スコープの指示書の `legal/`)を決める材料になる。`legal/` の文面は、エージェントが書き換えない。

### Workers のログ(`slide`、`slide-watcher`)

1. `wrangler.jsonc` で `observability.enabled` が `true`(サービスの Worker。確認済み)であること。見張りの Worker の `watcher/wrangler.jsonc` も同じ。
2. 文書が書く保存期間(2026-11-26 に確認): 無料のプランは 3 日、有料のプランは 7 日で、7 日が最大。[Workers Logs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/)。
3. 実際に確かめる: Cloudflare の「Workers & Pages」、`slide`、「Observability」で、表示する期間を最大にし、いちばん古いログの日時を見る。契約のプラン(Workers Paid か Free)は、「Manage Account」、「Billing」で見る。
4. ログに入るのは、呼び出しの記録(道筋、状態)と、サービスが出した JSON の行。メールアドレス、IP アドレス、利用者の名前は、行に入れない決まり(通知の本文、`http_5xx`、`http_limited`、`cron_task`、`d1_size`)。呼び出しの記録そのものに、Cloudflare が付ける項目(道筋、国など)が入る。何が入るかは、「Observability」で 1 件を開いて確かめる。

### Cloudflare の監査ログ(アカウントの操作の記録)

1. 場所: 「Manage Account」、「Audit Logs」。
2. 文書が書く保存期間(2026-11-26 に確認): 18 か月。画面で引けるのは直近 90 日で、それより前は API か Logpush で引く。[Audit logs](https://developers.cloudflare.com/fundamentals/account/account-security/audit-logs/)。
3. 実際に確かめる: 画面で、直近 90 日の記録が出ること。API(`GET /accounts/{account_id}/logs/audit`、`since` と `before` が要る)で、90 日より前の記録が引けること。

### 確かめた日と、確かめていないこと

エージェントは Cloudflare の画面に入れないので、次は依頼者が埋める。「文書の値」は 2026-11-26 に文書で確かめた値で、「画面で確かめた値」と「日」は依頼者が書く。

| 項目 | 文書の値 | 画面で確かめた値 | 日 |
| --- | --- | --- | --- |
| Workers のログの保存期間(`slide`) | 3 日(Free)、7 日(Paid) | | |
| Workers のログの保存期間(`slide-watcher`) | 同上 | | |
| 契約のプラン | | | |
| 監査ログの保存期間 | 18 か月(画面は 90 日) | | |
| D1 の `size_after` が MB でなく、バイトであること(`d1_size` のログの `bytes` と、D1 の「Metrics」の Storage (Bytes) を見比べる) | 単位は文書にない | | |
| 5xx の割合の SLO に使う `logs.workersLogs` の列の名前 | 文書は `timestamp`、`scriptName`、`logType` だけ | | |
| 5xx の割合のアラートの普段の値(7 日のプレビュー) | | | |
| 上限に当たった数のアラートの普段の値 | | | |
| Discord に通知が届く(ログインのメール) | | | |
| 翌日のメールが届く(cron の失敗) | | | |
| 見張りの Worker の通知が届く | | | |
| Budget alerts が 9 つある | | | |

プライバシーポリシーの `(日数)` を決める材料として、依頼者は、上の「Workers のログの保存期間」の行と、「監査ログの保存期間」の行を、報告に写す。履歴情報の日数は、実際に残る期間の上限に合わせる(`legal/OPEN-ITEMS.md`)。
