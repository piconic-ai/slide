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

## 確かめた公式の文書

- `Retry-After` の意味(日付、または秒数)は、RFC 9110 の 10.2.3 節に従う。このサービスは秒数だけを返す。
