# 計測の設定の手順

[計測の実装設計](metrics.md)のうち、依頼者が行う設定です。エージェントは、Analytics Engine の dataset も、読み取り用のトークンも作りません(F40 の「作らないこと」)。

設定が無くても、サービスは今までどおり動きます。記録は何もせず、運営の画面の「計測」に「未設定」と出ます(D-08)。

## 1. Analytics Engine の dataset

`wrangler.jsonc` に、binding を書いてあります。

```jsonc
"analytics_engine_datasets": [{ "binding": "ANALYTICS", "dataset": "slide_events" }]
```

dataset は、Worker を deploy したあとの最初の書き込みで、自動で作られます。dataset をダッシュボードで作る操作は要りません。

**反映の前に、ダッシュボードで Analytics Engine を有効にします(deploy が止まったとき)。** 本番のアカウントで Analytics Engine が有効でないと、`analytics_engine_datasets` の binding を足した Worker の deploy が失敗することがある(エラーコード 10089、「You need to enable Analytics Engine」と記憶している)。反映が止まったら、Cloudflare のダッシュボードで Analytics Engine を有効にして、もう一度反映する。

- **確かめられていない。** 2026-11-26 に、公式の文書の [Get started](https://developers.cloudflare.com/analytics/analytics-engine/get-started/)(「dataset をダッシュボードで作る必要は無い」と書いている)、[Pricing](https://developers.cloudflare.com/analytics/analytics-engine/pricing/)、[Workers のエラー](https://developers.cloudflare.com/workers/observability/errors/)を読んだが、有効にする操作も、エラーコード 10089 も、見つからなかった。有効にする画面の場所も、確かめられていない。上の記述は、記憶によるものである。
- 無効のまま deploy が止まっても、本番のコードは前の版のままで、害は無い。有効にしてから、同じ反映を行う。

**このスコープを本番に反映すると、記録が始まります**(記録は、プライバシーポリシーの範囲に収まるように作ってあります。[突き合わせた結果](metrics.md#プライバシーポリシーとの突き合わせf40-の-7)を先に読む)。

dataset の名前を変えるときは、`wrangler.jsonc` と、読む問い合わせの表の名前(`src/metrics/` の問い合わせ)を、同じ名前にそろえます。

## 2. 読み取り用のトークン

日ごとの集計(1 日 1 回)が、SQL API を呼ぶためのトークンです。

1. Cloudflare のダッシュボードで、アカウントの API トークンを作る(Manage Account > Account API Tokens > Create Token > Create Custom Token)。
2. 権限は 1 つだけ: **Account | Account Analytics | Read**。
3. 「Account Resources」は、slide のアカウントだけにする。IP アドレスの制限と有効期限は、決めてよい(文書では任意)。期限を付けたら、切れる前に作り直す日を決める。切れると、集計が止まり、運営の画面の最後に写した日が古いままになる。

文書: [SQL API](https://developers.cloudflare.com/analytics/analytics-engine/sql-api/)(2026-11-26 に確かめた)。

## 3. 登録する

どちらも secret として登録します(`wrangler.jsonc` に書かない。アカウントの番号は秘密ではないが、設定を 1 か所にそろえるため)。

```sh
wrangler secret put ANALYTICS_READ_TOKEN
wrangler secret put ANALYTICS_ACCOUNT_ID
```

- `ANALYTICS_ACCOUNT_ID`: 32 文字のアカウントの番号。
- 値は、ターミナルの履歴や、リポジトリの `.dev.vars` に残さない。手元で動かすときは、読み取りの通信が起きない(模擬のみ)ので、登録は要らない。
- どちらかが無いと、日ごとの集計は何もせず、運営の画面に「未設定」が出ます。

## 4. 最初に 1 度、実際の API で確かめる

設計の文書([確かめられなかったこと](metrics.md#確かめた公式の文書2026-11-26))の 4 つを、手で確かめます。トークンの渡し方は、次の「確かめる前の準備」に従います。

### 確かめる前の準備

アカウントの番号は、`wrangler.jsonc` の `account_id` から取ります。

```sh
ACCOUNT_ID=$(grep -o '"account_id": *"[^"]*"' wrangler.jsonc | sed 's/.*: *"\(.*\)"/\1/')
```

読み取り用のトークンは、macOS のキーチェーンに置き、curl のコマンドの中で読みます(値をファイルにも変数にも残さない)。以降の例の `slide-analytics-token` は、例としてのサービス名です。各自がキーチェーンに付けたサービス名に読み替えます。

- `security find-generic-password … -w` は、初回に、キーチェーンの許可を求めるダイアログが出る。
- 必ず、コマンド置換 `$(…)` の中で使う。`echo` や `export` で、値を表示したり、環境に残したりしない。

### 問い合わせ

```sh
# 何が書かれているか(出来事ごとの推計の件数)
curl -sS "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/analytics_engine/sql" \
  -H "Authorization: Bearer $(security find-generic-password -s slide-analytics-token -w)" \
  --data "SELECT index1 AS event, SUM(_sample_interval) AS events FROM slide_events GROUP BY event FORMAT JSON"
```

- `data` の中の `events` が、数か、文字列か。
- 次の問い合わせで、日の幅が期待どおりに切れるか(UTC の 1 日)。

```sh
curl -sS "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/analytics_engine/sql" \
  -H "Authorization: Bearer $(security find-generic-password -s slide-analytics-token -w)" \
  --data "SELECT count() AS rows FROM slide_events WHERE timestamp >= toDateTime('2026-11-26 00:00:00') AND timestamp < toDateTime('2026-11-27 00:00:00') FORMAT JSON"
```

## 5. 個人を特定する値が入っていないことを確かめる

反映の後、実際の記録を 1 度見ます。次の結果に、IP アドレス、メールアドレス、利用者の番号が出てこないことを確かめます。

Analytics Engine の SQL API は、`SELECT DISTINCT` を受け付けません(`selection used unsupported features` で断られる。2026-11-27 に本番で確かめた)。値の一覧は、`GROUP BY` で取ります。

```sh
curl -sS "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/analytics_engine/sql" \
  -H "Authorization: Bearer $(security find-generic-password -s slide-analytics-token -w)" \
  --data "SELECT blob2 AS referrer, SUM(_sample_interval) AS opens FROM slide_events WHERE index1 = 'deck_opened' GROUP BY referrer ORDER BY opens DESC LIMIT 100 FORMAT JSON"
```

参照元(`referrer`)は、次の 3 種類になります。

- ホスト名。
- `internal`: サービスの中からの移動。
- 空: 参照元が分からない、または残さない。タイムラインのカードは同じサービスの中で開くので、ブラウザが参照元を送らず、空になることがある。

IP アドレス、メールアドレス、パスつきの URL が出たら、プライバシーの決まり違反です。

同じ形で、`blob1`(検索の語)を見ます。

```sh
curl -sS "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/analytics_engine/sql" \
  -H "Authorization: Bearer $(security find-generic-password -s slide-analytics-token -w)" \
  --data "SELECT blob1 AS term, SUM(_sample_interval) AS searches FROM slide_events WHERE index1 = 'help_search_empty' GROUP BY term ORDER BY searches DESC LIMIT 100 FORMAT JSON"
```

## 6. 動いているかの見方

- cron の `metrics_copy`(20 時 UTC。日本の朝 5 時)のログ(`{"event":"cron_task","task":"metrics_copy",…}`)に、`ok` と写した行数が出る。失敗は、翌日のメールに入る(`cron_failed`)。
- 集計が失敗しているとき、運営の画面の「最後に写した日」が古いままになり、ログに `metrics_day_failed` と出る。
- 運営の画面(`https://admin.slide.community/metrics`)の「計測」に、最後に写した日が出る。朝 5 時(日本時間)の集計のあとに出る。「最後に写した日」が前の日なら、動いている。
- 「未設定」が出るとき: 名前が出ている設定が足りない。上の 1 と 3 を見直す。

### タイムラインの記録の確かめ方(F40-AC26)

次の問い合わせで、`via` が `timeline` の行が出ることを確かめます。ページの `page`、ブログの `embed` とは別の行になります。

```sh
curl -sS "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/analytics_engine/sql" \
  -H "Authorization: Bearer $(security find-generic-password -s slide-analytics-token -w)" \
  --data "SELECT blob1 AS via, SUM(_sample_interval) AS opens, max(timestamp) AS last FROM slide_events WHERE index1 = 'deck_opened' AND timestamp > NOW() - INTERVAL '1' DAY GROUP BY via FORMAT JSON"
```

`opens` は、標本化を考慮した推計値で、実際の件数とは少し違うことがあります。

## 7. 止めたいとき

- 記録だけ止める: `wrangler.jsonc` から binding を消して deploy する。サービスは今までどおり動く。写した集計は残る。
- 集計だけ止める: `ANALYTICS_READ_TOKEN` を消す(`wrangler secret delete ANALYTICS_READ_TOKEN`)。
