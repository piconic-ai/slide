# 第四スコープの統合の記録

第四スコープ(規約のページ、画面からの書き出し、ヘルプの記事、通知と監視、デプロイの流れ、メールアドレスの暗号化、計測、AI エージェントからの書き出し、バックアップ、メンテナンス、一度開いたスライドを手元に残す、招待制をやめる準備、スケールとコスト)を、統合ブランチ `scope4` に集めたあとに、つないだ状態で食い違いがないかを確かめた結果を記録する。このうちメールアドレスの暗号化(作業 C)は、点検のあと、依頼者の判断で仕組みごと外した(下の「[作業 C は、依頼者の判断で仕組みごと外した](#作業-c-は依頼者の判断で仕組みごと外した)」)。この文書の表と手順は、外したあとの状態に直してある。点検は作業 Z の「そろえる」で、`scope4` の `c3d4f7a5`(作業 H2 の最後の PR #594 の取り込み)に対して行った。通しの確認とスクリーンショットは、`scope4` から `main` への PR で扱う。

点検のうち、機械で確かめられるものはテストに残した。ローカルでは、マシンの負荷のため、全件とカバレッジは測らず、変更に関わるテストファイルを 1 つずつ動かした。全件とカバレッジは CI で確かめる。

| 点検 | 残したテスト |
| --- | --- |
| migration が足すだけで、第三スコープの最後(0058)のデータが残り、番号に隙間がない | `src/db/scope4-migrations.test.ts`、`src/db/migration-numbers.test.ts`、`src/db/destructive-migrations.test.ts` |
| 新しい経路が、既存の経路やハンドルのページに隠れない。予約語の一覧と経路の一覧が一致する | `src/app/scope4-routes.test.ts`、`src/auth/handle-rules.test.ts` |
| 外への通信が決まった行き先だけ | `src/app/outbound-fetch.test.ts` |
| 足した binding、secret、vars を全部外しても、第三スコープと同じに動く | `src/app/scope4-unset.test.ts`、`src/env-optional.pure.test.ts` |
| 通知の種類が D-56 の表と一致し、本文に個人の情報が入らない | `src/alerts/notice.pure.test.ts`、`src/alerts/notice-text.pure.test.ts`、`src/alerts/digest-text.pure.test.ts` |
| メールアドレスが、ページ、書き出し、計測、ログ、通知、運営の画面に出ない。読む場所と出る場所が宣言のとおり(F43) | `src/site/no-email-leak.test.ts`、`scripts/email-exposure.test.mjs`(読む場所、列、GET の経路の宣言) |
| cron の処理の一覧とログの形、メンテナンス中は全部止まる | `src/app/cron-routes.test.ts`、`src/app/cron-events.test.ts` |
| 新しい画面が日本語と英語の両方で出る | `src/app/scope4-routes.test.ts` |
| 規約の文面の写しが `legal/` と同じ | `src/legal/` のテストと、下の `diff` |

## 並列の作業と取り込みの順

作業は、`scope4` から worktree を切って並列に進め、1 本ずつ `scope4` に取り込んだ。受け入れ条件は仕様(`docs/features/`)、デプロイの確かめる条件は `REL-AC`([リリースの流れの設計](release-flow.md))、スケールとコストは `COST-AC`([スケールとコストの設計](scale-cost.md))である。

| 作業 | PR | 作業票 | 満たしたもの |
| --- | --- | --- | --- |
| P0 仕様 | #504 | | f34〜f42 を新設、F23、F28 ほかを更新 |
| P1 置き場 | #511 | #505 | 運営の枠、cron の登録、通知の型、`env.d.ts`、「未設定」の部品 |
| T 規約のページ | #535、#536、#537 | #65 のコメント | F34-AC1〜AC28 |
| D デプロイ | #542 | #540 | REL-AC1〜AC12 |
| E 画面からの書き出し | #545 | #524 | F35-AC1〜AC31、F28-AC115 |
| M 監視と通知 | #518〜#521、#523、#538 | #60 | F39-AC1〜AC24 |
| H1 ヘルプの枠 | #528、#539 | #517 | F36 の枠、42 記事の移し替え |
| C メールアドレスの暗号化 | #547、#548、#550、#551、#558 | #543 | 外した(2026-11-26。F41-AC1〜AC21 は削除) |
| B バックアップ | #556、#561、#562 | #555 | F39-AC25〜AC33 |
| G AI エージェントからの書き出し | #553、#559、#569、#573 | #552 | F23-AC46〜AC51、F35-AC32〜AC42 |
| N メンテナンス | #557、#563、#568、#571、#574 | #554 | F38-AC1〜AC28 |
| A 計測 | #576、#578、#579 | #560 | F40-AC1〜AC25 |
| S スケールとコスト | #570、#572、#580 | #567 | COST-AC1〜AC12 |
| R 招待制をやめる準備 | #582〜#586 | #577 | F42-AC1〜AC24(AC17、AC18 は、「1 日」が直近 24 時間と決まったあとの PR で足した) |
| H2 ヘルプの記事と入口 | #588、#591、#592、#594 | #587 | F36-AC8、9、11、13、30〜49(AC37 は、「1 日」が決まったあとの PR で足した) |
| O 一度開いたスライドを手元に残す | #565、#575、#589、#590、#593 | #564 | F37-AC1〜AC20 |
| Z1 統合(そろえる) | この PR | | この文書 |

取り込みの順は、P0、P1、`main` の取り込み、T、D、E、M、H1、C、B、G、N、A、S、R、H2、O である。段 3(H2、そのあとの Z)は、段 2 の作業が終わってから始めた。高リスクの作業(C、E、G、N、O、D、R、M)は、別のレビュー役が、セキュリティの観点で 1 回読み、壊れる入力や状態を具体的に示した指摘だけを直した(C は D-89、N は D-118)。R は、実装を変えず、設計の既知の危険に書いた(全体の上限は依頼者の決定待ち)。

## 衝突と解決

並列の作業が同じものを触って食い違ったもの、取り込みのあとに見つかったものと、その直し方である。

| 食い違い | 直し方 |
| --- | --- |
| ストーリーマップに、第四スコープとは別の「scope4 話した言葉といっしょに読む」があり、名前がぶつかった | P0 が、既存の scope4〜scope8 を scope5〜scope9 に改名した(#504)。戻したいときは依頼者が指示する |
| migration の番号が、割り当て(0069 まで)を飛ばして 0070 になった(G が割り当てに無かったため 0070 を使い、S が 0069 を使わなかった) | 0070 を 0069 に付け替えた。第四スコープの migration はまだ本番に適用されていないので、中身を変えずに番号だけを詰めた。そのあと、作業 C の 2 本を外して、もう一度詰め、`main` の 0059〜0061 が入ったので、いまは 0070 である(下の「migration」) |
| `maintenance` が、経路の最初の語(`/maintenance/enter`)なのに、予約語の一覧に無かった | `ROUTE_HANDLES` に足した。`src/auth/handle-rules.test.ts` が、経路の一覧と予約語の一覧の一致として、これを見つけた |
| `scripts/distribution.test.mjs` が、workflow の一覧に D の `tagpr.yml` を入れていなかった | 期待の一覧に `tagpr.yml` を足した |
| CI の Cognitive complexity が、B の `walk`(23)と C の `parseEmailCrypto`(21)で 15 を超えた | 補助の関数に出した(`walkPage`、`nextStep`、`readKeys`、`readCurrent`、`readLookupKey`)。動作は変えていない。C の分は、作業 C を外したときに、ファイルごと無くなった |
| 運営の画面の時刻が、4 つのファイルで同じ式(`new Date(seconds * 1000).toISOString()`)を別々に持っていた | `src/operator/operator-time.ts` の `isoOf` と `timeTag` にまとめた |
| viewer のページと、viewer が保存する殻のページが、同じ帯の style を別々に持っていた | `src/share/viewer-notice-style.ts` にまとめた |
| 運営の画面の枠が指す手順の場所が、作業ごとのファイルにばらけていた | `docs/dev/deploy.md` の「運用の手順」に節をそろえ、枠の指す場所を直した(下の「文書」) |

作業の途中で、D の `tagpr.yml` の期待、B が毎時に入れた `backup` の期待(`src/app/cron-events.test.ts`)、O の共有の handler の複雑さは、それぞれの作業の PR で直っていた。`origin/scope4` の先頭で、`cron-events` は通っている。

## migration

`migrations/` は 0001 から 0070 まで、欠けも重なりもない(`src/db/migration-numbers.test.ts`)。0059〜0061 は `main` のもので、第四スコープのものではない。0059 は #614(Luma の配信先を `api.luma.com` に移す。`community_links.url` と `luma_feeds.url` を書き換える `UPDATE` だけ)、0060 は #627(コミュニティのお知らせのため、表 `notifications` を消して作り直す。`main` の側で依頼者の了承を得ている)、0061 は #629(Luma のイベントの別名の表を足し、`events` の行を直す)である。第四スコープの 9 本は、0061 のあと、0062 から 0070 に足すだけで、どれも表・列・索引・1 行の初期値を足すだけである。

| 番号 | 作業 | 足すもの | 付け直す前の番号 |
| --- | --- | --- | --- |
| 0059 | (`main` の #614) | Luma の配信先の移行(`UPDATE` だけ。第四スコープのものではない) | |
| 0060 | (`main` の #627) | コミュニティのお知らせ(表 `notifications` を作り直す。第四スコープのものではない) | |
| 0061 | (`main` の #629) | Luma のイベントの別名(第四スコープのものではない) | |
| 0062 | M | `alerts`、`alerts_kind_raised`、`alerts_raised`、`alerts_queued` | 0060 |
| 0063 | M | `alert_signals`、`alert_signals_kind_at` | 0061 |
| 0064 | N | `maintenance_notice` | 0062 |
| 0065 | R | `login_code_requests_total`、`accounts_created`(数える索引) | 0063 |
| 0066 | R | `signup_pause_events` | 0064 |
| 0067 | A | `metric_daily`、`metric_days` | 0065 |
| 0068 | B | `backup_objects`(索引 2 つ)、`backup_state`(1 行) | 0066 |
| 0069 | S | `deployments_ready_at` | 0067 |
| 0070 | G | `mcp_grants.scope`、`mcp_codes.scope`(既定は `slides:upload`) | 0068 |

番号は 4 回付け直した。1 回目は、点検のときに、G の 0070 を 0069 にした(上の「衝突と解決」)。2 回目は、作業 C を外したときに、C の 2 本(`0059_email_ciphertext.sql`、`0060_email_plain_index.sql`)を消し、後ろの 9 本を 2 つずつ前へ付け直した。3 回目は、`main` に #614 の 0059 が入ったので、9 本を 1 つずつ後ろへ付け直した。4 回目は、`main` に #627 の 0060 と #629 の 0061 が入ったので、9 本を 2 つずつ後ろへ付け直した(右の列が、4 回目の前の番号)。どれも、第四スコープの migration がまだ本番に適用されていないので、中身を変えずに番号だけを変えた。0058 までの、適用済みのファイルは変えていない。

`DROP`、`RENAME`、`ADD COLUMN` 以外の `ALTER TABLE`、`DELETE`、`REPLACE`、表の作り直しは、0062〜0070 にない。`src/db/destructive-migrations.test.ts` の対象(0036 以降で消す文)の数は、第四スコープでは増えていない(`main` の 0060 の `DROP TABLE` は、`main` の側で数に入っている)。

ローカルの D1 で、次を `src/db/scope4-migrations.test.ts` が確かめる(`--remote` は使っていない)。

1. 空の D1 に、0001〜0070 を最初から最後まで適用できる(`applyMigrations`)。
2. 第三スコープの最後(0058)の D1 に、人 2 人(`accounts`)、スライド 1 本(`decks`)、コミュニティ、フォロー 1 件(`follows`)を入れ、`main` の 0059〜0061 と第四スコープの 0062〜0070 を足して適用できる。行はそのまま残り、`mcp_grants` に `scope` が足される。
3. 第四スコープの migration(0062〜0070)に、表や列を消す・作り直す文がない。

## 経路

`/privacy/external`、`/help/<狙い>`、`/help/<狙い>/<記事>`、`/help/bot`、書き出しの経路、取り出すための URL、運営の入口は、既存の経路やハンドルに隠れていない。`src/app/scope4-routes.test.ts` が、アプリ全体を通して開いて確かめる。

| 経路 | 受ける場所 | 確かめた応答 |
| --- | --- | --- |
| `/terms`、`/privacy`、`/privacy/external` | `legalPath` の経路(`legalKinds`)。メンテナンスの前 | 200。`/privacy/external` は `/privacy` と別の本文 |
| `/help`、`/help/<狙い>`、`/help/<狙い>/<記事>` | `helpRoutes`。メンテナンスの前 | 8 つの狙い、カタログのすべての記事が 200。知らない狙いと記事は 404 |
| `/help/bot` | `helpRoutes` の `HELP_BOT_PATH`。`/help/:aim` より前に登録 | 配信を読むボットの説明(`slide.community-bot/1.0`)。`/help/bot/x` は 404 |
| `/my/slides/:deck/export/:file`、`/account/export/account.json`、`/account/export/picture` | `exportRoutes` | 本人だけ 200。ほかの人、存在しないファイルは 404 |
| `/mcp/files/:value` | `fileRoutes`(`mcpRoutes` の中) | 作っていない値は本文のない 404(`Cache-Control: no-store`)。GET 以外は 405 |
| `/maintenance/enter`(管理 origin)、`/maintenance/entrance`(運営 origin) | `acceptEntrance`、`operatorEntrance` | 止めていないとき、管理 origin の `/maintenance/enter` は 404。止めているときは 503 |
| `/operations`、`/metrics`、`/metrics.csv` ほか | 運営の origin だけの `operatorApp`(別のホスト) | 運営の origin だけが答える。管理 origin には経路が無い |

第四スコープで経路の最初の語として増えたのは `maintenance` だけである(`help`、`privacy`、`mcp`、`account`、`slides` の下に足したものは、既存の語の下にある)。`maintenance` は、予約語の一覧に無かったので足した。予約語の一覧と経路の一覧の一致は、`src/auth/handle-rules.test.ts`(F28-AC19)が、経路の語がすべて予約語にあること、予約語の経路の語がすべて経路を持つこと(`operator` は別のホスト)を見る。

## 外への通信

サービスの Worker で、グローバルの `fetch` を使うのは、次の 7 か所だけである(`src/app/outbound-fetch.test.ts` が、一覧に無いファイルが増えたら落ちる)。binding や entrypoint の `fetch`(`env.ASSETS.fetch`、`ContentFiles`、`CoverShots`、MCP の handler)は Worker の中で閉じる。第三スコープの表([第三スコープの統合の点検](scope3-integration.md#外への通信))に、第四スコープで足したものを加えた。

| ファイル | 行き先 | 止まる設定(無いとき) | いつから |
| --- | --- | --- | --- |
| `src/auth/turnstile-client.ts` | `challenges.cloudflare.com`(Turnstile の Siteverify) | `TURNSTILE_SECRET`(無いと確認は通り、送らない) | 既存 |
| `src/mail/mail-client.ts` | `api.cloudflare.com`(Email Sending) | `MAIL_API_TOKEN`、`MAIL_ACCOUNT_ID`、`MAIL_FROM` の 3 つ。そろわなければ `MAIL_OUTBOX=on` で送信箱に書き、どちらも無いと送らない(ログインの請求は 503) | 既存。第四スコープで、翌日のメールも同じ口を使う |
| `src/profile/gravatar-client.ts` | Gravatar | 本人の `use_gravatar`(既定は使う)と、顔写真が無いこと。アドレスの SHA-256 だけを送る | 第二スコープ |
| `src/feeds/luma-client.ts` | `api.lu.ma/ics/get` だけ | `PUBLIC_ORIGIN` が本番の origin のときだけ(`feedModeOf`)。ほかは送らない。配信が登録されていなければ読まない | 第三スコープ |
| `src/uploads/status-page.ts` | 同じ origin の `/api/uploads/...`(作者のブラウザで動く script) | なし(同じ origin) | 既存 |
| `src/alerts/discord-client.ts` | `discord.com` などの Discord の webhook | `DISCORD_WEBHOOK_URL`(無い、または Discord の webhook の形でないと送らず、ログに `alert_not_sent` を 1 行)。同じ種類は 1 時間に 1 回 | 第四スコープ(M) |
| `src/metrics/analytics-client.ts` | `api.cloudflare.com` の Analytics Engine の SQL API(日ごとの集計を読む) | `ANALYTICS`(binding)、`ANALYTICS_READ_TOKEN`、`ANALYTICS_ACCOUNT_ID`(32 桁の 16 進)の 3 つ。1 つでも無いと問い合わせない。1 日 1 回(20 時 UTC) | 第四スコープ(A) |

サービスの Worker が通信する行き先は、第四スコープで足したものは Discord の webhook と Cloudflare の API(日ごとの集計)の 2 つで、指示書の想定と合う。ほかに足したものは見つからなかった。

別の Worker、スクリプト、ブラウザからの通信は、次のとおりである。

| 元 | 行き先 | 止まる設定 |
| --- | --- | --- |
| 見張りの Worker(`watcher/src/observe.ts`) | `WATCH_URLS` の 3 つ(自分のサービスのトップ、viewer、配信 origin)。5 分ごと | `WATCH_URLS`。https の住所か `http://localhost` だけ(ユーザー情報とポートは断る)。メンテナンス中は、確認はするが「開けません」を通知しない(D-120) |
| 見張りの Worker(`watcher/src/index.ts`) | Discord の webhook | 見張りの Worker の secret `DISCORD_WEBHOOK_URL`。無いと送らない |
| 反映のスクリプト(`scripts/release-deploy.mjs`、Workers Builds の中) | 自分のサービスの 3 つの origin(反映の後の確認)、`api.github.com`(認証なし。build が `release` の先頭で `main` の上にあるかを確かめる。答えなければ確かめなかったことを記録して進む)、Discord の webhook | build の変数 `DISCORD_WEBHOOK_URL`。Workers Builds の外では、何もせず断る。試験の台本(`scripts/load/`)は、本番の origin を指定すると断る |
| 利用者のブラウザ | Turnstile の script(`challenges.cloudflare.com`)、同じ origin の API | `TURNSTILE_SITE_KEY` |
| 利用者のブラウザ(押したときだけ) | X、Bluesky の投稿画面、GitHub(フッターのリンク) | 押したとき |

### 作業 T の「外部への送信の表と実装の食い違い」との突き合わせ

作業 T は、規約の「外部への送信」の表と、実装が実際に通信する先を比べた。第四スコープの作業が入ったあとの状態で、もう一度突き合わせた。

| 通信する先 | 表にあるか | 作業 Z の確かめ |
| --- | --- | --- |
| Cloudflare(Workers、D1、R2、配信、Browser Rendering) | ある | 第四スコープで足した Analytics Engine(書き込み)と SQL API(読み取り)は、Cloudflare の中で、個人を特定する値を含まない(F40-AC15)。表の「すべての情報」の範囲に収まる |
| Cloudflare Email Service | ある(「ログインのコードとお知らせのメールの送信」) | いま送るのは、ログインのコードと、運営への翌日のメール(アドレスを含まない)。利用者への「お知らせのメール」は送っていない |
| Turnstile | ある | 変わらない |
| Gravatar | ある | 既定が「使う」であることは変わらない(下の「決めてほしいこと」) |
| Luma(`api.lu.ma`) | **ない** | 変わらない。コミュニティの管理者が登録した配信だけを、1 日 1 回、カレンダーの番号と User-Agent だけで読む。利用者の情報は送らない |
| X、Bluesky の投稿画面 | **ない** | 変わらない(押したときだけ、ブラウザが移る) |
| Discord(webhook) | **ない** | 第四スコープで足した。運営への通知で、本文は件数と運営の画面か手順の文書へのリンクだけ。メールアドレス、IP アドレス、利用者の名前を入れない(テストで確かめた)。利用者の情報を送らないので、表に載せるかは依頼者が決める(下の「決めてほしいこと」) |
| 自分のサービスの URL への確認(見張りの Worker、反映のスクリプト) | 表に載る性質でない(自分のサービスの中) | 利用者の情報を送らない |

作業 T が見つけた「表と実装の食い違い」のうち、この点検で新しく分かったことは、Discord が表に無いことだけである。そのほかは、下の「文面で見つけたこと」にそのまま並べた。

## binding、secret、vars

第四スコープが足した資源と設定の一覧である。すべて、無くてもサービスは今までどおり動く(D-08)。`src/app/scope4-unset.test.ts` が、全部を外した設定で、次を確かめる。

- 招待された人がログインでき、招待されていない人は断られる。
- 規約、ヘルプ、スライド、設定、書き出しのページが 200 で開く。
- cron を 1 日の 24 の時刻すべてで動かして、どの処理も失敗せず、外への通信が 1 本もなく、通知が壊れない。
- webhook が無いときの即時の通知は、送らずにログ 1 行になる。
- 運営の画面(運用、計測)が開き、「未設定」と出る。

(テストの環境は、ログインの請求の上限 `LOGIN_CODE_LIMITS` だけ、遅くならないよう大きな値にしてある。)

| 名前 | 種類 | 置き場 | 作業 | 無いときの動き |
| --- | --- | --- | --- | --- |
| `ANALYTICS`(データセット `slide_events`) | binding | `wrangler.jsonc`(足した) | A | 記録は何もしない。運営の画面の「計測」が「未設定」 |
| `UPLOADS_BACKUP` | binding | `wrangler.jsonc` には**足していない**(足す行は [deploy.md](deploy.md#バックアップ作業-b))。バケット `slide-uploads-backup` を作ってから足す | B | 毎時の `backup` は何も読まず書かない。「バックアップ」の枠が「未設定」 |
| `DISCORD_WEBHOOK_URL` | secret(サービスの Worker、見張りの Worker、Workers Builds の変数の 3 か所) | 依頼者が登録 | M、D | すぐの通知は送らず、記録とログ 1 行。「通知」の枠が「未設定」 |
| `ALERT_MAIL_TO` | secret | 依頼者が登録(任意) | M | 翌日のメールは、お問い合わせの宛先へ |
| `ALERT_THRESHOLDS` | var(JSON。`loginMailFailures`、`loginMailWindowSeconds`、`d1SizeBytes`、`signupSurgeFactor`、`signupSurgeMinimum`、`throttleSeconds`) | 依頼者が設定(任意) | M、R | 既定の値(3 回/1 時間、5 GB、10 倍と 10 人、1 時間に 1 回)。読めない値は、全体が既定になる |
| `ANALYTICS_READ_TOKEN`、`ANALYTICS_ACCOUNT_ID` | secret | 依頼者が作って登録 | A | 日ごとの集計は何もしない。「計測」が「未設定」 |
| `MAINTENANCE` | secret | 依頼者が必要なときに登録、終えるときに消す | N | 無い、空、`off` は止めない。`on`、`on;until=<UTC>;reason=<database\|update\|other>`、読めない値は止める([メンテナンス](deploy.md#メンテナンス作業-n)) |
| `OPEN_SIGNUP` | var または secret | 依頼者(招待制を外すとき) | R | `on` だけが開く。無いと招待制のまま |
| `NEW_AUTHOR_LIMITS` | var(JSON。`days` 7、`perDay` 3) | 依頼者(任意) | R | 既定の値。登録から 7 日のあいだ、直近 24 時間に 3 本まで(F42-AC17、AC18。窓は決まった) |
| `LOGIN_CODE_LIMITS` の `total` | 既存の var に足した名前(既定は無効。1 以上の整数で有効) | 依頼者(任意) | R | 無いときは無効(全体の上限なし。F42-AC29)。同じアドレス・同じ接続元の上限は効く |

見張りの Worker は、別の Worker で、`watcher/wrangler.jsonc` が設定である。サービスの Worker とコードも資源も共有しない。

| 項目 | 値 |
| --- | --- |
| 名前 | `slide-watcher`(`workers_dev` と `preview_urls` は止めてある) |
| Cron | `*/5 * * * *` |
| Durable Object | `STATE`(クラス `WatchState`、SQLite。migration `v1`。作る手間なし) |
| vars | `WATCH_URLS`(トップ、viewer、配信 origin の 3 つ)、`WATCH_SETTINGS`(`failuresToTell` 2、`throttleSeconds` 3600、`maintenanceChecksToFail`、`maintenanceOverrunSeconds` 1800、`timeoutMs` 5000。すべて任意) |
| secret | `DISCORD_WEBHOOK_URL` |
| 確かめ用 | `watcher/wrangler.check.jsonc`(`slide-watcher-check`。開けない住所だけを見る。確かめたら消す) |

`wrangler.jsonc` の権限に関わる値が変わっていないことは、`git diff 9f15c240..HEAD -- wrangler.jsonc` で確かめた。差分は、`analytics_engine_datasets`(binding `ANALYTICS`、データセット `slide_events`)の 6 行を足したことだけで、`ACCESS_TEAM_DOMAIN`、`ACCESS_AUD`、`routes`、`account_id`、D1 と R2 の本番の名前、`triggers`(Cron は `17 * * * *` の 1 つ)、環境(`env`)は変わっていない。`src/operator/wrangler-config.test.ts` と `scripts/release-flow.test.mjs`(REL-AC1)が、これを CI で見る。

## 通知の種類

サービスの Worker のコードが送る通知は 11 種類で、D-56 の表のうち「Worker」「見張りの Worker」「反映のスクリプト」が送る行と一致する。Cloudflare のアラートと Budget alerts が送る 3 行(5xx の割合、上限に当たった数、請求額)は、コードの外である。

| 種類(`ALERT_URGENCY`) | D-56 の行 | 急ぎ | 送る人 |
| --- | --- | --- | --- |
| `page_unreachable` | ページが開けるか | すぐ | 見張りの Worker |
| `login_mail_failed` | ログインのメールの送信失敗 | すぐ | Worker |
| `signup_surge`、`mail_flood` | 登録の急増、メールの送りすぎ | すぐ | Worker |
| `maintenance` | メンテナンスの開始、終了、見込みの超過 | すぐ | 見張りの Worker |
| `deploy_check_failed` | 反映の後の確認の失敗 | すぐ | 反映のスクリプト |
| `cron_failed` | cron の各処理の失敗 | 翌日 | Worker |
| `luma_feed_stopped` | Luma の配信の停止 | 翌日 | Worker |
| `d1_size` | D1 の大きさ | 翌日 | Worker |
| `report_received` | 通報 | 翌日 | Worker |
| `backup_failed` | バックアップの失敗 | 翌日 | Worker |

`src/alerts/notice.pure.test.ts` が、すぐの 6 種類と翌日の 5 種類を D-56 のとおりに数える。通知の本文に個人の情報が入らないことは、すべての種類について、すぐの本文(`src/alerts/notice-text.pure.test.ts`。種類ごと)と、翌日のメールの本文(`src/alerts/digest-text.pure.test.ts`。この点検で、全 11 種類を通すテストを足した)で確かめる。見張りの Worker と反映のスクリプトの本文は、それぞれのテスト(`watcher/src/watch-text.pure.test.ts`、`scripts/discord-notice.pure.test.mjs`)が見る。

D の「反映が途中で止まった」通知(`stopped at:` の段階)は、固定の文言で同じ口に送るが、通知の種類としては数えていない(D-56 に行が無い)。足すかは、依頼者が決める(下の「決めてほしいこと」)。

## メールアドレスを外に出さない

`src/site/no-email-leak.test.ts` は、メールアドレス、その MD5、SHA-256、Gravatar のハッシュ、`@mail.example` が、本体にも、ヘッダーにも出ないことを、読者、2 人の作者、未ログインの人が開く全ページで確かめる。第四スコープで足したものを、次のとおり加えた。

| 足したコード | 確かめること |
| --- | --- |
| 規約、ヘルプ(狙いと全記事、検索)、書き出し(`slide.json`、`article.md`) | 本人が開いても、本文とヘッダーにアドレスもそのハッシュも無い(本人のアカウントの情報(`account.json`)と設定は、本人のアドレスを出す決まりで、対象から外してある) |
| 計測 | 3 人が全ページを開いたあとに、Analytics Engine へ書かれた全部の行に、アドレスもそのハッシュも無い(書き込み先を差し替えて読む) |
| ログ、通知 | 新しい人のログイン、断られたログイン、存在しないページ、cron の全処理を 24 の時刻すべて、全 11 種類の通知を動かして、`console` に出た全行と、Discord に送った全部の本文に、アドレス、そのハッシュ、表示名が無い |
| 運営の画面 | 運用、計測、CSV のページに、招待や利用者のアドレスが出ない |
| AI エージェントからの書き出し | `export_account` だけが本人のアドレスを返し、ほかの人のアドレスとハッシュは無い(第四スコープの G が足した) |

## cron の処理とログの形

サービスの Cron Trigger は、毎時(`17 * * * *`)の 1 つだけである。1 日 1 回の処理は、決まった時刻(UTC)の firing で動く。処理の一覧は `src/app/cron-routes.ts` の `CRON_TASKS` にあり、`src/app/cron-routes.test.ts` が、名前、種類、成功と失敗のイベント名を固定している。

| 処理 | 動く時刻 | 作業 | 成功のイベント | 失敗のイベント |
| --- | --- | --- | --- | --- |
| `preview_sweep` | 毎時 | 既存 | なし(静か) | `preview_sweep_error` |
| `signup_sweep` | 毎時 | 既存 | `signup_sweep` | `signup_sweep_error` |
| `upload_cleanup` | 毎時 | 既存 | `upload_cleanup` | `upload_cleanup_error` |
| `deck_purge` | 毎時 | 既存 | `deck_purge` | `deck_purge_error` |
| `feeds_read` | 毎時(配信は 1 日 1 回) | 第三スコープ | `feeds_read` | `feeds_read_error` |
| `notification_sweep` | 毎時 | `main` の #627(期限を過ぎたお知らせを消す。F20-AC19) | `notification_sweep` | `notification_sweep_error` |
| `backup` | 毎時(その日の巡回は 18 時 UTC に始め、途中なら続ける) | B | なし(静か) | `backup_error` |
| `d1_size` | 19 時 | M | `d1_size` | `d1_size_error` |
| `metrics_copy` | 20 時 | A | `metrics_copy` | `metrics_copy_error` |
| `alert_collect` | 22 時 | M | `alert_collect` | `alert_collect_error` |
| `alert_digest` | 23 時 | M | `alert_digest` | `alert_digest_error` |

どの処理も、そのほかに、同じ形の 1 行を毎回残す(D-60)。`{ event: 'cron_task', task, outcome: 'ok' | 'failed', count, ms }`。失敗は、処理の名前で翌日のメールの種類 `cron_failed` になる(F39-AC3)。1 つの処理の失敗は、ほかの処理を止めない。

メンテナンス中は、**全部の処理が止まる**。`runScheduled` が、メンテナンスの値(`MAINTENANCE`。`on`、見込みつき、読めない値のどれも)を見て、`scheduled_skipped_maintenance` を 1 行残し、何も始めない。`src/app/cron-routes.test.ts`(F38-AC22)が、1 日の 24 の時刻すべてで、登録されたすべての処理(1 日 1 回の 4 つと `backup` を含む)が始まらないことを確かめる。

## 文言

第四スコープで足した画面の文言は、日本語と英語の両方を持つ(英語の辞書の欠けは型検査で落ちる)。規約の 3 つのページ(文面は日本語のみ。英語のときは日本語の文面に英語の注記が付く。D-25)と、運営の画面(第二スコープから日本語だけ)は、辞書を使わない。

`src/app/scope4-routes.test.ts`(D-12)が、次を英語で開いて、日本語が残らないこと(言語の切り替えの表示だけを除く)を確かめる。ヘルプの入口、狙いの一覧、すべての記事、`/help/bot`、設定、1 本の管理、スライドの viewer、ログイン、招待制を外した(`OPEN_SIGNUP=on`)ログイン、メンテナンス中のページ。日本語で開いたときに日本語が出ることは、メンテナンス中のページで確かめる。

## 部品の重なり

| 部品 | 点検の結果 |
| --- | --- |
| 「未設定」の表示 | 運営の画面は、`src/operator/not-configured.ts` の `notConfigured` の 1 つだけを、計測、バックアップ、通知の 3 つの枠が使う。ログインの画面の `notConfigured` は、メールを送れないときの別の文言で、重ならない |
| 運営の枠 | `src/operator/operator-frame.ts` の `operatorFrame` の 1 つ。運用のページの 4 つの枠と、計測の枠が使う |
| 帯 | メンテナンスの予告(`src/maintenance/notice-band.ts`。ヘッダーの上)と、保存した版の帯(viewer の枠の上)は、置く場所と役目が違う。保存した版の帯の style が、viewer のページと、viewer が保存する殻のページに 1 つずつあったので、`src/share/viewer-notice-style.ts` にまとめた |
| 時刻の表示 | 運営の画面の時刻は、4 つの場所で同じ式を持っていたので、`src/operator/operator-time.ts` にまとめた。利用者向けの時刻は、`src/share/dates.ts`(日本時間)と、メンテナンスの帯(`src/maintenance/maintenance-text.ts`。日本時間と UTC)で、役目が違う。1 日の区切りは、通知の翌日のメールが日本時間、計測の集計と cron の時刻が UTC である(役目の違い。混ぜていない) |
| 設定の読み取り | `ALERT_THRESHOLDS`、`NEW_AUTHOR_LIMITS`、`LOGIN_CODE_LIMITS`、`WATCH_SETTINGS` は、それぞれ zod の schema で、読めない値は全体を既定に戻す。同じ形(`parseXxx`)で、重ならない |

## 規約の文面の写し

`legal/` の 3 つのファイルと、リポジトリの中の写し(`src/legal/handed-over/`)は、`diff` の終了コードが 0 である(2026-11-26 に確かめた)。

```sh
diff legal/terms.md src/legal/handed-over/terms.md                                   # 0
diff legal/privacy.md src/legal/handed-over/privacy.md                               # 0
diff legal/external-transmission.md src/legal/handed-over/external-transmission.md   # 0
```

`legal/` は、リポジトリの外の引き継ぎのディレクトリ(`slide-scope4-handoff/legal/`)にある。写しと `src/legal/texts/*.ts` の一致は、`src/legal/` のテストが見る。

## 文書

feature の文書の状態の文を、実装に合わせた(f28、f34、f36、f39、f40、f41、f42)。f41 は、そのあと、作業 C を外したときに「作らない機能」に直した。f35、f37、f38、f23 は、すでに合っていた。`docs/dev/index.md` の一覧に、この文書を足した。`.agents/skills/verify-slide/features/README.md` に、f34〜f42 の行を足し、ヘルプと安全の行を新しいヘルプに合わせた。

`docs/dev/deploy.md` は、D(反映の仕組み)、M(通知と監視)、B(バックアップ)、N(メンテナンス)、A(計測)、R(登録を開く)、O(保存した版)の節がそろった(C の節は、作業 C を外したときに消した)。手順の順番は、指示書の「本番での反映の順番」と合っている(deploy.md の「最初の 1 回の流れ」の 1〜6 が、指示書の 1〜6、deploy.md の 9 が 8、10 が 9。指示書の 7(メールアドレスの書き換え)は、作らないことにしたので無い)。別のファイルに書かれた手順(通知の手順、計測の設定の手順、`backup.md`、`f42-open-signup.md`)は、deploy.md の「運用の手順」の表から、節ごとにリンクした。同じ設定は、1 か所にだけコマンドを書く。運営の画面の枠が指す手順の場所は、deploy.md の節に直した。

## 保留

| 保留 | どこで、なぜ止まったか | 決まったら |
| --- | --- | --- |
| F42-AC17、F42-AC18(登録から 7 日間の、1 日に新しく置ける本数の窓と、断りの文) | **決まった(A: 直近 24 時間。2026-11-26、依頼者の判断)。** 窓の関数と断りの文を足し、`test.todo` の 2 つを本物のテストにした。同時に始めても上限を超えない作りにした | 足した([設計](f42-open-signup.md)の「新しい登録者の置く量」) |
| F36-AC37(「今日はこれ以上置けません」と出たときの記事と、ドロップの理由からのリンク) | **決まった(上と同じ)。** 記事 `slides/daily-limit` と、ドロップの理由・AI エージェントの断りからのリンクを足した | 足した |
| F28-AC115 の対象(利用を止められている人の退会の確認に、書き出しのリンクを出すか) | D-30 が未決 | 止められていない人だけに出している |

## 作業 C は、依頼者の判断で仕組みごと外した

2026-11-26 に、依頼者が次のように決めた。「メールアドレスの暗号化はやめる。メリットと、コスト・リスクが釣り合わない。仕組みも入れない。メールアドレスの漏えいより、(鍵を失って)ログインできなくなり、スライドを失う方が問題である。」

理由は、[メールアドレスを暗号化して持つ](../features/f41-email-encryption.md) の「決めたこと」にある。代わりの仕様は [メールアドレスに触れる場所を限る](../features/f43-email-handling.md)(#617 で `scope4` に入った。実装した。下の「[作業 F43](#作業-f43メールアドレスに触れる場所を限る)」)である。要点は 4 つである。

- 鍵を失うと、だれもログインできなくなり、復旧の手段が無い。
- メールアドレスの漏えいより、ログインできずに、作者がスライドを失う方が重い。
- 効くのは、D1 の中身だけが外に出た場合に限られる。
- 鍵が無ければ今までどおり動く、という形で仕組みだけを残すこともしない。

外したのは、作業 C の PR(#547、#548、#550、#551、#558)が入れたものと、それに合わせて後の作業が足したものである。`scope4` はまだ本番に反映していないので、本番の D1 には、この機能の列も行も入っていない。

| 外したもの | 中身 |
| --- | --- |
| 暗号と検索用の値、読み書きの境 | `src/db/email-cipher.ts`、`email-settings.ts`、`email-adapter-store.ts`、`email-store.ts`、`email-rewrite.ts`、`email-rewrite-store.ts` と、そのテスト。Better Auth のアダプターを包む境、コードの行の名前を鍵つきのハッシュにする設定(`verification.storeIdentifier`)、利用者の行の追加の欄 |
| 鍵の設定 | `Env` の 3 つの名前、`.dev.vars.example` のコメント、鍵を渡す引数(ログイン、招待、設定、プロフィール画像、書き出し、cron の掃除、ローカルの送信箱) |
| migration | 列を足す 1 本と、平文の行だけの部分索引の 1 本。後ろの 9 本の番号を詰めた(上の「migration」)。`src/db/schema.ts` と `auth-schema.ts` の列、`docs/dev/er-diagram.md`(生成し直した) |
| 運営の画面 | 「運用」のページの「メールアドレスの暗号化」の枠と、`POST /operations/email/rewrite`。枠は 4 つ(メンテナンスの予定、新しい登録、バックアップ、通知)になった。招待の一覧の「読めません」の分岐と、「鍵が使えない」の結果の文 |
| 後の作業が合わせた部分 | G(#573)の `export_account` の `email_unavailable` の断り。R(#582〜#586)が招待と登録の照合に使っていた、暗号化した形での検索。Z1(#596、#598)の、未設定の一覧と、この文書の行 |
| ヘルプ | 記事「預かっている情報と、その守り方」の、暗号化して持つと書いた段落(日本語と英語) |
| 文書 | `docs/dev/f41-email-encryption.md`、`docs/dev/email-encryption-runbook.md`、`deploy.md` の鍵の節と、最初の 1 回の流れの鍵と書き換え。F41 の受け入れ条件はすべて削除とし、F28-AC118 も削除とした |

残したものは、次のとおり。

- **`src/auth/auth-store.ts`。** 作業 C は、Better Auth の組み立てを `src/auth/config.ts` から分けた。暗号化と関係なく、純粋なファイルから外への依存を除く整理で、`scripts/layers.test.mjs` の `KNOWN` が 1 行減っている。暗号に関わる部分だけを外して、分けた形は残した。
- **R の機能。** `OPEN_SIGNUP`、全体の上限、登録の一時停止、招待制を外しているあいだに登録した人の行(`invited_by` が `open-signup`)は、平文のメールアドレスで、そのまま動く。運営が、その行のあるアドレスを招待すると、運営の招待になることも変わらない。
- **G の機能。** `export_account` は、本人のメールアドレスを返す。
- **鍵に関わらない守りのテスト。** 作業 C が足したテストのうち、メールアドレスの鍵なしのハッシュ(MD5、SHA-1、SHA-256、Gravatar に送る値)を D1 にも R2 にも保存しないことと、ログイン、断られたログイン、誤ったコード、不正な入力のあとに、ログとエラーの応答にメールアドレスもそのハッシュも出ないことは、暗号文と鍵の検査だけを外して、`src/auth/email-traces.test.ts` に残した。テスト名は、代わりの仕様の F43-AC10 と F43-AC8 にした(F43 のほかの条件は、作業 F43 で満たした)。ログインのメールの件名と本文に宛先のアドレスが入らないことのテスト(`src/mail/login-code-mail.pure.test.ts`)も残した。
- **ローカルの送信箱のテスト。** `src/mail/outbox-store.test.ts` は、作業 C が足したファイルだが、暗号化と関係のない動き(アドレスで読める、新しい順、24 時間で消える、本番の設定で送信箱が入らない)を確かめる形に書き直して残した。あとの 2 つは、F43-AC12 の名前にした。

メールアドレスは、第三スコープまでと同じく、`auth_user.email` と `invited_emails.email` に平文で持つ。メールアドレスを画面、応答、ログ、通知、計測に出さないこと(上の「メールアドレスを外に出さない」)は、暗号化と別の守りで、変わっていない。

## 作業 F43(メールアドレスに触れる場所を限る)

[メールアドレスに触れる場所を限る](../features/f43-email-handling.md)(F43-AC1〜AC16)を実装した。設計は [メールアドレスに触れる場所を限る実装設計](f43-email-handling.md) にある。

- **宣言の場所。** `src/privacy/email-exposure.ts`。メールアドレスを持つ列(14)、読んでよいファイル(18)、出てよい場所(6)、理由つき。テスト、ヘルプの記事(`safety/data-we-keep` の「メールアドレスを使う場面」)、表を除いて書き出す手段(`scripts/db-export-without-email.mjs`)が、同じ宣言を読む。
- **作ったもの。** ソースを調べるテスト(`scripts/email-exposure.test.mjs`、調べ方は `scripts/email-touches.mjs`、`email-exposure-check.mjs`、`email-exposure-routes.mjs`)、宣言から回す `src/site/no-email-leak.test.ts`(出てよい場所 6 つを 1 つずつ動かし、確かめる対象の道は `src/site/test-no-email-pages.ts`)、鍵つきのハッシュの `src/auth/login-keys.ts`(`login-routes.ts` から取り出した)とそのテスト(`src/auth/email-traces.test.ts`)、`MAIL_OUTBOX` が `wrangler.jsonc` のどこにも無いことのテスト(`src/mail/outbox-store.test.ts`)、ヘルプの記事と宣言の一致のテスト(`src/help/email-scenes.pure.test.ts`)、メールアドレスを持つ表を除く書き出し(`scripts/db-export-without-email.mjs`)、試験と demo のアドレスの domain の検査(`scripts/fixture-addresses.test.mjs`。見つかった 5 か所を直した)、[本番に反映する](deploy.md#本番のデータを手元に写すときの決まり) の節。
- **反映の順番、人の確認に、増えるものは無い。** binding、secret、var、migration を足していない。`wrangler.jsonc` を変えていない。本番にも外にも触れていない。
- **決めたこと。** `auth_verification.identifier`(`sign-in-otp-` とメールアドレス)を、登録者のアドレスの列として宣言に載せ、写しからも除く(仕様の例の 3 つの表のほかに 1 つ)。

## 人の確認

依頼者が行うことである。指示書の「最後の報告」の順に並べた。手順の場所は、すべて `docs/dev/` の文書にある。ローカルでは確かめられないものを、確かめたようには書いていない。模擬で通ったことは、Discord、メール、Cloudflare のアラート、Workers Builds が実際に動く根拠にしていない。

### 1. 本番での反映の順番

[本番に反映する](deploy.md#最初の-1-回の流れ)の「最初の 1 回の流れ」に、手順がそろっている。

1. 本番の D1 をバックアップする。バックアップには平文のメールアドレスが入るので、保管先と保持期間を先に決める。
2. 足した binding の先の資源(バックアップのバケット)を作る。([バックアップ](deploy.md#バックアップ作業-b))反映の前に、ダッシュボードで Analytics Engine を有効にする(deploy が止まったとき。公式の文書で確かめられていない。[計測の設定](metrics-setup.md#1-analytics-engine-の-dataset))。
3. secret を登録する(Discord の webhook、計測のトークンとアカウントの番号)。([運用の手順](deploy.md#運用の手順))
4. Workers Builds を本番の Worker につなぐ(本番のブランチは `release`)。([依頼者が最初に行う設定](deploy.md#依頼者が最初に行う設定))
5. `scope4` の PR を `main` に merge する(`minor` のラベル)。この時点では、本番は変わらない。tagpr がリリース PR を開く。
6. リリース PR を merge する(merge の前に見るものを、すべて見る)。`release` が進み、本番に migration と deploy が入る。反映の後の確認が通ることを見る。
7. Cloudflare のアラートと Budget alerts を設定し、通知を 1 つずつ試す。([通知と監視](deploy.md#通知と監視作業-m))
8. 規約とプライバシーポリシーの文面を仕上げ、施行日を入れて、もう一度リリースする。8 は、1〜7 の後のいつ行ってもよい。それまで、規約のページは「下書き」として出る。

反映の前(1 と 5 のあいだ)に、本番の D1 を読んで確かめること(読み取りだけ。コマンドは [移行前の手順](deploy.md#移行前の手順)の手順 3): (a) 登録から 7 日以内のアカウントがいるか(新しい人の制限が、反映の瞬間から効く。いれば伝えるか、`NEW_AUTHOR_LIMITS` を緩める)、(b) ハンドルが `maintenance`、`my`、`slides` のアカウントがいるか、(c) `0060` の `DROP TABLE notifications` が未適用か(未適用なら、未読を含む通知がすべて消える。適用の前に依頼者へ知らせる)。

指示書の順番には、6 と 7 のあいだに「運営の画面で、メールアドレスの書き換えを実行する」があり、3 に「暗号の鍵」があった。メールアドレスの暗号化を作らないことにしたので(2026-11-26)、どちらも無い。

### 2. 規約とプライバシーポリシーの文面の仕上げと施行日

- 文面の仕上げは `legal/OPEN-ITEMS.md`、差し替えの手順は [規約のページの実装設計](f34-legal-pages.md#文面を差し替える手順)にある。文面は、エージェントが書き換えない。決まっていない値(`(日数)`、`(年数)`、`(施行日)`)も、依頼者が決める。
- 「外部への送信」に、ほかの 2 つと同じ `(施行日): 制定` の行をページ末尾に持たせてよいか(渡された文面に無い 1 行)。

### 3. Workers Builds を本番の Worker につなぐこと

[Cloudflare の API token](deploy.md#cloudflare-の-api-token)と、[Workers Builds を本番の Worker につなぐ](deploy.md#workers-builds-を本番の-worker-につなぐ)。本番のブランチは `release`。Build command は `pnpm run build`、Deploy command は `node scripts/release-deploy.mjs`。build に渡す値は `PNPM_VERSION` と `DISCORD_WEBHOOK_URL`。実際に build が `release` の最初の push で始まり、token の権限が足りるかは、動かして確かめるまで分からない(記録を [最初の 1 回の流れ](deploy.md#最初の-1-回の流れ)の末尾に書く)。

### 4. ブランチの保護と、アカウントの守り

[GitHub の Actions の設定](deploy.md#github-の-actions-の設定)、[secret scanning と push protection](deploy.md#secret-scanning-と-push-protection)、[アカウントの 2 要素認証](deploy.md#アカウントの-2-要素認証)、[最初のタグと `release` ブランチ](deploy.md#最初のタグと-release-ブランチ)、[ブランチの保護](deploy.md#ブランチの保護)。Cloudflare のトークンの権限は、上の 3。GitHub Actions を `release` の迂回する者に置けるかは、公式の文書に書かれておらず、置けなかったときの形が書いてある。

### 5. Discord の webhook、Cloudflare のアラート、Budget alerts

[通知と監視](deploy.md#通知と監視作業-m)。Discord の webhook を作ってサービスと見張りの 2 つの Worker の secret に入れる。見張りの Worker を deploy する。Monitors 2 つ(5xx の割合、上限に当たった数)と Budget alerts 9 段を設定する。Monitors の SQL が読む `logs.workersLogs` の列の名前は、文書に無いので、導入の API で確かめる([通知の実装設計](alerts.md))。本番の D1 で `size_after` がバイトで返ることも確かめる。

### 6. 通知ごとに、わざと失敗を起こして届くことの確認

[わざと失敗を起こして確かめる](alerts-runbook.md#わざと失敗を起こして確かめる)。ローカルと実際の Discord のテスト用チャンネルで行うのが基本で、本番の設定と secret は書き換えない。見張りの Worker は、別の Worker `slide-watcher-check` で、本番で届くことを確かめられる(確かめたら消す)。Durable Object `WatchState` が実際に動くことも、このとき確かめる。

### 7. バックアップのバケットと戻し方

[バックアップ](deploy.md#バックアップ作業-b)。バケット `slide-uploads-backup` を作り、公開していないことを確かめ、lifecycle の規則を置かず、`wrangler.jsonc` に `UPLOADS_BACKUP` の行を足す PR を出して、反映する(バケットが先。順番が逆だと反映が止まる)。そのあと、使い捨てのスライドで、戻し方を一度試す([戻し方を一度試す](deploy.md#戻し方を一度試す依頼者))。rclone 用の R2 の API トークンを作った場合は、使い終わったら消す。

### 8. 計測の読み取り用のトークン

[計測](deploy.md#計測作業-a)。Account Analytics の Read だけの権限のトークンを作り、`ANALYTICS_READ_TOKEN` と `ANALYTICS_ACCOUNT_ID` を登録する。実際の API で、時刻の指定、整数の型、問い合わせの上限を一度確かめる。**このスコープを反映すると、記録が始まる。** 反映の前に、[突き合わせた結果](metrics.md#プライバシーポリシーとの突き合わせf40-の-7)を読む。反映のあと、記録に個人を特定する値が無いことを確かめ、最初の 20 時 UTC の firing で `metrics_copy` が `ok` になることを見る。本番の運営の Access で、運営でない人に `/metrics` と `/metrics.csv` が開かないことも確かめる。

### 9. 暗号の鍵と書き換え(無くなった)

行うことは無い。メールアドレスの暗号化は、依頼者の判断で作らないことにし、仕組みごと外した(2026-11-26。下の「[作業 C は、依頼者の判断で仕組みごと外した](#作業-c-は依頼者の判断で仕組みごと外した)」)。鍵を作る、登録する、控えを保管する、既存の行を書き換える、のどれも要らない。番号は、指示書の「最後の報告」の順と合わせるために残してある。

### 10. 監査ログと Workers のログの保存期間

[ログと監査ログの保存期間を確かめる](alerts-runbook.md#ログと監査ログの保存期間を確かめる)。結果は、プライバシーポリシーの履歴情報の日数を決める材料になる。取り出すための URL(`/mcp/files/<値>`)が、Workers Logs、traces、zone 側のリクエストの記録に残るかも、ここで確かめる([AI エージェントからの書き出しの実装設計](f35-agent-export.md#残るリスクコードでは直せないもの))。

### 11. 本番での 1 回あたりの数の実測、3 つの試験、上限の数

[スケールとコストの設計](scale-cost.md)。本番での 1 回あたりの数を測って式に入れる。3 つの試験は、本番と分けた環境ができてから、依頼者が行う(本番の URL に負荷をかけない。Cloudflare の利用規約と事前の連絡を、先に確かめる)。上限の数を決めるのは、試験のあとである(D-143)。0069 の索引を足したあとの、トップページの問い合わせの読む行は、本番の D1 の metrics で確かめる。

### 12. 実機のブラウザでの確認

- 実機の iOS の Safari(と Chrome、Firefox の実機)で、通信を切って、同じ URL が出て、保存した版の帯が出ること。実機と本番の回線で、通信できるときの共有 URL の応答の速さが変わらないこと([一度開いたスライドを手元に残す実装設計](f37-offline-reading.md#人の確認))。
- 実機のブラウザ(iOS の Safari を含む)で zip のダウンロードが始まること。macOS の「アーカイブユーティリティ」と Windows のエクスプローラーで、書き出した zip が開けること。本番の Worker の CPU 時間と R2 の応答の遅さ(有料のプランで動いていること)。([データの書き出しの実装設計](f35-export.md#人の確認として残るもの))
- 実際の AI エージェント(Claude Code、Claude のアプリ)が、道具の説明だけで、`export_account` から通しの書き出しを終えられること。古い接続の答えの文が、エージェントを通して利用者に伝わること。([AI エージェントからの書き出しの実装設計](f35-agent-export.md#人の確認として残るもの))
- 運営の入口(メンテナンス中、Cloudflare Access を通して管理 origin の画面が開くこと)を、本番で一度通す([メンテナンス](deploy.md#メンテナンス作業-n))。メンテナンスの開始、超過、終了の通知が Discord に 1 回ずつ届くこと。

### 13. 招待制を外すかどうかの判断

[登録を開く](deploy.md#登録を開く作業-r)。外す前に済ませること(Turnstile、通知、停止の手順、規約、仮の数)は、[外す前に確かめること](f42-open-signup.md#外す前に確かめること)にある。第四スコープでは、招待制を外さない。

### そのほかの確認

- ヘルプの記事の文言の確認(特に「運営者と連絡先」「異議の申し立て」は、規約の下書きの言葉に従っている。規約が変わったら読み直す)。`slideusercontent.com` の名前が、本番のコンテンツドメインの名前と合っているか。
- 画面の文言とデザインの良し悪し(許可の画面の「自分のスライドと記事を読み、取り出す」、運営の画面の「計測」の行の並びとラベル、規約の下書きの注記)。
- 実際の Luma の配信でのイベントの URL の位置と応答(第三スコープから残る)。

## 決めてほしいこと

依頼者に決めてほしいことを、STATUS.md と各作業の PR から集めた。重複は 1 つにまとめた。推奨があるものは、推奨を先に書いた。決まるまでの動きも書く。

### 実装を止めているもの

1. **「1 日」の数え方(F42-AC17、F42-AC18、F36-AC37)。決まった(A: 直近 24 時間。2026-11-26、依頼者の判断)。** 区切りが無く、日付の変わり目に 6 本置ける穴が無く、窓の定義が 1 つの関数で済む。窓の関数と断りの文、同時に始めても上限を超えない作り、H2 の記事とドロップの理由からのリンクを足した。

### 招待制を外す前に決めること

2. **全体の上限(F42-AC6)。決まった(既定で無効。2026-11-26、依頼者の決定)。** 招待制をすぐ外す予定で、ログインしやすさを優先する。負荷や送りすぎが問題になったら、そのとき考える。F42-AC6〜AC9 は削除とし、「既定で無効。`total` を設定すると有効」の条件を F42-AC25〜AC29 で書き直した。同じアドレス・同じ接続元の上限は変えない。有効にする手順は[有効にする手順](f42-open-signup.md#有効にする手順)にある(`LOGIN_CODE_LIMITS` の `total` を足して deploy。登録の一時停止も使える)。以下は、決める前の検討である(有効にしたときの危険として、設計の「既知の危険」に残した)。全体の上限(100 通/時間)は、メールを送らない請求も数えるので(送ったものだけを数えると、登録の有無が画面の違いで分かってしまう。F42-AC7)、匿名の請求だけで上限を使い切れ、登録している人も 429 になる。防ぎは Turnstile だけである。(A) 既定のまま(いまの本番にも効く)、(B) 招待制のあいだは無効にし、開くときに有効にする(**推奨**。ただし F42-AC6 の変更になる)、(C) 上限を上げる(危険は残る)。決まるまでは、A のまま。
3. **停止された人が、退会して別のアドレス(`+` タグを含む)で登録し直せること。** 停止の名簿(アドレスの HMAC を持ち、登録を断る)は、このスコープの決めたことに無いので作っていない。あわせて、運営の画面で足りない操作(アドレスから人を探せない、アカウントの無い人を停止できない、人を通報する入口が無い、新しい登録者の一覧が無い)を作るか([招待なしで登録できるようにする実装設計](f42-open-signup.md#足りない操作))。
4. **招待制を外すかどうか**。人の確認の 13。

### 反映の仕組み(D)

5. **`release` を進める鍵。** GitHub Actions のまま始めるか、GitHub App(または deploy key)にするか(**推奨は App**。書き込める人が別のブランチの workflow で `release` を進められる穴が、App なら無い)。始める前に決める。決まるまで、書き込める人を最小に保つ。
6. **最初のタグと版の番号。** `v0.3.0` を `origin/main` に付けて、最初のリリースを `v0.4.0` にしてよいか。
7. **「反映が途中で止まった」通知を、通知の種類に足すか。** D-56 に行が無いので、足していない。いまは固定の文言を同じ口に送る。

### 通知と監視(M)

8. **見張りの確認先。** `WATCH_URLS` の viewer と配信 origin の既定は、存在しないページ(404 が返ることで Worker と D1 が答えていることを見る)。公開しているスライドの住所に変えるか。
9. **Discord を「外部への送信」の表に載せるか。** 運営への通知で、本文に利用者の情報は入らない。載せるなら文面に足す(文面は依頼者が決める)。

### 個人の情報(A、G、B)

10. **(決めることは無くなった)鍵を失った場合の復旧(C)。** 依頼者が、メールアドレスの暗号化を作らないと決めた(2026-11-26)。鍵が無いので、失うこともない。10〜13 の番号は、ほかの文書からの参照のために残してある。
11. **(決めることは無くなった)運営の招待の一覧が、開けない行が 1 行でもあると全体で失敗する点(C)。** 招待の一覧は、第三スコープまでと同じく、平文の行をそのまま出す。開けない行は無い。
12. **(決めることは無くなった)鍵のローカルでの渡し方(C)。** 鍵が無い。`.dev.vars.example` のコメントも消した。
13. **(決めることは無くなった)書き換える前の D1 のバックアップの保管先と保持期間(C)。** 書き換えが無い。ただし、D1 のバックアップと Time Travel にメールアドレスが平文で入ることは、暗号化と関係なく、今までどおりである。反映の前に取るバックアップの保管先と保持期間は、人の確認の 1 の 1 で決める。
14. **計測とプライバシーポリシーの突き合わせ(A)。** 第 8 条 2 項の日数(Analytics Engine は 3 か月で消える。ログの保存期間と合わせて決める)。D1 の日ごとの集計は、参照元のホスト名とヘルプの 0 件の検索の語を、無期限に残す。これを第 8 条 2 項の「件数の集計」に当たると読むか、一定の期間で語を消すか(消す場合は `metric_daily` の `help_search_empty` の行を消す処理を足す)。第 2 条・第 3 条に、ヘルプの検索の語を書くか。
15. **取り出すための URL の記録(G)。** `observability.logs.invocation_logs` と `traces` をどうするか。取り出すための URL(値は 1 時間で切れ、1 つのファイルにしか使えず、接続の取り消しですぐ止まる)が、Workers Logs に最長 7 日残るかもしれない。止める前に、M の 5xx アラートが呼び出しの記録に頼っていないことを確かめる。`wrangler.jsonc` は変えていない。**Discord の webhook の URL も同じ**(通知を送る `fetch` の URL にトークンが入り、traces の fetch の span の属性に残るかもしれない。確かめていない)。traces と `invocation_logs` の判断は、webhook も合わせて行う。webhook のトークンが記録に残ったら、webhook を作り直す([手順](alerts-runbook.md#discord-webhook-の-url-が記録に残ったとき))。
16. **Gravatar の既定。** `use_gravatar` の既定は「使う」で、顔写真を登録していない全員に対し、本人が切るまで、メールアドレスの SHA-256 を Gravatar に送る(`legal/OPEN-ITEMS.md` の第 5 条に関わる)。既定を「使わない」にするか。
17. **計測の「週の選び方」(A)。** 12 週の表だけを作った。週を切り替える操作が要るか。
18. **バックアップの 30 日(B)。** 元から消えたファイルのコピーを、消えたと巡回が気づいた日から 30 日残し、巡回は 1 日 1 回なので、消されてから最大で約 31 日残る。プライバシーポリシー第 8 条 1 項の「最大 30 日」と約 1 日ずれる。文面を直すか、実装を 29 日に変えるか。

### 文面と画面(T、H2)

19. **D-20 の読み方。** 「変えるファイルが文面のファイルだけで済む」を、作業 T は「1 つの文面につき、`src/legal/texts/<名前>.ts` と、写し `src/legal/handed-over/<名前>.md` の 2 つ(描く側は触らない)」と読んだ。1 つにしたければ、Markdown から TS を生成する形に変えられる。
20. **`DESIGN.md` の注記。** `DESIGN.md` は下書きの注記を `notice-warning`(色面あり)と書くが、05-UI-RULES と F34-AC8 に従い、枠線だけにした。`DESIGN.md` を直すか。
21. **ストーリーマップの名前。** 既存の scope4〜scope8 を scope5〜scope9 に改名した(#504)。戻したいか。
22. **(決めることは無くなった)ヘルプの記事「預かっている情報と、その守り方」の暗号化の 1 段落。** 暗号化を作らないことにしたので、段落を日本語と英語の両方から外した。記事には、プライバシーポリシーと「外部への送信」へのリンクと、自分でできること(設定、書き出し、退会、開示や削除の求め方)だけが残る。
23. **利用を止められている人の退会の確認に、書き出しのリンクを出すか(F28-AC115、D-30)。** いまは、止められていない人だけに出している。出さずに、お問い合わせへ案内する形も考えられる。

### スケールとコスト(S)

24. 本番での測定の後に、`scripts/cost/per-use.mjs` の既定を書き換えるか、測った値のファイルを渡し続けるか。表の仮の前提(閲覧とスライドの比、再訪の割合)を、実際の様子で決める。
25. 引用の問い合わせの作り直し([スケールとコストの設計](scale-cost.md#索引で減らせないもの))を、続きの作業にするか。

## 文面で見つけたこと

`legal/` の文面と実装の食い違いのうち、`legal/OPEN-ITEMS.md` に無いものを、条ごとに並べ直した。文面は直していない。作業 T が 2026-11-26 に `origin/scope4`(P1 までと `main` の取り込み)で見つけたものに、第四スコープの作業 E、M、A、B、O、G、R が入ったあとの状態を加えた(作業 C は外したので、メールアドレスの持ち方は第三スコープまでと同じである)。入ったことで食い違いでなくなったものは、その旨を書いた。

### 利用規約

- **第 10 条 2 項。** 退会後にコンテンツを消すのは、すぐではない。スライドは退会の時点で配信を止め、行と R2 の物は cron が、一定の猶予のあとに消す。さらに、元から消えたファイルのコピーは、バックアップに最大で約 31 日残る(作業 B)。(`legal/OPEN-ITEMS.md` の第 10 条 2 項は、退会の後も残す記録の 1 文を足す提案で、別の論点である。)
- **第 11 条(コンテンツの取り出し)。** 作業 E、G が入り、画面と AI エージェントからの書き出しができる。食い違いでなくなった。
- **第 17 条 2 項。** 規約の変更を、サービス上の表示かメールで知らせる仕組みは無い。(`legal/OPEN-ITEMS.md` の第 17 条 2 項は日数の論点で、別である。)

### プライバシーポリシー

- **第 2 条、第 8 条 1 項(退会で消えないもの)。** 退会(`markAccountDeleted`)で消えないものがある。
  - `invited_emails` の行(メールアドレスそのもの。平文)。運営が手で消すまで残る。招待制を外しているあいだに登録した人の行(`invited_by` が `open-signup`)も、同じ表に入る。
  - `reports` のうち、通報した人の id と自由記述(`note`)(通報先のスライドが残る限り)。
  - `community_admins` の行(利用者の id)。
  - `released_handles`(ハンドルを 90 日、ほかの人が取れないようにする記録)。文面に無い。
  - 停止された人の `auth_user`(メールアドレス)。第 8 条 4 項の「利用規約に反した行いの記録」に当たるとみなせる。
- **第 5 条、「外部への送信」の表(Gravatar)。** `use_gravatar` の既定が「使う」で、本人が設定で切るまで、顔写真を登録していない全員に対して、メールアドレスの SHA-256(小文字、空白なし)を Gravatar に送る。(OPEN-ITEMS 第 5 条は、文面の書き方の論点である。)
- **第 7 条 2 項(コンテンツの写しをブラウザに残す)。** 作業 O が入り、残すようになった。残す期間と数(1 日、20 本)が、第 8 条の期間と合うかを確かめる必要がある(人の確認)。
- **第 8 条 1 項(バックアップに最大 30 日)。** 作業 B が入り、サービスが持つバックアップができた。元から消えたファイルのコピーは、消えたと巡回が気づいた日から 30 日残り、巡回は 1 日 1 回なので、最大で約 31 日になる(約 1 日のずれ)。D1 の復元用の履歴の期間は、Cloudflare の契約(有料で 30 日、無料で 7 日)で決まり、コードでは確かめられない。メールアドレスは D1 に平文で持つので、手で取った D1 のバックアップと、D1 の履歴にも、そのまま入る。
- **第 8 条 2 項(履歴情報の日数)の材料。**
  - `login_code_requests`(アドレスと接続元の hash)は、窓の期間を過ぎると消える。`auth_session` は、期限が切れると毎時消える。端末の名前は、セッションのあいだ残る。IP アドレスと User-Agent は保存していない。
  - 計測の記録は、Analytics Engine に 3 か月残る。D1 の日ごとの集計(日、出来事、区分、参照元のホスト名、言語、画面、件数)は、無期限に残る。参照元のホスト名とヘルプの 0 件の検索の語(50 文字まで)が含まれる。
  - Workers のログ(`observability` が有効)の期間は、Cloudflare の設定による。取り出すための URL(`/mcp/files/<値>`)が、呼び出しの記録に最長 7 日残る可能性がある(作業 G)。
- **第 2 条、第 3 条(計測)。** ヘルプで 0 件だった検索の語を記録する。語を明示した記述は無い。第 1 条 2 項の「操作」「履歴情報」と読める。
- **第 10 条 1 項(自分で取り出し)。** 作業 E、G が入り、アカウントの情報を取り出せる。食い違いでなくなった。
- **第 11 条 1 項。** 末尾に空白が 1 つある(表示には出ない)。

### 外部への送信

- **冒頭の文。** 「…別ページの下書きである。送り先が変わったときは、このページだけを更新する。」は、施行日を入れても、ページに残る。
- **附則。** 文面に附則が無く、施行日の置き場が無い。F34-AC6、F34-AC7 のため、ほかの 2 つと同じ「(施行日): 制定」の行を、ページ末尾に足した(渡された文面に無い 1 行。依頼者の確認が要る)。
- **表の目的。** 「ログインのコードとお知らせのメールの送信」だが、利用者に送るメールはログインのコードだけである(運営への翌日のメールは、利用者のものでない)。
- **表に無い送り先。**
  - Luma(`api.lu.ma`。iCal の取得)。
  - X、Bluesky の投稿画面へのリンク(利用者が押したときだけ)。
  - Discord(webhook。運営への通知。作業 M で足した)。
  - Turnstile は、ブラウザが `challenges.cloudflare.com` を読み、Worker が token と IP アドレスを siteverify に送る。表に明示が無い。
