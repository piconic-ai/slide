# サービスの基本の備え

本人以外に開く前に、一般的な Web サービスとして備えるものの実装をまとめる。slide 固有の機能ではなく、よくある既定値を採用する。進み具合は [#47](https://github.com/piconic-ai/slide/issues/47) のチェックリストで管理する。

## セキュリティヘッダーと検索エンジン

管理 origin のすべての応答に、`src/site/middleware.ts` が次のヘッダーを付ける。Hono の `secureHeaders` の既定値を使い、`X-Frame-Options` だけを `DENY` にした。

| ヘッダー | 値 | 理由 |
| --- | --- | --- |
| `Strict-Transport-Security` | `max-age=15552000; includeSubDomains` | HTTPS 以外で開かせない。preload には登録しない |
| `X-Content-Type-Options` | `nosniff` | 宣言と違う種類として解釈させない |
| `X-Frame-Options` | `DENY` | 管理画面を他のページに埋め込ませない |
| `Referrer-Policy` | `no-referrer` | deck の URL や ID を外部に送らない |
| `Cross-Origin-Opener-Policy` / `Cross-Origin-Resource-Policy` | `same-origin` | 他の origin から window や応答を参照させない |

`Content-Security-Policy` は各ページが自分の内容に合わせて付ける。共通の既定値は置かない。

トップページ（`/`）と `/robots.txt` 以外には `X-Robots-Tag: noindex, nofollow` を付ける。`/robots.txt` は `/api/`、`/auth/`、`/decks`、`/uploads/` を disallow にする。

content domain の応答は対象外とする。deployment ごとの origin のヘッダーは [公開管理の実装設計](f02-publication.md) で扱う。`public/` の静的ファイルは Worker を通らずに返るため、このヘッダーは付かない。
