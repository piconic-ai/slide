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

トップページ（`/`）と `/robots.txt` 以外には `X-Robots-Tag: noindex, nofollow` を付ける。`/robots.txt` は `/api/`、`/auth/`、`/decks`、`/uploads/` を disallow にする。robots.txt はクロールを減らすためのもので、検索結果に出さない保証ではない。管理画面が検索に出ないのは、ログインが必要なためである。

content domain の応答は対象外とする。deployment ごとの origin のヘッダーは [公開管理の実装設計](f02-publication.md) で扱う。`public/` の静的ファイルは Worker を通らずに返るため、このヘッダーは付かない。

## リクエスト頻度の上限

`src/site/rate-limit.ts` が、handler が D1・R2 に触れる前に、接続元 IP（`CF-Connecting-IP`）ごとの頻度を Workers の Rate Limiting binding で数える。上限を超えた request には `429` と `Retry-After: 60` を返す。`/api/` は `{ "error", "code": "rate_limited" }` の JSON、それ以外は text で返す。IPv6 の接続元は、アドレス単位ではなく /64 単位で数える。アップロードの CLI は 429 を受けると、`Retry-After` の秒数（最大 120 秒）だけ待ってから再送する。

| 対象 | binding | 1 分あたりの上限 |
| --- | --- | --- |
| `/auth`（ログイン） | `AUTH_RATE_LIMITER` | 30 |
| `/api/uploads` と `POST /api/decks/:deck/uploads` | `UPLOAD_RATE_LIMITER` | 600 |
| それ以外の `/api/` と `/decks` | `MANAGEMENT_RATE_LIMITER` | 120 |

アップロードはファイルごとに 1 request を送るため、最大のファイル数（500）の deployment を 1 分で送れる上限にした。トップページ、`/robots.txt`、`/uploads/:id` の状態確認ページは数えない。

上限は `wrangler.jsonc` の `ratelimits` で変える。binding は Cloudflare の拠点ごとに数えるため、正確な上限ではなく、乱用を止める目安として使う。`CF-Connecting-IP` のない request は、ローカルの開発やテストからのものとみなし、数えない。インターネットから届く request には Cloudflare が必ずこの header を付け、利用者は書き換えられない。将来、Service binding など Worker 間の呼び出しを加える場合は、この扱いを見直す。

## エラーページとメンテナンス

管理 origin のエラーは、`src/site/errors.ts` がまとめて返す。どれも `Cache-Control: no-store` を付ける。

| 状況 | ページ | `/api/` |
| --- | --- | --- |
| 存在しない path | `404`、「ページが見つかりません」 | `{ "error": "Not found", "code": "not_found" }` |
| 想定していない例外 | `500`、「エラーが発生しました」 | `{ "error": "Internal error; retry later", "code": "server_error" }` |
| メンテナンス中 | `503`、「メンテナンス中です」、`Retry-After: 300` | `{ "error": "Under maintenance; retry later", "code": "maintenance" }` |

ページは外部の資源を読み込まず、厳しい CSP を付ける。想定していない例外は、内容に request の値が入ることがあるため、例外の名前だけを log に残す。handler が意図して投げた `HTTPException`（`401` など）は、その応答をそのまま返す。deck 固有の 404 や、アップロード API のエラーは、各 route が自分の形で返す。

メンテナンスは、secret `MAINTENANCE` に `on` を入れると始まり、消すと終わる。secret の変更は、build や deploy を伴わずに反映される。メンテナンス中は、管理画面・API・アップロードがすべて `503` を返す。アップロードの CLI は `5xx` を一時的な失敗として数回再送し、それでも終わらなければ失敗する。

```sh
pnpm exec wrangler secret put MAINTENANCE   # 値に on を入力する
pnpm exec wrangler secret delete MAINTENANCE
```

content domain での配信は、メンテナンスの対象にしない。存在しない deck と公開停止中の deck を同じ表示にするのは、配信側（F02）で扱う。
