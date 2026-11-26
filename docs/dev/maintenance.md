# メンテナンスの実装設計

[メンテナンスを知らせる](../features/f38-maintenance-notice.md)(F38)の設計。サービスを止めるときの、secret の値の形、止まっているあいだの応答、読めるページ、cron、予告、運営の入口、見張りの Worker とのやりとりを書く。操作の手順は [本番に反映する](deploy.md#メンテナンス作業-n)、通知を受けたときの手順は [通知の手順](alerts-runbook.md) にある。

## 切り替えは secret 1 つ

メンテナンスは、これまでどおり secret `MAINTENANCE` で切り替える(D-115)。secret を入れると始まり、消すと終わる。値は、止めるかどうかのほかに、終わる見込みの時刻と理由の区分を持てる。

メンテナンス中のページは、この値だけから作る。D1 も R2 も読まない。D1 を Time Travel で戻している最中にも出すページだからである(F38-AC18)。

### 値の形

```text
on;until=2026-12-01T03:00:00Z;reason=database
```

| 部分 | 意味 | 書き方 |
| --- | --- | --- |
| `on` | 止める | 必ず先頭に書く。`on` だけでも止まり、変更の前と同じに動く(F38-AC15) |
| `until=` | 終わる見込み | `YYYY-MM-DDTHH:MM:SSZ`、UTC、この形だけ。日本時間やオフセットは書かない。打ち間違えを別の時刻と読まないため |
| `reason=` | 理由の区分 | `database`(データベースの保守)、`update`(サービスの更新)、`other`(その他)のどれか |

`;` で区切り、順番は問わない。`until` と `reason` は書かなくてもよい。

読み方は `src/maintenance/switch.ts` の `parseSwitch` が 1 つだけ持つ。決まりは次のとおり(F38-AC15、AC16)。

| 値 | 結果 |
| --- | --- |
| 未設定、空、空白だけ、`off` | 止めない |
| `on` | 止める。見込みも理由もなし |
| `on;until=…;reason=…` | 止める。読めた部分だけを使う |
| それ以外のすべて(`true`、`yes`、`until=2026-12-01`、壊れた値) | 止める。読めた部分があればそれを使い、無ければ `on` と同じ |

読めない値を止める側に倒すのは、止めるつもりで打った値が打ち間違いで読めなかったときに、サービスが動き続けるよりも、止まる方が安全だからである。D1 を戻している最中にサービスが書き込みを受けると、戻した内容と食い違う。`off` だけは、止めない値として読む(消すのが正しい終え方で、`off` は誤って止めないための逃げ道である)。

次は、読めない部分として捨てる。捨てても止めることは変わらない。

- `until` が、決まった形でない、または存在しない日(`2026-02-30`)。
- `reason` が、3 つの区分のどれでもない。
- 知らない名前の部分。同じ名前を 2 回書いたときの 2 つ目。

終わる見込みが、すでに過ぎているときは、見込みが無いのと同じに扱う(F38-AC14)。過ぎた時刻を「終わる見込み」と出すと、終わっていないのに終わるように読めるからである。

## 止まっているあいだの応答

管理 origin の要求は、`src/maintenance/maintenance-middleware.ts` が、配信 origin と運営 origin の要求は、`src/app/routes.tsx` の `dispatch` が止める。どちらも、同じ `maintenanceHeaders` を付ける。

### ヘッダー

| ヘッダー | 値 | 理由 |
| --- | --- | --- |
| `Retry-After` | 秒数 | 終わる見込みまでの秒数(切り上げ、1 以上、1 日まで)。見込みが無い、または過ぎているときは `300`(F38-AC13、AC14) |
| `X-Slide-Intended` | `maintenance` | 意図した `503` の印。`http_5xx` の数から除く(作業 M。[通知の実装設計](alerts.md)) |
| `X-Slide-Maintenance` | `on`、または `on;until=<UTC>` | メンテナンスの印。見張りの Worker と、一度開いたスライドの Service Worker(作業 O)が、障害の `503` と見分ける(F38-AC23)。理由は入れない。機械が理由で枝分かれしないため |

`Retry-After` を 1 日までに切るのは、`until` を年違いで書いても、巡回する側に 1 年待たせないためである。

`X-Slide-Maintenance` の名前は、見張りの Worker(`watcher/src/observe.ts` の `MAINTENANCE_HEADER`)が同じ名前を持つ。見張りはサービスのコードを読み込まないので、名前は両方に書き、`src/maintenance/maintenance-watcher.test.ts` が一致を確かめる。HTTP のヘッダー名は大文字小文字を区別しない。

### 本文

作業 O(一度開いたスライドを手元に残す)は、`503` かどうかと `X-Slide-Maintenance` の有無で保存した版を出す(D-92、D-121)。本文の形は次のとおり。O は本文を読まなくてよいが、形は変えない。

| 要求 | 本文 |
| --- | --- |
| 管理 origin のページ | `text/html`。「メンテナンス中です」、終わる見込み(あるときだけ)、理由(あるときだけ)、読めるページへのリンク。`Cache-Control: no-store`。CSP は `default-src 'none'` の厳しいもの |
| 管理 origin の `/api/` | `application/json`。`{ "error": "Under maintenance; retry later", "code": "maintenance" }` に、終わる見込みがあれば `"until": "2026-12-01T03:00:00Z"`、理由があれば `"reason": "database"` が加わる。`error` と `code` は変わらない(API の使い手は英語を読む) |
| 配信 origin、運営 origin | `text/plain`、`Under maintenance`。`Cache-Control: private, no-store` |

どの応答も `503` で、`Retry-After` と `X-Slide-Maintenance` を持つ。viewer のページ(`/@handle/slug`)は管理 origin の応答なので、上の表の最初の行である。

ページは、画面の言語(日本語と英語)で出る。時刻は、日本時間と UTC の両方で出し、`<time datetime>` に UTC を入れる(F38-AC9、AC28)。時刻の文字列は `formatJst`、`formatUtc`(`src/maintenance/maintenance-text.ts`)が、日付の部品から手で作る。マシンの locale に左右されない。

## 読めるページ

止まっているあいだも読めるのは、次のページである(D-119、F38-AC17)。

| ページ | 置き場 |
| --- | --- |
| `/terms`、`/privacy`、`/privacy/external`、`/contact` | `src/site/legal-pages.ts`(作業 T) |
| `/help` と、ヘルプのすべてのページ(`/help/bot`、`/help/<狙い>`、`/help/<狙い>/<記事>`、`/help?q=<語>`) | `src/help/routes.ts`(作業 H1)。`app.route('/', helpRoutes)` が `maintenance` より前にある |
| `/robots.txt` | `src/site/middleware.ts` |
| 静的なファイル(`/styles.css`、`/favicon.svg`、`/contact` の元など) | Static Assets。Worker の前に答える |

これらは、`src/app/routes.tsx` で、`maintenance` の middleware より前に置く。後ろには、`welcomeFirst`(利用者の取り込み)などの D1 を読む middleware が続くので、後ろに置いたページは、止まっているあいだに D1 を読む。

置く場所の決まりは、`src/maintenance/maintenance.test.ts` が見張る。

- 上のページを、D1 と R2 に触れると例外を投げる束縛にして、メンテナンス中に開く(F38-AC18)。
- `/help`、`/terms`、`/privacy`、`/contact` で始まる GET の経路が、すべて `maintenance` より前にあることを、`app.routes` の並びで確かめる。ヘルプの経路を足すときに、後ろへ置くと、このテストが落ちる。

ヘルプのページが D1 を読まないことは、記事がコードの中のファイルで、索引も記事から作る作りに頼る(作業 H1)。ヘルプが D1 を読む作りになったときは、上のテスト(狙いと記事のすべて、検索の結果を、D1 なしで開く)が落ちるので、気づける。

## cron

メンテナンス中は、cron の処理が動かない(F38-AC22)。`src/app/cron-routes.ts` の `runScheduled` が、起動のたびに `MAINTENANCE` を読み、止める値なら、どの処理も始めずに `scheduled_skipped_maintenance` を 1 行ログに残す。門は 1 つで、登録した処理のすべてが通る。このスコープで足した処理(バックアップ、集計、翌日のメール)も、`CRON_TASKS` に登録するだけで、同じ決まりで止まる。止まっているあいだに起動した処理は、メンテナンスの後の次の起動まで待つ。起動のたびに「前の回から今回までに溜まったもの」を片づける処理は、そのまま追いつく。

## 予告

予告は、運営が運営の画面で入れる、止める予定である(D-117)。予定は 1 つだけ持ち、新しい予定は前の予定を置き換える(F38-AC6)。予告を入れても、サービスは止まらない。止めるのは secret `MAINTENANCE` である。

### 持ち方

表 `maintenance_notice`(migration `0063`)に、行を 1 つだけ持つ。`id` は 1 に固定し(`CHECK (id = 1)`)、2 つ目の行は作れない。

| 列 | 意味 |
| --- | --- |
| `starts_at` | 止める見込みの時刻(秒) |
| `ends_at` | 戻る見込みの時刻(秒)。開始より後(`CHECK`) |
| `reason` | `database`、`update`、`other` のどれか(`CHECK`) |
| `updated_at` | 入れた時刻 |

運営のメールアドレスは持たない。誰が入れたかは、運営 origin の Access のログに残る。置き換えは 1 つの `INSERT … ON CONFLICT DO UPDATE` で行う。

### 入力

運営の画面の枠「メンテナンスの予定」(`#maintenance`)に、開始の見込み、終了の見込み、理由の区分を入れる(F38-AC8)。時刻は `datetime-local` で、日本時間として読む(`parseJstLocal`)。次の入力は、何も保存せず、入力した値を残したまま、直す欄の下に 1 文を出して返す(400)。

| 入力 | 直す欄 |
| --- | --- |
| 読めない時刻、存在しない日(`2026-02-30`) | 開始、終了 |
| 理由が 3 つの区分のどれでもない | 理由 |
| 終了が開始以前 | 終了 |
| 終了がいま以前 | 終了 |
| 終了がいまから 90 日より先(年の打ち間違いで、帯が何年も出続けないため) | 終了 |

開始は、すでに過ぎていてもよい。すでに止めているときに、予告を入れられなくなるのを避けるためである。開始まで 3 日を切っているとき(すでに過ぎているときも含む)は、入れたうえで、枠に注意を出す(F38-AC7)。表示は `?maintenance=saved_soon` の結果で、保存の後の画面で 1 回出る。

「予告を消す」は、行を消す(F38-AC5)。何も入っていないときに押しても、何も起きず、「出している予告はありません」と出る。2 つの操作は、運営 origin だけの POST で、`Origin` が運営 origin であることを確かめる(既存の `sameOrigin`)。Access を通っていない要求は、ほかの運営の画面と同じく、存在しないページとして返す。

### 帯

予告があり、終了の見込みを過ぎていないあいだ(`isShown`: `now < ends_at`)、すべてのページのヘッダーの上に帯が出る(F38-AC1、AC4)。開始より前からも出る。前もって知らせるためである。

帯は、`src/maintenance/notice-middleware.ts` の `noticeBand` が、ページが作られた後に、`<header class="site-header">` の前へ差し込む。ページの作り方は変えない。すべてのページが `siteHeader` を使い、トップページも同じ目印を持つので、差し込む場所は 1 つで、ページごとに帯を足す必要がない。差し込まないもの:

- HTML でない応答(JSON、画像、`/robots.txt`)。
- `503`。メンテナンス中のページは、それ自体が知らせる。
- メンテナンス中の応答すべて。メンテナンス中は予告も読まない(D1 を読まないため)。
- 運営 origin と配信 origin。管理 origin の `app` だけが対象である。

トップページは、作っておいた静的なファイルで、ブラウザが `If-None-Match` で確かめに来ると `304` を返す。`304` は、帯の入っていない写しを使い続けさせてしまう。予告が出ているあいだは、トップページの経路が確かめの条件を渡さず(`c.get('noticeShown')`)、`200` で全体を返す。`ETag` は、本文が変わるので外す。

帯の中身は `src/maintenance/notice-band.ts` が作る。

| 要素 | 内容 |
| --- | --- |
| 外枠 | `role="status"`、幅いっぱい、既存の色面のトークン(`--block-yellow`)。閉じるボタンはない(F38-AC3、AC27) |
| 文 | 日本語は「(日時)から(日時)まで(日本時間)、メンテナンスのためサービスを止めます。」。英語は「We will stop the service for maintenance from … to ….」。日時は `<time datetime="…Z">` に UTC を入れ、日本時間の文字で出す(F38-AC2、AC28) |
| リンク | ヘルプの「メンテナンス中です、と出たとき」の記事。高さ 44px 以上(F38-AC27) |

リンクの行き先は、安全と規約(`safety`)の `maintenance` という記事である(作業 H2 が書く。`src/maintenance/help-link.ts` の `MAINTENANCE_ARTICLE`)。記事がまだ無いあいだは、存在しないページへ行かないよう、ヘルプの入口へ行く。記事が足されると、コードを変えずに記事へ向く。

### D1 の読み方(F38-AC1)

帯のために、すべての要求で D1 を読まない。isolate の中で、読んだ結果を `NOTICE_TTL_SECONDS`(60 秒)覚えておく。

| 場面 | 読む回数 |
| --- | --- |
| 予告がある、または無い | isolate ごとに、60 秒に最大 1 回(1 行を主キーで読む問い合わせ 1 回) |
| 同時に来た要求が、覚えていないとき | 1 回の読みを分け合う |
| D1 が読めないとき | 「予告なし」と覚え、15 秒に最大 1 回だけ読み直す。例外は名前だけをログに残し、ページは開く |
| メンテナンス中 | 読まない |

見積もり: 生きている isolate が `N` 個なら、1 日に最大 `N × 1,440` 回(1 行ずつ)である。たとえば 50 個なら 72,000 行になる。要求の数には比例しない。

覚えておくあいだは、予告を入れても消しても、ほかの isolate では最大 60 秒、帯が変わらない。入れた isolate と運営の画面は、すぐに変わる(運営の画面は、覚えを通さず D1 を読む)。終了の見込みを過ぎたら、覚えに関わらず、要求ごとの比較で帯が消える。D1 が読めないときは、帯が出ないだけで、ページは開く。

## 運営の入口

メンテナンス中も、運営は管理 origin の画面を開いて確かめられる(D-118、F38-AC19)。運営かどうかは、Cloudflare Access を通ったことで確かめる。配信 origin は対象にしない(F38-AC21)。この仕組みは、セキュリティの観点のレビューを 1 回受ける。

### 流れ

```text
運営(Access を通った)
  1. GET <運営 origin>/maintenance/entrance
        Access の token を検証する(署名、iss、aud、exp。ほかの運営の画面と同じ)
  2. 303 → <管理 origin>/maintenance/enter?t=<enter の値>      (1 分で切れる)
  3. 管理 origin が値を検証し、Cookie を付けて 303 → /          (アドレスから値が消える)
  4. 以後、Cookie があるあいだ(1 時間)、管理 origin はメンテナンス中でも開く
```

メンテナンス中でないとき、1 と 3 は何もしない(経路が無いのと同じ。`404`)。Cookie があっても、メンテナンス中でなければ読まない(F38-AC20)。

### 渡す値

渡す値は 2 種類で、署名の中に種類を入れ、一方を他方として使えないようにする(`src/maintenance/pass-token.ts`)。

| 種類 | 置き場 | 寿命 | 使い道 |
| --- | --- | --- | --- |
| `enter` | 管理 origin のアドレス(`?t=`) | 60 秒 | 運営 origin から管理 origin へ、運営であることを渡す |
| `pass` | 管理 origin の Cookie `__Host-slide_maintenance_pass` | 1 時間 | メンテナンスの hold を通す |

値の形は `v1.<種類>.<期限(秒)>.<署名>` である。署名は HMAC-SHA-256 で、種類、期限、そのときの secret `MAINTENANCE` の値に掛ける。

- **推測できない。** 署名が無いと作れない。鍵は、すでにある secret `BETTER_AUTH_SECRET` から、この用途だけの名前で作り直す(HMAC で導く)。新しい secret は足さない。鍵から元の secret は分からない。`BETTER_AUTH_SECRET` が無い、または 16 文字より短いときは、入口は使えず、すべて `503` になる(D-08)。
- **短い時間で切れる。** 期限は署名の中にあり、さらに検証は、種類の寿命より長い期限を持つ値を、署名が正しくても断る。
- **メンテナンス中だけ効く。** `pass` は、メンテナンスの hold を通すときにしか読まない。さらに、署名に `MAINTENANCE` の値を入れるので、値を変えると(終わる見込みを書き換えても)前の `pass` は効かなくなり、入口を通り直す。終わって、同じ値でもう一度始めたときは、1 時間以内なら前の `pass` が効く。そのときの持ち主は、Access を通った運営だけである。
- **Cookie は管理 origin だけ。** `__Host-` の接頭辞、`Secure`、`HttpOnly`、`SameSite=Lax`、`Path=/`、`Domain` なし。配信 origin は別の origin なので、Cookie が届かない。届いても、配信 origin は Cookie を読まず、メンテナンス中は常に `503` を返す(F38-AC21)。運営 origin も、メンテナンス中は入口のほかは `503` のままである。
- **向き先は固定。** 303 の `Location` は、設定 `PUBLIC_ORIGIN` から作る。要求の値は使わない(オープンリダイレクトにならない)。
- **値の検証は一定の時間で行う。** 署名の比較は、Web Crypto の `verify` に任せる。

### 断り方

運営でない人、Access の token が無い、壊れている、期限切れ、別のアプリケーションの token、メールアドレスを持たない token(サービス token)、入口の設定が無い、鍵が作れない、は、どれも、そのメンテナンス中のほかの要求と同じ `503`(本文も同じ)を返す。入口が何であるかを、断り方で教えない(F38-AC19)。ログには、結果(`issued`、`refused`、`accepted`、`not_accepted`)と、断った理由の符号だけを残す。メールアドレス、値、token は残さない。

### 残る危険

- `enter` の値は、アドレスに入る。ブラウザの履歴、Cloudflare のログに残りうる。60 秒で切れるので、後から使えない。使い捨て(1 回だけ)にはできない。D1 を読まずに覚えておく場所が無いためである。管理 origin は、受け取ってすぐ別のアドレスへ送り、`Referrer-Policy: no-referrer` を付ける。
- Access を通った運営の token が奪われたら、入口は開く。Access の側の守り(2 要素認証、ポリシー)が前提である。
- `pass` を持つ人は、メンテナンス中の管理 origin のすべての画面を開ける。ログインは別である。作者の画面を見るにはログインが要る。

### 試験

`src/maintenance/entrance.test.ts`(実際の HTTP。Access は代役の鍵で署名した token)と `pass-token.pure.test.ts`(値の作りと検証)が、次を確かめる。

| 場合 | 結果 |
| --- | --- |
| Access を通った | 管理 origin へ送られ、Cookie が付き、管理 origin の画面が開く |
| token が無い、壊れている、期限切れ、別の aud、別の team、メールアドレスが無い | `503`。ほかの要求と本文が同じ |
| 値を書き換えた(期限、署名、種類、長さ、混ぜた別の値) | `503`、Cookie なし |
| 期限が切れた(`enter` は 60 秒、`pass` は 1 時間) | `503` |
| 別の `MAINTENANCE` の値で作った値 | `503` |
| メンテナンス中でない | 入口も受け口も `404`。Cookie を付けない |
| 配信 origin(Cookie あり、値あり) | `503` |
| 運営 origin の入口以外 | `503` |

## 確かめた公式の文書

- `Retry-After` の意味(日付、または秒数)は、RFC 9110 の 10.2.3 節に従う。このサービスは秒数だけを返す。
- Cloudflare Access の token の検証(2026-11-26 に確かめた。<https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/>): 要求の `Cf-Access-Jwt-Assertion` ヘッダーを読む(`CF_Authorization` の Cookie は、渡されることが保証されないので頼らない)。署名は RS256、鍵は `https://<team>.cloudflareaccess.com/cdn-cgi/access/certs` の `public_certs` から `kid` で選ぶ。`iss` が team のドメインと等しいこと、`aud` にアプリケーションの AUD が入っていること、`exp` が先であること、`nbf` が先でないことを確かめる。署名が正しいだけでは足りない。入口は、すでにある `verifyAccessToken`(`src/operator/access.ts`)を使い、検証を別に作らない。
