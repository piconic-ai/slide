# AI エージェントから置くための実装設計

[AI エージェントから置く](../features/f23-agent-upload.md)を実装するための契約。slide が MCP サーバーを `/mcp` で提供し、接続の許可を OAuth で行う。受け取りは、[ドロップして置くための実装設計](f22-browser-drop.md)の「開始、ファイルごとに送る、確定」をそのまま使う。

状態: 実装中(2026-11-20)。下の「PR の分け方」の 8 まで実装済みである。認可、`/mcp`、`list_slides`、`get_status`、`replace_slide`、`begin_upload`、`finish_upload`、プレビューの入口、設定ページは実装と合っている。新しいスライドを作る `put_slide` と、`begin_upload` で新しいスライドを始めることは、[ドロップして置くための実装設計](f22-browser-drop.md)の「新しいスライドの開始」が入ってから作る設計である。

## 読んだ文書と、そこから決めたこと

実装の前に、現行の文書を読んで方式を決めた(2026-11-20 に読んだ)。記憶では決めていない。

| 読んだもの | わかったこと |
| --- | --- |
| [MCP の仕様 2026-07-28: Streamable HTTP](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http) | 現行の版は 2026-07-28。MCP の経路は POST だけを受ける 1 つの URL。要求ごとに、1 つの JSON か、その要求だけの SSE で答える。`initialize` の手順、session(`Mcp-Session-Id`)、GET の stream はなくなった。古い手順の client から GET・DELETE が来たら 405 を返す。`Origin` を検査する |
| [同: 版の決め方と互換](https://modelcontextprotocol.io/specification/2026-07-28/basic/versioning) | 要求ごとに版を名乗る。2025-11-25 以前の client(`initialize` で始める)にも答える「両対応」のサーバーにしてよい |
| [同: 認可](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization) | MCP サーバーは OAuth 2.1 の resource server。Protected Resource Metadata(RFC 9728)は必須。token は `Authorization: Bearer` だけで受け、自分宛て(audience)であることを確かめる。無効な token には 401 を返す |
| [同: 認可サーバーの見つけ方](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization/authorization-server-discovery) | 401 の `WWW-Authenticate` に `resource_metadata` を入れる。metadata は `/.well-known/oauth-protected-resource/mcp` に置く。認可サーバーの metadata(RFC 8414)は `/.well-known/oauth-authorization-server` |
| [同: client の登録](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization/client-registration) | 登録の方法は 3 つ。Client ID Metadata Documents(CIMD。認可サーバーは SHOULD)、事前の登録、Dynamic Client Registration(DCR、RFC 7591。MAY。非推奨だが、互換のために残っている)。client は、CIMD が使えなければ DCR に落ちる |
| [同: 認可の安全](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization/security-considerations) | PKCE(S256)は必須。redirect URI は登録した値と完全に一致させる。redirect URI は `localhost` か HTTPS。公開 client の refresh token は、使うたびに取り替える。access token は短命にする |
| [Cloudflare: MCP の認可](https://developers.cloudflare.com/agents/model-context-protocol/authorization/) | Cloudflare の標準は `@cloudflare/workers-oauth-provider`。認可サーバーは KV の namespace(`OAUTH_KV`)を要る。CIMD を受けるなら `global_fetch_strictly_public` の flag も要る |
| [Cloudflare: MCP の transport](https://developers.cloudflare.com/agents/model-context-protocol/transport/) | 標準は `createMcpHandler`。サーバーそのものは、公式 SDK(`@modelcontextprotocol/server`)の `McpServer` で作る。`McpAgent` は非推奨 |
| [`@cloudflare/workers-oauth-provider` 1.2.4 の README](https://github.com/cloudflare/workers-oauth-provider) と、配布物の型定義 | 保存先は KV だけで、D1 に差し替える口はない |
| [`@modelcontextprotocol/server` 2.4.0](https://www.npmjs.com/package/@modelcontextprotocol/server) の配布物の型定義 | `createMcpHandler(factory)` が、Web 標準の `Request` を受けて `Response` を返す。2026-07-28 の要求にも、2025 年の版の要求(状態を持たない形で)にも、同じ道具の定義で答える。token の検証はしない(呼ぶ側が済ませて `authInfo` で渡す)。workerd 用の入口を持つ |
| [Better Auth: MCP plugin](https://www.better-auth.com/docs/plugins/mcp)、[OAuth Provider plugin](https://www.better-auth.com/docs/plugins/oauth-provider) と、`@better-auth/mcp`・`@better-auth/oauth-provider` 1.7.18 の配布物 | Better Auth 本体には、もう MCP や OIDC provider の plugin は入っていない。別の package(`@better-auth/mcp`)になっていて、1.7.18 の版があり、このリポジトリの `better-auth` 1.7.18 と組める。D1 だけで動く。ただし下の理由で採らない |

### 方式

| 部分 | 決めたこと |
| --- | --- |
| MCP の経路 | 公式 SDK の `createMcpHandler` を `/mcp` に置く。設定は SDK の既定のままにする。2026-07-28 の要求には 1 つの JSON で答え、2025 年の版の client(`initialize` で始める)には、状態を持たない形で、その要求だけの SSE で答える。要求ごとにサーバーを作るので、Durable Object は使わない |
| 認可サーバー | slide 自身が、D1 の上に小さな OAuth 2.1 の認可サーバーを持つ(`src/mcp/`)。authorization code と PKCE(S256)、公開 client だけ、refresh token の取り替え、DCR |
| 本人確認 | 認可の画面(`/oauth/authorize`)だけが、既存のログイン(Better Auth の session cookie)を読む。GitHub でのログインと、その設定は変えない |
| 保存 | D1 の表 3 つ(migration `0033`)。token と code は SHA-256 の hash だけを保存する |
| 新しい binding、secret、`wrangler.jsonc` の変更 | なし |

### 採らなかった案

- **`@cloudflare/workers-oauth-provider`。** Cloudflare の標準だが、KV の namespace が要る。binding を足すと、本番に資源を作る操作が要る。D1 だけで済む案があるので、採らない。Worker の入口全体を包む作りで、いまの `server.tsx`(host ごとに app を分ける)とも合わせにくい。
- **`@better-auth/mcp`(OAuth Provider plugin)。** D1 だけで動くが、次の点が合わない。
  - 表が 7 つ(client の表だけで 30 列を超える)と、OIDC、client credentials、管理用の経路など 20 を超える経路が付く。F23 が要るのは、そのごく一部である。このリポジトリは、Better Auth の経路を公開せず、必要な 1 つ(GitHub の callback)だけを自分の経路から呼んでいる。
  - access token は、既定では JWT で、`/jwks` を自分で取りに行って検証する。取り消しを「次の要求から」効かせるには、要求のたびに D1 を見る形へ作り替える必要がある。
  - token は、ブラウザの session に結び付く(plugin の schema の注記)。このサービスの session は 12 時間で切れ、1 人に 1 つである。エージェントの接続が、ブラウザのログインに引きずられる。
  - 「最後に使った日」を持たない。
- **`agents` の `createMcpHandler`・`McpAgent`。** `agents` は Durable Object を前提にした package で、依存が大きい。同じ名前の `createMcpHandler` が公式 SDK にあり、こちらは依存が `zod` と SDK の core だけである。

自前の認可サーバーは、検査を自分で持つことになる。範囲を、仕様が必須とするものに絞り、下の「守り」を 1 つずつテストで確かめる。

### 足す依存

| package | 理由 |
| --- | --- |
| `@modelcontextprotocol/server` 2.4.0(版を固定) | MCP の公式 SDK。JSON-RPC、版の判定、2 つの時代の client への答え方、道具の引数の検査を任せる。自分で書くと、仕様の版が変わるたびに追うことになる |
| `@modelcontextprotocol/client` 2.4.0(版を固定、開発用) | 公式 SDK の client。テストで、実際の MCP の要求を Worker に送るために使う。Worker には入らない |

## 経路

すべて管理 origin(`PUBLIC_ORIGIN`)だけにある。

| 経路 | 認可 | 動作 |
| --- | --- | --- |
| `POST /mcp` | access token | MCP の要求に答える |
| `GET /mcp`、`DELETE /mcp` | なし | 405 |
| `GET /.well-known/oauth-protected-resource/mcp`、`GET /.well-known/oauth-protected-resource` | なし | Protected Resource Metadata |
| `GET /.well-known/oauth-authorization-server` | なし | 認可サーバーの metadata |
| `POST /oauth/register` | なし | client を登録する(DCR) |
| `GET /oauth/authorize` | 作者の session | 許可の画面を出す |
| `POST /oauth/authorize` | 作者の session、CSRF | 許可または拒否を受けて、client の redirect URI へ送る |
| `POST /oauth/token` | code と PKCE、または refresh token | access token と refresh token を出す |
| `POST /settings/agents/:id/revoke` | 作者の session、CSRF | 接続を取り消す |

cookie を読むのは、`/oauth/authorize` と `/settings/agents/…` だけである。`/mcp`、`/oauth/token`、`/oauth/register`、metadata は cookie を読まない(F23 の「MCP の経路は cookie を読まない」)。経路のファイルを分けて、混ざらないようにする(`oauth-consent-routes.ts` と、それ以外)。

### metadata

`GET /.well-known/oauth-protected-resource/mcp` の応答:

```json
{
  "resource": "https://slide.community/mcp",
  "authorization_servers": ["https://slide.community"],
  "bearer_methods_supported": ["header"],
  "scopes_supported": ["slides:upload"]
}
```

`GET /.well-known/oauth-authorization-server` の応答:

```json
{
  "issuer": "https://slide.community",
  "authorization_endpoint": "https://slide.community/oauth/authorize",
  "token_endpoint": "https://slide.community/oauth/token",
  "registration_endpoint": "https://slide.community/oauth/register",
  "response_types_supported": ["code"],
  "grant_types_supported": ["authorization_code", "refresh_token"],
  "code_challenge_methods_supported": ["S256"],
  "token_endpoint_auth_methods_supported": ["none"],
  "scopes_supported": ["slides:upload"],
  "authorization_response_iss_parameter_supported": true
}
```

origin は `PUBLIC_ORIGIN` から作る。要求の `Host` からは作らない。

## 認可の流れ

1. エージェントが、token なしで `POST /mcp` を呼ぶ。401 と `WWW-Authenticate: Bearer resource_metadata="…/.well-known/oauth-protected-resource/mcp", scope="slides:upload"` が返る(F23-AC1)。
2. エージェントが metadata を読み、`POST /oauth/register` で自分を登録する。
3. エージェントが、作者のブラウザで `GET /oauth/authorize?response_type=code&client_id=…&redirect_uri=…&code_challenge=…&code_challenge_method=S256&state=…&resource=…` を開く。
4. ログインしていなければ、要求を cookie に預けて(下の「ログインをはさむ」)、GitHub でのログインへ送る。戻ると、同じ許可の画面になる。
5. 許可の画面は、できることを 1 文で出す。「このエージェントは、あなたのスライドを置くことと、差し替えることができます。公開はできません。」その下に、エージェントが名乗っている名前と、許可したあとの戻り先の host を、同じ強さで並べる。名前は client が自分で付けたものなので、見出しには入れず、slide が確かめていないことを 1 文で添える。
6. 「許可する」を押すと、code を作って、`redirect_uri?code=…&state=…&iss=…` へ 303 で送る。「許可しない」は `error=access_denied` を付けて送る。
7. エージェントが `POST /oauth/token` で code を token に替える。以後、`Authorization: Bearer <access token>` で `/mcp` を呼ぶ(F23-AC2)。

### client の登録(DCR)

`POST /oauth/register` は JSON を受ける。読むのは `client_name` と `redirect_uris` だけで、ほかの項目は無視する。

- `redirect_uris` は 1〜5 個。それぞれ、`https:` か、loopback(`localhost`、`127.0.0.1`、`[::1]`)の `http:`。fragment、userinfo を持つものは断る。500 文字まで。
- `client_name` は 1〜60 文字。なければ、`redirect_uris` の最初の host を名前にする。制御文字は断る。名前は画面に出すので、出すときにエスケープする。
- client は、すべて公開 client である(`token_endpoint_auth_method: "none"`)。client secret は出さない。
- 応答は 201 と、`client_id`、`client_name`、`redirect_uris`、`token_endpoint_auth_method`、`grant_types`、`response_types`。
- だれでも呼べるので、IP ごとの上限(既存の `AUTH_RATE_LIMITER`)をかけ、本文は 4KB までにする。1 行は 3KB ほどに収まる。まだ接続に使われていない client は、全体で 1,000 件までしか持たない。超えている間の登録は、503 と `Retry-After` で断る(件数の条件は INSERT の文に含める)。
- 掃除は、登録のたびに行う。1 度も接続に使われないまま 1 時間たった client を消す。接続に使われたことのある client は、最後に接続を作った、または token を取り替えた時刻(`used_at`)から 90 日は残す。作者が接続を取り消したあとも、エージェントが保存した `client_id` でつなぎ直せるようにするためである。掃除の DELETE は、索引(`used_at`、`created_at`)を引く。
- 消えた `client_id` で `POST /oauth/token` を呼ぶと、401 と `invalid_client` を返す。client は、これを受けて登録し直す。

CIMD(URL の形の `client_id`)は、最初の範囲では受けない。受けるには、Worker から任意の HTTPS の URL を取りに行くことになり、Cloudflare は `global_fetch_strictly_public` の flag を求めている。metadata に `client_id_metadata_document_supported` を出さないので、client は DCR を使う。後に回す(下の「後に回すこと」)。

### 許可の要求の検査

`GET /oauth/authorize` は、次を順に確かめる。どれかが合わないときは、どこにも redirect せずに、slide の 400 の画面で伝える。client はだれでも、どんな `redirect_uri` でも登録できるので、誤った要求を `redirect_uri` へ送り返すと、リンクを開いただけの人を、送り手の選んだサイトへ送る口になる(RFC 9700 の 4.11.2)。`redirect_uri` へ送るのは、作者が画面で答えたとき(許可の `code`、「許可しない」の `access_denied`)だけである。どちらの経路も、D1 を読む前に、IP ごとの上限(`AUTH_RATE_LIMITER`)を数える。

| 項目 | 条件 |
| --- | --- |
| `client_id` | 登録されている |
| `redirect_uri` | 登録した値のどれかと完全に一致する。loopback の host に限り、port の違いは許す(OAuth 2.1 の 8.4.2。native の client は、起動のたびに port が変わる) |
| `response_type` | `code` |
| `code_challenge`、`code_challenge_method` | 43〜128 文字の base64url、`S256`。`plain` は断る |
| `resource` | あれば、`<PUBLIC_ORIGIN>/mcp` と一致する。なければ、それとして扱う |
| `scope` | 読まない。出すのは常に `slides:upload` |
| `state` | あれば、そのまま返す。512 文字まで |

`POST /oauth/authorize` は、フォームで同じ項目を受け取り、同じ検査をやり直す。画面に埋めた値を信用しない。既存のフォームと同じ `csrf()` を通す。許可の画面の CSP の `form-action` は、`'self'` と、その要求の `redirect_uri` の origin だけにする(ブラウザは、フォームの送信に続く redirect にも `form-action` を当てる)。

### ログインをはさむ

`/oauth/authorize` に来た人がログインしていないとき、検査を通った要求の query を、cookie `__Host-slide_authorize`(HttpOnly、Secure、SameSite=Lax、10 分)に預けて、`/auth/github?to=agent` へ送る。ログインの戻り先(`src/auth/landing.ts` の `landingOf`)に、`agent` → `/oauth/authorize` を 1 つ足す。query のない `GET /oauth/authorize` は、cookie の query を読み、同じ検査を通して、許可の画面を出す。cookie は、読んだら消す。

戻り先に query そのものを渡さないのは、Better Auth が戻り先の文字を制限していて、`state` や `redirect_uri` の中身によっては通らないためである。

登録されていない人は、既存のログインが断る(`/auth/invitation-only`)。許可の画面までは来ない。停止中の人には、既存の停止の画面が出る。

### token

| もの | 形 | 期限 | 保存 |
| --- | --- | --- | --- |
| code | 乱数 32 byte の base64url | 60 秒、1 回だけ | hash |
| access token | `slide_at_` と乱数 32 byte の base64url | 1 時間 | hash |
| refresh token | `slide_rt_`、接続の ID、`.`、乱数 32 byte の base64url | 最後に取り替えてから 90 日 | hash |

- hash は SHA-256。token は 256 bit の乱数なので、salt や遅い hash は要らない。平文は、応答で 1 度渡すだけで、D1 にもログにも残さない。
- `POST /oauth/token` は `application/x-www-form-urlencoded` を受ける。`grant_type=authorization_code` は、`code`、`client_id`、`redirect_uri`、`code_verifier` を確かめる。code は、条件を付けた 1 つの `DELETE … RETURNING` で取り出すので、2 度は使えない。`resource` があれば、`<PUBLIC_ORIGIN>/mcp` と一致することを確かめる。
- `grant_type=refresh_token` は、refresh token が名指す接続の token を、hash が今のものと合うときだけ、条件を付けた 1 つの UPDATE で取り替える。接続はあるのに hash が合わないとき、つまり、以前に取り替えた token(何世代前でも)や、その接続のものでない token が届いたときは、盗まれたものとして、その接続を消す(OAuth 2.1 の 4.3.1)。token に接続の ID を入れているのは、取り替えた token の hash を残さずに、これを見分けるためである。ID だけでは何も開かない。
- 誤りは、RFC 6749 の形(`{"error": "invalid_grant"}` など)で 400 を返す。応答には `Cache-Control: no-store` を付ける。
- 発行のときに、登録された作者かどうかは見ない。見るのは、道具を呼んだときである(下の「道具が断るとき」)。

### `/mcp` での検査

1. `Origin` があり、`http:` か `https:` で、`PUBLIC_ORIGIN` と違えば 403。`/mcp` は cookie を読まないので、ほかのサイトのページから呼ばれても、作者の権限は使えない。そのうえで、ブラウザの中のページからの呼び出しは受けない。
2. `GET`、`DELETE` は 405。
3. IP ごとの上限(既存の `UPLOAD_RATE_LIMITER`)を超えていれば 429。
4. 本文を 3MB まで読む。JSON でなければ 400、JSON-RPC の配列(batch)なら 400。上限は要求を数えるので、1 つの要求には 1 つの message だけを受ける(2025-06-18 の版から、batch はない)。
5. `Authorization: Bearer` の token の hash で、接続を引く。なければ、または期限が切れていれば、401 と `WWW-Authenticate`(`error="invalid_token"` を添える)。取り消した接続は行がないので、次の要求から 401 になる(F23-AC11)。
6. 接続の「最後に使った日」を、1 時間より古いときだけ書き換える。
7. 要求ごとに、接続の持ち主(GitHub の user ID)のための `McpServer` を作り、`createMcpHandler` に渡す。

## 道具

| 道具 | 引数 | 動作 |
| --- | --- | --- |
| `list_slides` | なし | 自分のスライドの一覧。URL の名前、題名、公開中かどうか、1 本の管理ページの URL、公開中なら共有 URL |
| `put_slide` | `files`(`path` と `text` の組)、`title`(任意) | 新しいスライドを作って置く。小さな HTML 用 |
| `replace_slide` | `slide`(URL の名前)、`files` | 自分のスライドに、新しい版を置く。小さな HTML 用 |
| `begin_upload` | `slide`、`files`(`path`、`size`、`sha256` の組) | 大きいもののための開始。ファイルごとの送り先と、一時の資格情報を返す。新しいスライドのための開始は、`put_slide` といっしょに足す |
| `finish_upload` | `uploadId`、`credential` | 大きいもののための確定 |
| `get_status` | `slide` | 公開中かどうか、いちばん新しい受け取りの状態 |

D-61 の 4 種類(一覧、新しく置く、差し替える、状態を見る)のうち、「新しく置く」と「差し替える」に、大きいもののための `begin_upload`・`finish_upload` が付く。公開する、公開を止める、削除する、URL の名前を変える、設定を変える道具は作らない。受け取りの処理は `decks` の公開の列に書き込まないので、どの道具も公開中の版を変えない(F23-AC3、F23-AC9)。

### 引数で受け取る(`put_slide`、`replace_slide`)

1. `path` を、内容を読む前に、既存の検査(`parseInventoryStructure`)に通す。`..`、空の区切り、重複、受け付けない種類の path は、ここで断る。
2. `files` の `text` を UTF-8 の byte にし、合計が 1MB(1,048,576 byte)を超えたら、受け取らずに、`begin_upload` を使うように伝える(F23-AC6)。
3. HTML の文書に、ページを伝える script の 1 行を足す。処理は `scripts/page-script.mjs` の `withPageScript` を共有する(D-14)。既に読み込んでいれば足さないので、1 つだけになる(F23-AC12)。
4. 足したあとの byte で、`path`、`size`、SHA-256 の一覧を作る。
5. `startUpload`(`source: 'mcp'`)で開始する。`attempt` は、呼び出しごとにサーバーが作る。
6. 既存の送信と確定の経路(`uploadsApi`)を、開始が返した資格情報で、Worker の中から呼ぶ。HTTP は通さないが、経路の検査(hash、lease、持ち主の確かめ直し)はすべて通る。
7. 1 本の管理ページの URL、プレビューの URL、次に人がすることを返す。

### 大きいもの(`begin_upload`、`finish_upload`)

`begin_upload` は、`startUpload` の応答から、次を返す。

```json
{
  "uploadId": "…",
  "credential": "…",
  "credentialExpiresAt": 1763600000,
  "files": [
    {
      "path": "index.html",
      "method": "PUT",
      "url": "https://slide.community/api/uploads/…/files/0"
    }
  ],
  "headers": { "Authorization": "Bearer …" },
  "next": "PUT the exact bytes of each file to its url …"
}
```

エージェントは、ファイルを `PUT` で送り、`finish_upload` を呼ぶ。資格情報の期限(1 時間)と範囲(その受け取りだけ)は、既存の受け取りと同じである。期限の切れた資格情報では送れない(F23-AC7)。

この道では、エージェントが byte を直接送るので、サーバーは script の 1 行を足せない(送る前に SHA-256 を名乗るため)。道具の説明と `begin_upload` の応答で、`index.html` の `</head>` の前に `<script src="/_preview/pages.js"></script>` を入れてから hash を取るように伝える。入っていなくても受け取る(ページを伝える script のない HTML も、そのまま表示するため)。

### 返すもの

置いた、または確定した道具は、次を返す(D-63)。`content` の文と、同じ内容の `structuredContent` の両方に入れる。

| 項目 | 内容 |
| --- | --- |
| `manageUrl` | 1 本の管理ページ(`/slides/<slug>`) |
| `previewUrl` | 作者だけが見られるプレビュー(`/slides/<slug>/deployments/<id>/preview`) |
| `visibility` | `private`(置いた版は、作者だけが見られる) |
| `nextStep` | 「このページで表示を確かめて、公開を押してください」に当たる英語の文。エージェントが、作者の言葉に直して伝える |

作者だけのプレビューは、いまは 1 本の管理ページのボタン(`POST /slides/:deck/deployments/:id/preview`)でしか開けず、リンクにできる URL がない。同じパスに `GET` を足し、「プレビューを開く」のボタン 1 つの画面を出す。ボタンは、既存の POST に送る。GET は何も発行しない。作者の session がなければ、ログインの案内を出す。

### 道具が断るとき

道具の中の誤りは、HTTP の誤りにせず、`isError: true` の結果で、理由の文と `code` を返す。エージェントが、作者に理由を伝えられるようにするためである。

| 場合 | `code` |
| --- | --- |
| 持ち主が、登録された作者でない、または停止中 | `not_allowed` |
| 指定したスライドがない、またはほかの人のもの(見分けられない。F23-AC8) | `unknown_slide` |
| 引数の合計が 1MB を超える | `too_large_for_arguments` |
| 一覧が不正(path、重複、種類、`index.html` がない) | `invalid_files` |
| 上限(ファイルの数、大きさ、作者の容量、1 日の回数、スライドの本数) | 既存の理由(`too_many_files` など)、`deck_limit` |
| ほかの受け取りが、ちょうどファイルを受信している(lease を持っている) | `upload_busy` |
| `finish_upload` に、自分のものでない受け取りを指定した(見分けられない) | `unknown_upload` |
| 確定のときに、届いていないファイルがある | `files_missing`(足りない path を添える) |
| 資格情報が違う、または期限が切れた | `credential_expired` |

同時に開いておける受け取りは、作者 1 人につき 1 つである([ドロップして置くための実装設計](f22-browser-drop.md)の「途中で止まった受け取り」)。道具は、呼び出しごとに新しい `attempt` で始めるので、ブラウザの 2 回目の開始と同じ規則になる。ファイルとファイルの間で止まっている受け取り(ブラウザのもの、ほかのエージェントのもの)は、後から始めた方が入れ替える。受信中のものは残し、道具は `upload_busy` を返す。2 つの送り手がやり直し合うと、1 日の開始の回数(`startsPerDay`)を使い切る。道具の説明に、このことを書いている。

登録と停止は、道具を呼ぶたびに確かめる(F23-AC10)。`startUpload` も、同じことを中で確かめる。

### 道具の説明

エージェントが読む説明(英語)に、次を書く。できること(置く、差し替える、一覧、状態)。できないこと(公開、公開の停止、削除。公開は作者がブラウザで押す)。上限(1 つの版 10MB、1 ファイル 5MB、100 ファイル)。zip ではなく、ファイルの一覧で渡すこと。入口は `index.html` であること。

## 保存

migration `0033` で、表を 3 つ足す。既存の表は変えない。

| 表 | 列 | 役割 |
| --- | --- | --- |
| `mcp_clients` | `id`(`client_id`)、`name`、`redirect_uris`(JSON)、`created_at`、`used_at` | 登録された client。`used_at` は、接続を作った、または token を取り替えた最後の時刻 |
| `mcp_codes` | `code_hash`、`client_id`、`owner_user_id`、`redirect_uri`、`code_challenge`、`expires_at` | まだ token に替えていない code |
| `mcp_grants` | `id`、`client_id`、`owner_user_id`、`access_token_hash`、`access_expires_at`、`refresh_token_hash`、`refresh_expires_at`、`created_at`、`last_used_at` | 接続。1 行が、設定ページの 1 行になる |

- `owner_user_id` は GitHub の user ID で、`decks.owner_user_id` と同じものである。`accounts.user_id` を外部キーで参照し、`ON DELETE CASCADE` にする。退会の処理は `accounts` の行を消すので、その人の code と接続もいっしょに消える。退会の処理には手を入れない。
- ハンドルがまだ決まっていない人(`accounts` の行がない)は、許可の画面で、ハンドルが要ることを伝えて止める。
- `mcp_codes` と `mcp_grants` は、`mcp_clients` も外部キーで参照し、client を消すと消える。
- 期限の切れた code と接続は、登録と token の経路が、ついでに消す。cron は足さない。

## 設定ページ

`settingsAgentFrame`(`src/site/settings-agent-frame.ts`)に、次を出す(D-65)。

- 説明の 1 段落と、「MCP サーバーの URL」(`<PUBLIC_ORIGIN>/mcp`)、「コピー」のボタン。コピーは `public/share.js` の既存の処理(`data-copy`)を使う。
- 接続済みのエージェントの一覧。名前、接続した日、最後に使った日(`src/share/dates.ts` の書式。使う前は「まだ使っていません」)、「接続を取り消す」のボタン。1 件もなければ、その旨の 1 文。refresh token の期限が切れた接続は出さない。幅が狭いときは、名前と日付の下にボタンを置く。
- 「接続を取り消す」は `POST /settings/agents/:id/revoke`。持ち主が本人の接続だけを消し、303 で `/settings#agents` へ戻る。接続の行に access token と refresh token の hash があるので、どちらの token も、次の要求から通らない。あわせて、その作者の、エージェントが始めて確定していない受け取り(`source` が `mcp` で `uploading`)を `expired` にする。`begin_upload` が返した資格情報は接続とは別のもので、そのままでは最長 1 時間通るためである。どの接続が始めた受け取りかは記録していないので、その作者のエージェントの受け取りを、すべて止める。

## 守り

| 守ること | どう守るか | テスト |
| --- | --- | --- |
| token は hash で保存する | 表に平文の列がない。発行の直後に、表のどの列にも平文がないことを確かめる | store のテスト |
| MCP の経路は cookie を読まない | 作者の session cookie だけを付けた `/mcp` の要求が 401 になる | routes のテスト |
| 本人のスライドだけ | スライドは、token の持ち主の slug として引く(`resolveDeck`) | ほかの人のスライドを指定して `unknown_slide` |
| 公開・停止・削除の道具がない | 道具の一覧を固定の名前と比べる | 道具の一覧のテスト、実際の client での一覧 |
| 信頼できない入力 | path は既存の検査、題名と client の名前は出すときにエスケープ、HTML は別 origin の sandbox で配る(既存) | 空のファイル、`..`、重複、文字でない内容 |
| code の横取り | PKCE(S256)、60 秒、1 回だけ、`redirect_uri` の一致 | token の経路のテスト |
| ほかの宛先の token | このサーバーが出した token しか、表にない。`resource` が違う要求には出さない | 認可と token の経路のテスト |
| 開いた redirect | 登録した `redirect_uri` にしか送らない | 認可の経路のテスト |

## 確かめ方

- 純粋な処理(登録・許可・token の要求の検査、道具の引数の検査、返す文の組み立て)は Vitest。
- 経路と store は、ローカルの D1・R2 と、`server.fetch` を通す。
- 認可から道具の呼び出しまでは、ローカルで起動した Worker に、公式 SDK の client(`@modelcontextprotocol/client`)をつなぐ script で通す。許可の画面は、Playwright で実際に押す。MCP Inspector の CLI でも、道具の一覧と呼び出しを確かめる。
- 実際の AI エージェント(Claude Code、Claude のアプリ)からの接続と、本番の origin での認可は、人の確認に残す。

## PR の分け方

1. この文書。
2. 認可サーバー: migration `0033`、metadata、client の登録。
3. 許可の画面と code。
4. token の経路(code の交換、refresh token の取り替え)。
5. `/mcp` と、一覧・状態の道具。
6. 差し替え(引数)と、プレビューの入口。
7. 大きいもののための開始と確定。
8. 設定ページの一覧と取り消し。
9. 新しく置く(作業 A の「新しいスライドの開始」が `scope1` に入ってから)。

## 後に回すこと

- **CIMD。** 仕様は SHOULD。受けるには、外の URL を取りに行く処理と、その守り(`global_fetch_strictly_public`)が要る。DCR で、現行の client はつながる。
- **ブラウザの中で動く client。** CORS の header を出さないので、Web ページから直接は呼べない。
- **token の取り消しの経路(RFC 7009)。** 取り消しは、設定ページから行う。
- **`https` でも loopback でもない redirect URI。** `cursor://` のような、アプリ独自の scheme は受けない(仕様が、`localhost` か HTTPS に限っている)。こうした client は登録で断られる。
- **refresh の再送と、同時の refresh。** 取り替え済みの refresh token が届くと、盗まれたものとして接続を消す。client が、応答を受け取り損ねて同じ refresh token を送り直したときや、同じ認証情報を持つ 2 つのプロセスが同時に取り替えたときも、接続が消える(安全の側)。作者は、もう一度許可する。猶予の時間を置くかどうかは、実際の client の動きを見てから決める。
- **エージェントごとの登録の手順の案内。** F23 の未決事項。動かして確かめてから、ヘルプに書く。
