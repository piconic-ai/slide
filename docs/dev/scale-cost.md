# スケールとコストの設計

閲覧と投稿が増えたとき、Cloudflare の請求がどう増えるかの見当を、式で出すための設計。1 回あたりの数、費用の式、単価、本番で測る手順をここに置く。試験の台本と手順は [試験の台本と手順](#試験の台本と手順) にある。索引の見直しとデータベースの乗り換えの合図は、続く PR で、この文書に節を足す。

この作業は、利用者から見える結果を持たない。そのため、機能の仕様(`docs/features/`)は作らず、確かめる条件を [受け入れ条件](#受け入れ条件) に書く。ID は `COST-AC<番号>` の形で、テストの名前の先頭に入れる(`COST-AC1: Given ...`)。決まりの出どころは、第四スコープの D-140〜D-146 である。

## 前提

- 費用の見当は、運営が「月の閲覧がいくつになったら、何にいくらかかるか」を知り、どこが先に無料の枠を超えるかを見るためのものである。予測ではない。入力の多くは仮の値で、本番で測って置き換える。
- 式は Workers Paid の料金で数える。D1 と R2 の無料の枠が Workers Paid に付く分で、アカウントは月 $5 の最低料金を払う前提である(本番のアカウントの契約は確かめていない)。
- 支出の上限(Spend limits)は設定しない(D-146)。上限の数(配信 origin の IP あたり毎分 3,000 など)は、この作業で変えない(D-143)。

## 単価と無料の枠

単価と無料の枠は、`scripts/cost/prices.mjs` の 1 か所にまとめる。表は、そのファイルから `node scripts/cost/estimate.mjs --print-prices` で出したものと同じで、テストが一致を確かめる(COST-AC11)。どの行にも、公式のページの URL と、読んだ日がある(COST-AC3)。単価が変わったら、ページを読み直し、値と読んだ日を一緒に直し、表を出し直す。

| 名前 | 値 | 単位 | 出典 | 確かめた日 | 注 |
| --- | ---: | --- | --- | --- | --- |
| `workersMonthly` | 5 | USD per month, the Workers Paid minimum for the account | https://developers.cloudflare.com/workers/platform/pricing/ | 2026-11-26 |  |
| `workersRequestsIncluded` | 10,000,000 | requests per month included in Workers Paid | https://developers.cloudflare.com/workers/platform/pricing/ | 2026-11-26 |  |
| `workersRequestsPerMillion` | 0.3 | USD per million requests beyond the included | https://developers.cloudflare.com/workers/platform/pricing/ | 2026-11-26 |  |
| `workersCpuIncluded` | 30,000,000 | CPU milliseconds per month included in Workers Paid | https://developers.cloudflare.com/workers/platform/pricing/ | 2026-11-26 |  |
| `workersCpuPerMillionMs` | 0.02 | USD per million CPU milliseconds beyond the included | https://developers.cloudflare.com/workers/platform/pricing/ | 2026-11-26 | Duration is not billed. |
| `r2StorageIncludedGb` | 10 | GB-month of Standard storage free each month | https://developers.cloudflare.com/r2/pricing/ | 2026-11-26 |  |
| `r2StoragePerGb` | 0.015 | USD per GB-month of Standard storage | https://developers.cloudflare.com/r2/pricing/ | 2026-11-26 |  |
| `r2ClassAIncluded` | 1,000,000 | Class A operations free each month | https://developers.cloudflare.com/r2/pricing/ | 2026-11-26 | PutObject, CopyObject, ListObjects and multipart calls. DeleteObject is free. |
| `r2ClassAPerMillion` | 4.5 | USD per million Class A operations | https://developers.cloudflare.com/r2/pricing/ | 2026-11-26 |  |
| `r2ClassBIncluded` | 10,000,000 | Class B operations free each month | https://developers.cloudflare.com/r2/pricing/ | 2026-11-26 | GetObject and HeadObject. |
| `r2ClassBPerMillion` | 0.36 | USD per million Class B operations | https://developers.cloudflare.com/r2/pricing/ | 2026-11-26 |  |
| `r2EgressPerGb` | 0 | USD per GB sent out of R2 to the internet | https://developers.cloudflare.com/r2/pricing/ | 2026-11-26 | The page says there is no charge for egress on any storage class. |
| `d1RowsReadIncluded` | 25,000,000,000 | rows read per month included in Workers Paid | https://developers.cloudflare.com/d1/platform/pricing/ | 2026-11-26 |  |
| `d1RowsReadPerMillion` | 0.001 | USD per million rows read beyond the included | https://developers.cloudflare.com/d1/platform/pricing/ | 2026-11-26 |  |
| `d1RowsWrittenIncluded` | 50,000,000 | rows written per month included in Workers Paid | https://developers.cloudflare.com/d1/platform/pricing/ | 2026-11-26 |  |
| `d1RowsWrittenPerMillion` | 1 | USD per million rows written beyond the included | https://developers.cloudflare.com/d1/platform/pricing/ | 2026-11-26 | A write to an indexed column also writes one row for each index. |
| `d1StorageIncludedGb` | 5 | GB of D1 storage included in Workers Paid | https://developers.cloudflare.com/d1/platform/pricing/ | 2026-11-26 |  |
| `d1StoragePerGb` | 0.75 | USD per GB-month of D1 storage beyond the included | https://developers.cloudflare.com/d1/platform/pricing/ | 2026-11-26 |  |
| `logsEventsIncluded` | 20,000,000 | Workers Logs events per month included in Workers Paid (until 2026-11-30) | https://developers.cloudflare.com/workers/observability/logs/workers-logs/ | 2026-11-26 |  |
| `logsEventsPerMillion` | 0.6 | USD per million Workers Logs events beyond the included (until 2026-11-30) | https://developers.cloudflare.com/workers/observability/logs/workers-logs/ | 2026-11-26 |  |
| `observabilityIngestIncludedGb` | 50 | GB of Observability ingestion included per billing cycle on Paid (from 2026-12-01) | https://developers.cloudflare.com/observability/pricing/ | 2026-11-26 |  |
| `observabilityIngestPerGb` | 0.25 | USD per GB of Observability ingestion beyond the included (from 2026-12-01) | https://developers.cloudflare.com/observability/pricing/ | 2026-11-26 |  |
| `analyticsPointsIncluded` | 10,000,000 | Analytics Engine data points written per month included in Workers Paid | https://developers.cloudflare.com/analytics/analytics-engine/pricing/ | 2026-11-26 | The page says billing has not started; the price is published in advance. |
| `analyticsPointsPerMillion` | 0.25 | USD per million data points written beyond the included | https://developers.cloudflare.com/analytics/analytics-engine/pricing/ | 2026-11-26 | The page says billing has not started; the price is published in advance. |
| `emailIncluded` | 3,000 | emails sent per month included in Workers Paid | https://developers.cloudflare.com/email-service/platform/pricing/ | 2026-11-26 |  |
| `emailPerThousand` | 0.35 | USD per 1,000 emails beyond the included | https://developers.cloudflare.com/email-service/platform/pricing/ | 2026-11-26 |  |

### 分からないこと

料金のページが言っていないこと、または文書と実際の請求が合うかを確かめていないことは、次のとおりである。分からないものは、推測で式に入れず、入力として外に出している。

- **内部の呼び出しの請求。** ファイルの配信と表紙は、入口の Worker から `ctx.exports` の名前付き entrypoint(`ContentFiles`、`CoverShots`)を呼ぶ。`wrangler.jsonc` で、その entrypoint の cache は有効である。[Workers の料金のページ](https://developers.cloudflare.com/workers/platform/pricing/) は、Service binding の呼び出しに追加の要求の料金はかからないと言い、一方で、Workers の cache が有効なときは、Worker から Worker への呼び出しが要求と同じ単価で請求されると読める脚注を持つ。`ctx.exports` の呼び出しが後者に当たるかは、文書だけでは決まらない。式は、当たる(内部の呼び出しも要求として数える)側で数える。実測で確かめる([本番で測る手順](#本番で測る手順))。
- **cache に当たったときの R2 の読み出し。** 式は、内部の cache に当たったファイルの読み出しを R2 の操作に数えない。当たる割合(`cacheHitRate`)は、本番の応答の `X-Content-Cache` から測る。測るまでは 0(すべて R2 を読む)にしてある。
- **容量の単位。** R2 と D1 のページは、GB が 1000³ か 1024³ のバイトかを書いていない。式は 1 GB を 10⁹ バイトで数える(7% ほどの差)。R2 は日ごとの最大の平均で数え、使用量を次の単位に切り上げると書いてあるが、式は切り上げない。D1 は平均か、ある時点かを書いていない。
- **Workers Logs の数え方。** 1 つの要求が何件のログになるか、1 件が何バイトかは、料金のページに書いていない。式は 1 つの要求に 1 件と仮定し、1 件を 1,000 バイトと仮定する。2026-12-01 から、Workers Logs は Cloudflare Observability の料金(GB 単位)に変わる。式は `asOf` の日で、件数の料金と GB の料金を切り替える。
- **Analytics Engine の課金。** 料金のページは、いまは課金していないと書く。式は公表済みの単価で数えるので、実際の請求より多く出る。
- **Rate Limiting binding。** 料金のページに、`limit()` の呼び出しに料金がかかるかの記述がない。式に入れない。
- **式に入れていないもの。** 表紙の撮影の Browser Run(Browser Rendering。月 10 時間まで含み、超えると 1 時間 $0.09。[出典](https://developers.cloudflare.com/browser-rendering/pricing/)、2026-11-26)、バックアップの cron の操作、独自のドメイン、Cloudflare Access。表紙の撮影は、cache に当たらなかった表紙とページの画像だけで起き、その回数は本番で測る。

## 1 回あたりの数

1 回の閲覧、アップロード、一覧の表示について、Worker の要求の数、内部の呼び出し、R2 の操作、D1 の読む行と書く行を、ローカルで数える(D-141)。

### 数え方

`src/cost/per-use.test.ts` が、実際の HTTP の入口(`server.fetch`)から、ローカルの D1 と R2 を通して動かす。数えるための差し替えは `src/cost/test-counting.ts` にある。

- **D1。** D1 の応答の `meta.rows_read` と `meta.rows_written` を足す。Drizzle の読み出しは `raw()` を使い、`raw()` は `meta` を返さないので、読むだけの文は、数えるためにもう一度 `all()` で実行する(結果は `raw()` のもの)。書く文は 1 回だけ `all()` で実行する。`batch` は 1 回の問い合わせで、中の文の行を足す。
- **R2。** `get` と `head` を Class B、`put`、`list`、multipart を Class A、`delete` を請求なしとして数える。見つからなかった `get` も数える。
- **要求と内部の呼び出し。** `server.fetch` の呼び出しを要求として数える。`ctx.exports` の `ContentFiles` と `CoverShots` の差し替えを呼んだ回数を、内部の呼び出しとして数える。
- **外への通信。** `fetch` を、呼ぶと失敗する差し替えにして、呼び出しの回数を数える。どの場面でも 0 でなければならない。
- **データ。** 1 万本のスライド、1,000 人、フォロー 2 万、引用 5,000、コミュニティ 50 の D1(`src/cost/test-dataset.ts`)。読む行の数は、このデータの大きさに依る。

読む行の数の確かめ方は、`rows_read` が D1 の課金の単位と同じかどうかを、本番で確かめていない(ローカルの D1 は workerd の SQLite の数える行である)。表の読む行は、本番の測定の入力ができるまでの、ローカルの値である。

### 数えた結果

スライドの大きさは、版のファイルの数で 3 つに分ける。小さい 5 本、普通 30 本、大きい 100 本(既定の上限は 100、設定で 500 まで)。

- **閲覧(`view`)。** 初めて開く読者の 1 回。スライドのページ、`/api/session`、版のすべてのファイル、ページを伝える script。実際の閲覧は、スライドが参照したファイルだけを読むので、これは上限である。
- **再訪(`revisit`)。** 同じ読者の 2 回目以降。ブラウザがファイルを持ち、検証の要求に `304` を返される。ファイルは内部の呼び出しも R2 の読み出しもしないが、要求と D1 の読み出しは毎回ある(`no-cache` のため)。
- **アップロード(`upload`)。** 開始、ファイルごとの送信、確定。R2 の Class B は、確定のときの `head` である。
- **一覧(`list`)。** `topVisitor` はログインしていない人のトップページ(`/`、`/api/session`、`/api/public/slides`)、`topMember` はログインした人のトップページ(さらに `/api/home`、`/api/home/communities`)、`profile` は人のページ、`community` はコミュニティのページ。静的なファイル(`/` の中身、script、CSS)は、Static Assets の要求なので数えない([無料で上限なし](https://developers.cloudflare.com/workers/platform/pricing/))。
- **表紙(`cover`)。** cache に当たった表紙の 1 枚。viewer のページには、カードの数だけ表紙の要求が付く(最大 24)。

| 場面 | `workerRequests` | `internalRequests` | `d1Queries` | `d1RowsRead` | `d1RowsWritten` | `r2ClassA` | `r2ClassB` | `cpuMs` |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| view small | 8 | 5 | 20 | 40,036 | 0 | 0 | 5 | 306 |
| revisit small | 8 | 0 | 20 | 40,036 | 0 | 0 | 0 | 152 |
| upload small | 7 | 0 | 71 | 135 | 41 | 5 | 7 | 706 |
| view normal | 33 | 30 | 70 | 40,111 | 0 | 0 | 30 | 641 |
| revisit normal | 33 | 0 | 70 | 40,111 | 0 | 0 | 0 | 551 |
| upload normal | 32 | 0 | 296 | 549 | 191 | 30 | 32 | 2,949 |
| view large | 103 | 100 | 210 | 40,321 | 0 | 0 | 100 | 2,248 |
| revisit large | 103 | 0 | 210 | 40,321 | 0 | 0 | 0 | 1,957 |
| upload large | 102 | 0 | 926 | 1,635 | 611 | 100 | 102 | 7,316 |
| list topVisitor | 3 | 0 | 2 | 55,137 | 0 | 0 | 0 | 33 |
| list topMember | 5 | 0 | 34 | 90,870 | 0 | 0 | 0 | 389 |
| list profile | 1 | 0 | 11 | 30,473 | 0 | 0 | 0 | 138 |
| list community | 1 | 0 | 5 | 207 | 0 | 0 | 0 | 42 |
| cover | 1 | 1 | 1 | 2 | 0 | 0 | 0 | 9 |

読み方と限界は次のとおり。

- 要求、内部の呼び出し、R2 の操作、書く行は、コードから決まる。`per-use.test.ts` が、この表(`scripts/cost/per-use.mjs`)と一致することを確かめる(COST-AC8〜COST-AC10)。読む行は、データの大きさに依るので、10% の幅で確かめる。
- R2 の読み出しは、内部の cache が毎回外れた場合の数である。本番で当たれば、R2 の Class B は減り、要求の数は変わらない(式の `cacheHitRate`)。
- `cpuMs` は、この機械の Node 側の CPU 時間である。D1 と R2 の呼び出しの待ち時間、JIT、数えるための 2 回目の実行を含み、Cloudflare が請求する CPU 時間より大きい。式の出発点にとどめ、本番の値で置き換える。
- 閲覧の D1 の読む行が多い(40,000 行ほど)のは、スライドのページの問い合わせの一部が、データの大きさに比例して読むためである。索引の見直しの PR で扱う。

## 費用の式

月の費用は、項目ごとに「使った量 − 含まれる量」の超えた分に単価をかけた和である。含まれる量の中では、その項目は 0 になる(COST-AC2)。

入力は次のとおり。

| 入力 | 意味 | 既定 |
| --- | --- | --- |
| `views` | 月の閲覧(初めての閲覧と再訪の合計) | 指定する |
| `slides` | 置かれたスライドの数 | `views` ÷ 20 |
| `uploads` | 月のアップロード(新しい版) | `slides` × 0.3 |
| `listViews` | 月の一覧の表示 | `views` × 0.2 |
| `emails` | 月のメールの送信(ログインのコードと通知) | `views` × 0.01 |
| `coversPerView` | 1 回の閲覧の表紙の数 | 4 |
| `revisitShare` | 閲覧のうち、ブラウザがファイルを持つ再訪の割合 | 0 |
| `cacheHitRate` | ファイルの読み出しが内部の cache に当たる割合 | 0 |
| `versionsPerSlide`、`bytesPerVersion` | 残す版の数と、1 つの版のバイト | 1、5 MiB(普通の 30 ファイル) |
| `d1BytesPerSlide` | スライド 1 本の D1 のバイト | 1,000(ローカルで 821) |
| `backup` | バックアップのバケットがあるか | あり |
| `logEventsPerRequest`、`logBytesPerEvent` | 要求あたりのログの件数とバイト | 1、1,000 |
| `analyticsPointsPerView`、`analyticsPointsPerUpload` | Analytics Engine へ書く点の数 | 1、2 |
| `view`、`revisit`、`upload`、`list`、`cover` | 1 回あたりの数([1 回あたりの数](#1-回あたりの数)の列) | 「普通」の `view`、`revisit`、`upload`、`topVisitor`、`cover` |

既定の値のうち、`slides`、`uploads`、`listViews`、`emails` の比、`coversPerView`、`revisitShare`、`cacheHitRate`、`bytesPerVersion`、`logBytesPerEvent`、Analytics Engine の点は、**仮の前提**で、測った値ではない。`scripts/cost/defaults.mjs` に 1 か所でまとめてあり、フラグまたは `--per-use` のファイルで置き換える。

式は次のとおり(`scripts/cost/formula.mjs`)。`first = views × (1 − revisitShare)`、`again = views × revisitShare`、`covers = views × coversPerView` とする。

```text
要求      = Σ (回数 × (workerRequests + internalRequests))     回数: first→view, again→revisit, uploads→upload, listViews→list, covers→cover
CPU ms    = Σ (回数 × cpuMs)
D1 読む行 = Σ (回数 × d1RowsRead)
D1 書く行 = Σ (回数 × d1RowsWritten)
R2 A      = Σ (回数 × r2ClassA) + uploads × upload.r2ClassA × (backup ? 1 : 0)
R2 B      = (first × view.r2ClassB + again × revisit.r2ClassB) × (1 − cacheHitRate)
            + uploads × upload.r2ClassB + listViews × list.r2ClassB + covers × cover.r2ClassB
            + uploads × upload.r2ClassA × (backup ? 1 : 0)
R2 容量   = slides × versionsPerSlide × bytesPerVersion × (backup ? 2 : 1) ÷ 10⁹          [GB]
D1 容量   = slides × d1BytesPerSlide ÷ 10⁹                                                 [GB]
ログ      = 要求 × logEventsPerRequest                    (asOf が 2026-12-01 より前: 件数の料金)
            要求 × logEventsPerRequest × logBytesPerEvent ÷ 10⁹  [GB] (2026-12-01 から: GB の料金)
点        = views × analyticsPointsPerView + uploads × analyticsPointsPerUpload

項目の費用 = max(0, 使った量 − 含まれる量) ÷ 100 万 × 100 万あたりの単価
             (R2 容量、D1 容量、ログの GB は GB あたり、メールは 1,000 通あたり)
月の費用   = Workers の最低料金 + 項目の費用の和
```

バックアップの項は、作業 B の設計ができるまでの仮の置き方である。バケットの複製で、アップロードしたファイルごとに、主のバケットを 1 回読み(Class B)、写しの先へ 1 回置く(Class A)とし、容量は 2 倍にする。定期の確認と 30 日の掃除の操作は数えていない。

### 手で計算した値との照合

`scripts/cost/formula.pure.test.mjs` が、次の 3 つの例を、手で計算した値と比べる(COST-AC1)。

1. 2,000 万の閲覧が 1 要求ずつ: 超えた 1,000 万要求 × $0.30 = $3、最低料金と合わせて $8。
2. 100 万の閲覧が R2 を 40 回ずつ読み、cache が半分に当たる(2,000 万回、1,000 万が含まれる、超えた分 × $0.36 = $3.60)。50 万回のアップロードが 20 回ずつ置く(1,000 万回の Class A、100 万が含まれる、超えた 900 万 × $4.50 = $40.50)。1 回に 300 行を書く(1.5 億行、5,000 万行が含まれる、超えた 1 億 × $1 = $100)。13,000 通のメール(超えた 10,000 通 ÷ 1,000 × $0.35 = $3.50)。
3. 4,000 本、1 本 5 GB、バックアップありで 40,000 GB(10 GB が含まれる、39,990 × $0.015 = $599.85)。閲覧 200 回の 4 分の 1 が再訪で、読み出しは 150 × 10 = 1,500 回。

加えて、2026-11-30 と 2026-12-01 でログの料金が切り替わること、含まれる量のちょうどで 0 になること、不正な入力(負、非数、1 を超える割合、欠けた場面)を断ることを確かめる。

### 月の閲覧が 1 万、10 万、100 万、1,000 万のとき

`node scripts/cost/estimate.mjs --table --as-of 2026-11-26` の出力である(月の費用、米ドル)。入力は上の既定で、「普通」のスライド、ログインしていない人のトップページ、cache に当たらず、再訪なし、バックアップあり。表は式から出したもので、テストが一致を確かめる(COST-AC11)。

| Views a month | Total a month | Beyond the included amount |
| ---: | ---: | --- |
| 10,000 | $5.00 | - |
| 100,000 | $6.49 | workersCpu, r2Storage |
| 1,000,000 | $112.68 | workersRequests, workersCpu, r2Storage, r2ClassB, d1RowsRead, logs, email |
| 10,000,000 | $1526.50 | workersRequests, workersCpu, r2Storage, r2ClassA, r2ClassB, d1RowsRead, logs, analytics, email |

読み方は次のとおり。

- 1 万閲覧では、最低料金の $5 のほかは、すべて無料の枠の中である。
- 先に超えるのは、100 万閲覧までは Workers の CPU 時間と R2 の容量である。CPU 時間の見当は、ローカルの CPU 時間が大きく出ているので、本番の値で大きく下がる見込みがある。
- 100 万閲覧から、Workers の要求(1 回の閲覧が、ファイルごとの要求と内部の呼び出しで 60 を超える)、D1 の読む行、Workers Logs が加わる。D1 の読む行は、閲覧あたりの 40,000 行が効く。索引の見直しの PR で減らす。
- 条件を変えた見当は、フラグで出せる。たとえば、再訪が半分、cache の当たりが 9 割なら、次のとおり(`--cache-hit-rate 0.9 --revisit-share 0.5`)。

| Views a month | Total a month | Beyond the included amount |
| ---: | ---: | --- |
| 10,000 | $5.00 | - |
| 100,000 | $6.40 | workersCpu, r2Storage |
| 1,000,000 | $90.75 | workersRequests, workersCpu, r2Storage, d1RowsRead, logs, email |
| 10,000,000 | $1279.90 | workersRequests, workersCpu, r2Storage, r2ClassA, r2ClassB, d1RowsRead, logs, analytics, email |

## 本番で測る手順

1 回あたりの数を本番で測る(D-141)。測るのは依頼者である。ローカルの値(上の表)を、測った値に置き換え、費用の式を出し直す。

1. **期間を決める。** 利用が落ち着いた、平日を含む連続した 7 日間を選ぶ。その間に、アップロードと一覧の表示も含まれていること。Workers の metrics は過去 3 か月まで、1 週間の刻みで見られる([出典](https://developers.cloudflare.com/workers/observability/metrics-and-analytics/)、2026-11-26)。D1 と R2 の metrics は 31 日まで見られる(出典: [D1](https://developers.cloudflare.com/d1/observability/metrics-analytics/)、[R2](https://developers.cloudflare.com/r2/platform/metrics-analytics/)、2026-11-26)。
2. **何を見るか。** 同じ期間の次の 3 つの合計を読む。
   - **Workers。** ダッシュボードの Workers & Pages の Overview で、Worker `slide` を選ぶ。要求の数と CPU 時間(CPU 時間は分位ごとの図。合計は GraphQL で読む)。
   - **D1。** D1 のページで、データベース `slide` の Metrics タブ。読む行と書く行(GraphQL の `d1AnalyticsAdaptiveGroups`)、問い合わせの数(`d1QueriesAdaptiveGroups`)、容量(`d1StorageAdaptiveGroups`)。
   - **R2。** R2 object storage の Overview で、バケット `slide-uploads` の Metrics タブ。操作は `actionType` で分かれる(GraphQL の `r2OperationsAdaptiveGroups`)。ページは Class A と Class B の名前を使っていないので、`actionType` を [R2 の料金のページ](https://developers.cloudflare.com/r2/pricing/) の一覧に当てて分ける。
3. **何で割るか。** 期間の合計を、期間の利用の回数で割る。
   - 閲覧の回数は、`/@<handle>/<slug>` の要求の数(`200` のもの)。Workers Logs で、パスの形で数えるか、作業 A の計測(スライドを開いた件数)を使う。
   - アップロードの回数は、D1 の `deployments` で、期間に `ready_at` を持つ版の数。
   - 一覧の表示の回数は、`/` の要求の数。
   - 要求、D1 の行、R2 の操作は、閲覧に紐づけられる分を、閲覧の回数で割る。経路ごとに分けて測れない分(アップロードと一覧の混ざり)は、先に回数が分かる場面から引いて残りを割る。混ざりが大きいときは、測る期間に、1 つの場面だけを人手で動かす(自分で 100 回開く、など)ほうが分かりやすい。
   - cache に当たる割合は、`/@<handle>/<slug>` の配信 origin の応答の `X-Content-Cache`(`HIT` の割合)から測る。内部の呼び出しが請求の要求に数えられているかは、Workers の要求の数が、入口の要求の数より多いかで確かめる(多ければ数えられている)。
4. **式に入れる。** 測った値を、`scripts/cost/estimate.mjs` の `--per-use` に渡す JSON に書く。ファイルは、置き換える場面と値だけでよい(下の例)。測った後で、`scripts/cost/per-use.mjs` の既定を書き換えるか、ファイルを渡し続けるかを、依頼者が決める。書き換えたときは、`src/cost/per-use.test.ts` の確認の対象が本番の値に変わるので、ローカルの数と本番の数の差を、この文書に書く。
5. **請求と照らし合わせる。** 期間の請求(Cloudflare の請求の画面の使用量)を、式の出力と並べる。合わない項目は、「分からないこと」の項目を疑う。

`--per-use` に渡すファイルの例(値は例で、測った値ではない)。

```json
{
  "view": { "workerRequests": 34, "internalRequests": 20, "d1RowsRead": 120, "r2ClassB": 6 },
  "upload": { "d1RowsWritten": 210 }
}
```

```sh
node scripts/cost/estimate.mjs --views 1000000 --per-use measured.json --cache-hit-rate 0.9
```

## 試験の台本と手順

どこが先に詰まるかを試す台本(D-142)と、走らせる手順、結果から上限の数を決める考え方を書く。**このスコープでは、台本をローカルの起動に向けて短く走らせ、動くことだけを確かめる。** 試験として走らせるのは、本番と分けた環境(D-156)ができてから、依頼者が行う。本番の URL に負荷をかけない。

### 3 つの台本

`scripts/load/run.mjs` に、台本の名前と行き先の origin を渡す。

```sh
node scripts/load/run.mjs hot-slide --origin http://localhost:8787 --slide /@alice/talk
node scripts/load/run.mjs venue-300 --origin http://localhost:8787 --slide /@alice/talk
node scripts/load/run.mjs post-talk-uploads --origin http://localhost:8787 --cookies cookies.json
```

| 台本 | 想定 | 既定 | 1 人がすること |
| --- | --- | --- | --- |
| `hot-slide` | 話題のスライドが毎分 1,000 回開かれる | 毎分 1,000 回(`--views-per-minute`)を 60 秒(`--duration`)、等間隔 | 閲覧(下) |
| `venue-300` | 会場の 300 人が同じ IP から 1 分で開く | 300 人(`--viewers`)が 60 秒(`--within`)のうちのばらばらの時刻に | 閲覧(下) |
| `post-talk-uploads` | 発表の後に 50 本が置かれる | 50 本(`--uploads`)が 60 秒(`--within`)のうちのばらばらの時刻に。1 本は 30 ファイル(`--files`)、1 ファイル 2,000 バイト(`--file-bytes`) | 開始、ファイルごとの送信(1 つずつ)、確定 |

- **閲覧。** 読者が、ブラウザと同じ順で動く。スライドのページ、`/api/session`、そのページが指すファイル(画像、script、CSS)、枠の中のスライドのページ、そのページが指すファイル。ブラウザの接続数にならい、同じ相手に同時に 6 本まで。`/@<handle>/<slug>` の共有 URL を `--slide` で渡す。観客が実際に読み込む種類(ほかの人のスライドのカード、記事の画像)は、スライドのページが指すものだけで、本物の閲覧より少なくなる。
- **同じ IP からの 300 人。** `venue-300` は、1 台の機械から送れば、300 人が同じ IP から来たことになる。台本は 1 つのプロセスから 300 人分を送る。本番と分けた環境では、Cloudflare が `CF-Connecting-IP` を送り元の IP にし、台本から書き換えられない([リクエスト頻度の上限](service-basics.md#リクエスト頻度の上限))。ローカルの起動には、この header が付かず、上限は数えられない。`--client-ip 203.0.113.7` を付けると、台本は、行き先がこの機械(`localhost`、`127.0.0.1`、`[::1]`)のときだけ、この header を付ける。ほかの行き先には付けない。
- **アップロードの cookie。** `post-talk-uploads` は、`--cookies` に、作者の session の cookie の JSON の配列(`["__Host-slide_owner=...", ...]`)を渡す。1 本を 1 人の作者が置く形にして、足りなければ順に使い回す(1 人の作者は同時に 1 本までなので、使い回すと `429` の `upload_busy` が出る)。ローカルでは `scripts/load/make-local-authors.mjs` が、起動中のローカルの D1 に作者を作って cookie を出す。本番と分けた環境では、その環境の運営の画面で、試験用のアドレスを招待し、ログインして取り出す。
- **道具。** Node の標準の `fetch` だけで動く。リポジトリに依存を足さない。外の道具(k6 など)は、実行の基盤を足すことになり、`npx` で呼べても、版と取得先を確かめる作業が増えるので使わない。
- **結果。** 応答の時間の分布(最小、p50、p90、p95、p99、最大。ミリ秒。ボディを読み終わるまで)、ステータスごとの数(接続できなかったものは `error`)、`429` の割合を、全体と、要求の種類ごと(`viewer-page`、`session`、`viewer-asset`、`slide-page`、`slide-file`、`upload-start`、`upload-file`、`upload-finalize`)に出す。`--json` で JSON にする。

### 台本の守り

台本は、本番に負荷をかけないことを、いちばん先に守る(COST-AC4)。

- 行き先の origin を、起動のとき、リクエストを 1 本も送る前に、`new URL` と同じ解析で判定する。`slide.community`、`slideusercontent.com`、その下のすべての host は、大文字、末尾の点、ポート、`http`、全角の綴り、`%2E` の綴りでも、断る。終了コードは 2、出力は「Nothing was sent」を含む。ユーザー名とパスワードを含む address、`http` と `https` 以外、origin でないもの(パスなど)も断る。
- 要求を送る口が 1 つで、そこで毎回、address を判定する。ページが指す先が本番なら(行き先のサービスが本番を指す枠を返す場合)、その要求は送らず、実行を止める(終了コード 2)。
- redirect は辿らない(辿った先が本番かもしれないため)。
- 要求の数に上限(`--max-requests`、既定 200,000)があり、同時に走らせる数にも上限(`--max-in-flight`、既定 500)がある。
- 本番の origin の一覧は `scripts/load/origin-guard.mjs` の `PRODUCTION_DOMAINS` にある。本番に別のドメインを足したら、ここにも足す。

### ローカルで動くことの確かめ方

起動は [verify-slide](../../.agents/skills/verify-slide/SKILL.md) の手順に従う。台本の確認は次のとおり。

```sh
.agents/skills/verify-slide/launch.sh 8811 "$STATE"          # 別の端末で
SLIDE_DEMO_DECK=try-static SLIDE_PERSIST_TO="$STATE" node scripts/demo-citations.mjs examples/static http://localhost:8811
node scripts/load/run.mjs hot-slide --origin http://localhost:8811 --slide /@kfly8/try-static --views-per-minute 600 --duration 5
node scripts/load/run.mjs venue-300 --origin http://localhost:8811 --slide /@kfly8/try-static --viewers 40 --within 4 --client-ip 203.0.113.7
node scripts/load/make-local-authors.mjs "$STATE" 6 > cookies.json
node scripts/load/run.mjs post-talk-uploads --origin http://localhost:8811 --cookies cookies.json --uploads 6 --files 10 --within 3
```

2026-11-26 に、この手順で 3 つとも動き、分布とステータスごとの数が出た。ローカルの `wrangler dev` は 1 つのプロセスなので、時間の値は試験の結果ではない(動くことの確認だけ)。自動のテストは、台本の判定と、数え方と、小さな行き先のサーバー(`node:http`)に向けた短い実行(`scripts/load/run.test.mjs`)を確かめる。

### 試験の手順(本番と分けた環境ができたとき、依頼者が行う)

1. **試験の前に確かめる。**
   - **Cloudflare の利用規約。** [Cloudflare の利用規約](https://www.cloudflare.com/terms/)(2025-09-12 更新の版。2026-11-26 に読んだ)の 2.2.2 は、サービスの benchmark の試験を行うことを許す(結果を公表するときは再現に要る情報を付ける)。負荷の試験そのものを定めた条項はない。2.2.1(b) は、サービスを妨げること、サービスに過度の負担をかけることを禁じる。事前の連絡が要るかは、この文書では分からない。試験の前に、Cloudflare のサポートに、試験の日時、行き先、見込みの要求数を伝えて確かめる。
   - **自分のアカウントの設定。** 小さな IP の集まりから多くの要求を Workers に送ると、Cloudflare の防御に止められることがある(公式の文書で確かめられなかった。コミュニティの報告)。止められたかは、ダッシュボードのセキュリティのイベントで確かめる。台本の結果の `429` と 5xx が、サービスの上限(`429`)か、Cloudflare の防御かを分けて読む。
   - **行き先が本番でないこと。** 行き先の origin が、`wrangler.jsonc` の本番の D1 と R2 を指していない環境であること(D-156 の環境)。台本は本番の origin を断るが、本番の D1 に別のホストから届く環境は止められない。
2. **費用。** 試験の要求、D1 の行、R2 の操作は、その環境のアカウントの請求に乗る。見込みは、この文書の式で出せる。たとえば `hot-slide` の既定(1,000 回の閲覧)は、普通のスライドで、およそ 33,000 要求、30,000 回の内部の呼び出し、70,000 回の D1 の問い合わせになる(表の「view normal」の 1,000 倍)。試験の前に、`node scripts/cost/estimate.mjs` で、試験の回数に直した費用を出して見る。Workers Paid の含まれる量の中に収まる見込みが高いが、D1 の読む行は、データの大きさ次第で大きく変わる。
3. **前もって入れるデータ。**
   - 背景のデータ。`node scripts/load/make-dataset-sql.mjs > dataset.sql` が、10,000 本の公開スライド、1,000 人、フォロー、引用、コミュニティの行を作る SQL を出す。その環境の D1 に `wrangler d1 execute <名前> --file dataset.sql` で入れる(送り先をよく確かめる。本番の D1 に入れない)。
   - 試験の対象のスライド。普通の 30 ファイルのスライド 1 本を、作者の cookie で `scripts/upload.mjs` から置き、公開する。その URL の `/@<handle>/<slug>` を `--slide` に渡す。
   - 作者の cookie。`post-talk-uploads` の分の 50 人(または 1 人で使い回すときは数を減らす)。
4. **走らせる順番。** 1 つずつ、前の試験が終わって数分待ってから走らせる。
   1. 短く(`--duration 10`)、行き先が動くことを確かめる。
   2. `venue-300`(300 人、1 つの IP から)。上限の `429` がどこで出るかを見る。
   3. `hot-slide`(毎分 1,000 回)。まず既定で走らせ、悪化が見えなければ `--views-per-minute` を 2 倍ずつ上げる。
   4. `post-talk-uploads`(50 本)。
5. **見る数字。**
   - 台本の出力: p50 と p95 と p99 の応答の時間、ステータスごとの数、`429` の割合、`error`(接続できなかった)の数。要求の種類ごとの値も見て、どの種類から遅くなるかを知る。
   - Cloudflare の画面: Workers の要求、CPU 時間、エラー。D1 の読む行と書く行、問い合わせの時間。R2 の操作。本番で測る手順(上)と同じ画面である。
   - 見立て(確かめるための仮説): D1 のデータベースは 1 つずつ問い合わせを処理する(単スレッド。[D1 の制限](https://developers.cloudflare.com/d1/platform/limits/)、2026-11-26。1 回の問い合わせが平均 1 ms なら毎秒 1,000 回まで、100 ms なら 10 回まで)。普通のスライドの閲覧は、ローカルの計測で D1 の問い合わせが 70 回(表の `d1Queries`)なので、毎分 1,000 回の閲覧は毎秒およそ 1,170 回の問い合わせになる。1 回が 1 ms 未満の問い合わせでないと、D1 が先に詰まる、というのが仮説である。`hot-slide` の結果が、これと合うかを見る。
6. **結果の記録。** 走らせた日、環境、データの大きさ、台本と引数、出力、Cloudflare の画面の数を、この文書か、依頼者が決めた場所に残す。

### 結果から上限の数を決める考え方

上限の数(配信 origin の IP あたり毎分 3,000 など。[リクエスト頻度の上限](service-basics.md#リクエスト頻度の上限))は、このスコープでは変えない(D-143)。試験の後に、依頼者が決める。決め方の考え方は次のとおり。

1. **守りたいものを決める。** 上限は、1 つの IP が、ほかの読者の応答を遅くしないためのものである。守る対象は、D1 の処理(単スレッドで、閲覧 1 回あたり 70 回ほどの問い合わせ)と、Worker の CPU である。
2. **膝を見つける。** `hot-slide` で、毎分の閲覧を上げていき、p95 の応答の時間が目に見えて悪化し始める点、または 5xx が出始める点(膝)を、環境の側の限界として読む。その閲覧の数に、1 回の閲覧が数える要求の数(共有 URL 側と配信 origin 側のそれぞれ。[リクエスト頻度の上限](service-basics.md#リクエスト頻度の上限)の数え方)をかけると、その限界が、毎分いくつの要求に当たるかが出る。
3. **会場の 1 つの IP を見る。** `venue-300` の結果から、同じ IP の 300 人が 1 分で数える要求の数(共有 URL と配信 origin のそれぞれ)を読み、その IP が、環境全体の限界のどれだけを使うかを見る。会場の人数が 10,000 人(依頼者の決めた、止めない上限の目安。2026-11-26)に増えたとき、環境の限界を超えるなら、上限を下げるのではなく、上限の外の対策(キャッシュ、閲覧の問い合わせを減らす)を先に考える。
4. **数に直す。** 膝の数に、依頼者が決める余裕(膝の何割までを上限にするか)をかけたものを、候補にする。候補を、(a) 1 つの IP が普通に使う量(1 人の閲覧で 267 要求。再読み込み)、(b) 止めたくない大きさの会場、と並べ、どちらも止めない範囲で、いちばん小さい値を選ぶ。(a) と (b) が両立しないなら、そのことを先に依頼者が知らされる。
5. **決めたら。** `wrangler.jsonc` の `ratelimits` の値を変え、[リクエスト頻度の上限](service-basics.md#リクエスト頻度の上限) の表と、その導き方の文を直す。変更の PR に、試験の結果を貼る。

## 受け入れ条件

この作業は、利用者から見える結果を持たないので、確かめる条件をここに書く。

| ID | 条件 | 確かめ方 |
| --- | --- | --- |
| COST-AC1 | 費用のスクリプトは、同じ入力に対して、文書の式を手で計算した値と同じ値を出す。不正な入力は断る | `scripts/cost/formula.pure.test.mjs`、`scripts/cost/estimate.pure.test.mjs` |
| COST-AC2 | 費用のスクリプトは、無料の枠の中では、その項目の費用を 0 と出す。枠のちょうどでも 0 で、超えた分だけ単価がかかる | `scripts/cost/formula.pure.test.mjs` |
| COST-AC3 | 単価の表のすべての行に、公式の文書の URL と、確かめた日がある | `scripts/cost/formula.pure.test.mjs` |
| COST-AC4 | 試験の台本は、本番の origin(`slide.community`、`slideusercontent.com` とその下)を、大文字、末尾の点、ポート、サブドメイン、`http`、全角、`%2E` の綴りでも指定すると、1 本も送らずに断る。台本が送る先(ページが指す先)も、本番なら送らずに止まる | `scripts/load/guard.pure.test.mjs`、`load.pure.test.mjs`、`run.test.mjs`(プロセスとして) |
| COST-AC5 | 試験の台本は、ローカルの起動に向けて短く走らせると、応答の時間の分布とステータスごとの数と `429` の割合を出す。同じ IP からの 300 人、50 本のアップロードの形を取る | `scripts/load/load.pure.test.mjs`、`data.pure.test.mjs`、`run.test.mjs`(小さな行き先のサーバー)。ローカルの `wrangler dev` に向けて、3 つとも手で走らせた(上) |
| COST-AC8 | アップロード 1 回の要求、R2 の書き込み、D1 の行を、小さい・普通・大きいの 3 つで数え、表(`per-use.mjs`)と合う。外への通信は 0 | `src/cost/per-use.test.ts` |
| COST-AC9 | 閲覧 1 回(初回と再訪)と表紙 1 枚の、要求、内部の呼び出し、R2 の読み出し、D1 の行を数え、表と合う。再訪は R2 を読まない | `src/cost/per-use.test.ts` |
| COST-AC10 | 1 万本のスライドで、一覧の表示 1 回の要求と D1 の行を数え、表と合う | `src/cost/per-use.test.ts` |
| COST-AC11 | この文書の単価の表、1 回あたりの数の表、月の閲覧ごとの費用の表は、スクリプトの出力と同じである | `scripts/cost/doc.test.mjs` |

索引の条件(COST-AC6、COST-AC7)は、その節を足す PR で、この表に足す。
