# 計測の設定の手順

[計測の実装設計](metrics.md)のうち、依頼者が行う設定です。エージェントは、Analytics Engine の dataset も、読み取り用のトークンも作りません(F40 の「作らないこと」)。

設定が無くても、サービスは今までどおり動きます。記録は何もせず、運営の画面の「計測」に「未設定」と出ます(D-08)。

## 1. Analytics Engine の dataset

`wrangler.jsonc` に、binding を書いてあります。

```jsonc
"analytics_engine_datasets": [{ "binding": "ANALYTICS", "dataset": "slide_events" }]
```

dataset は、Worker を deploy したあとの最初の書き込みで、自動で作られます。ダッシュボードで作る操作は要りません。deploy の前に、依頼者が行うことは無いので、**このスコープを本番に反映すると、記録が始まります**(記録は、プライバシーポリシーの範囲に収まるように作ってあります。[突き合わせた結果](metrics.md#プライバシーポリシーとの突き合わせf40-の-7)を先に読む)。

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

設計の文書([確かめられなかったこと](metrics.md#確かめた公式の文書2026-11-26))の 4 つを、トークンを環境変数に入れて、手で確かめます。

```sh
# 何が書かれているか(出来事ごとの推計の件数)
curl -sS "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/analytics_engine/sql" \
  -H "Authorization: Bearer $TOKEN" \
  --data "SELECT index1 AS event, SUM(_sample_interval) AS events FROM slide_events GROUP BY event FORMAT JSON"
```

- `data` の中の `events` が、数か、文字列か。
- 次の問い合わせで、日の幅が期待どおりに切れるか(UTC の 1 日)。

```sh
curl -sS "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/analytics_engine/sql" \
  -H "Authorization: Bearer $TOKEN" \
  --data "SELECT count() AS rows FROM slide_events WHERE timestamp >= toDateTime('2026-11-26 00:00:00') AND timestamp < toDateTime('2026-11-27 00:00:00') FORMAT JSON"
```

## 5. 個人を特定する値が入っていないことを確かめる

反映の後、実際の記録を 1 度見ます。次の結果に、IP アドレス、メールアドレス、利用者の番号が出てこないことを確かめます。

```sh
curl -sS "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/analytics_engine/sql" \
  -H "Authorization: Bearer $TOKEN" \
  --data "SELECT DISTINCT blob2 AS referrer FROM slide_events WHERE index1 = 'deck_opened' LIMIT 100 FORMAT JSON"
```

同じ形で、`blob1`(検索の語)を `index1 = 'help_search_empty'` で見ます。

## 6. 動いているかの見方

- cron の `metrics_copy`(20 時 UTC。日本の朝 5 時)のログ(`{"event":"cron_task","task":"metrics_copy",…}`)に、`ok` と写した行数が出る。失敗は、翌日のメールに入る(`cron_failed`)。
- 運営の画面の「計測」に、最後に写した日が出る。前の日になっていれば、動いている。
- 「未設定」が出るとき: 名前が出ている設定が足りない。上の 1 と 3 を見直す。

## 7. 止めたいとき

- 記録だけ止める: `wrangler.jsonc` から binding を消して deploy する。サービスは今までどおり動く。写した集計は残る。
- 集計だけ止める: `ANALYTICS_READ_TOKEN` を消す(`wrangler secret delete ANALYTICS_READ_TOKEN`)。
