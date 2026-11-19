# ドロップして置くための実装設計

[スライドを、ドロップして置く](../features/f22-browser-drop.md)を実装するための契約。受け取り(開始、ファイルごとに送る、確定)を GitHub から切り離し、ログイン中の作者の session で始める形にする。[AI エージェントから置く](../features/f23-agent-upload.md)も、同じ開始を呼ぶ。

状態: 設計(2026-11-20)。下の「PR の分け方」の順に実装する。実装した PR が、この文書の該当する節を実際に合わせて直す。

## 変えること、変えないこと

| 項目 | これまで | これから |
| --- | --- | --- |
| 開始の本人確認 | GitHub Actions の OIDC の token | ログイン中の作者の session(cookie)。MCP は、その認可で同じ関数を呼ぶ |
| スライド(deck)の作り方 | リポジトリの連携(`POST /slides/connect`) | 最初の受け取りの開始が、スライドも作る |
| 二重に受け取らないための鍵 | deck、repository、実行番号、attempt、一覧の digest | 送り手が決める `attempt`(下の「同じ内容を二重に受け取らない」) |
| 確定のあとの公開 | リポジトリに従う方式なら、workflow の指定どおりに公開する | 何もしない。公開と入れ替えは、作者が 1 本の管理ページで押す |
| ページを伝える script | uploader(`scripts/upload.mjs`)が足す | 送り手(ブラウザの JS、MCP の受け口)が足す。判定は同じ処理を共有する |

次のものは、そのまま使う。

- ファイルごとの送信(`PUT /api/uploads/:id/files/:fileId`)、確定(`POST /api/uploads/:id/finalize`)、状態(`GET /api/uploads/:id`)。一時の資格情報(Bearer)で認可する。
- 一覧の検査(`src/uploads/inventory.ts`)、上限(`src/uploads/limits.ts`)、開始の拒否の記録(`src/uploads/rejections.ts`)、容量の予約、受信の lease、R2 の checksum の検証、期限切れと orphan の掃除(`src/uploads/cleanup-store.ts`)。
- 確定のときに `index.html` から題名、説明、表紙を読むこと。
- 招待制(`AUTHOR_GITHUB_IDS`)と、アカウントの停止。

## 経路

| 経路 | 認可 | 動作 |
| --- | --- | --- |
| `POST /api/slides` | 作者の session | 新しいスライドを作り、その最初の受け取りを始める |
| `POST /api/slides/:deck/uploads` | 作者の session | 自分のスライド(`:deck` は slug)の、新しい版の受け取りを始める |
| `GET /api/uploads/:id` | 一時の資格情報 | 受け取りの状態と、ファイルごとの受領を返す |
| `PUT /api/uploads/:id/files/:fileId` | 一時の資格情報 | 1 ファイルを受け取る |
| `POST /api/uploads/:id/finalize` | 一時の資格情報 | 全ファイルを確かめ、版を `ready` にする |
| `POST /slides/:deck/slug` | 作者の session | 1 度も公開していないスライドの、URL の名前を変える(フォーム) |

開始の 2 つは、本文が JSON である。

```json
{
  "attempt": "k3Jx…(送り手が作る 16〜64 文字)",
  "entry": "index.html",
  "files": [{ "path": "index.html", "size": 1234, "sha256": "…" }],
  "name": { "title": "<title> の文字列", "fileName": "talk.zip" }
}
```

`name` は `POST /api/slides` だけが読む。URL の名前の元にするだけで、保存する題名は、これまでどおり確定のときに `index.html` から読む。

開始の応答は、これまでの受領票(`deploymentId`、`state`、`expiresAt`、`credentialExpiresAt`、`statusUrl`、`failureReason`、`files`)に、`credential`、`slug`、`manageUrl`(`/slides/<slug>`)を加えたものである。`commit` は返さない。送り手は、確定の応答が `ready` になったら `manageUrl` へ移る。

### 開始を 1 つの関数にする

本人確認(誰が、どの手段で)と、開始そのもの(一覧の検査、上限、session の作成、資格情報の発行)を分ける。開始は、次の入力を受け取る 1 つの関数にする(`src/uploads/api.ts` の `startUpload`)。

| 入力 | 内容 |
| --- | --- |
| `ownerUserId` | 作者の GitHub の user ID。呼ぶ側が、認可を済ませた値を渡す |
| `source` | `browser` か `mcp`。出どころとして版に記録する |
| `target` | `{ kind: 'new', name }`(新しいスライド)か `{ kind: 'version', deck }`(自分のスライドの slug) |
| `attempt`、`inventory` | 本文を解析した値 |

ブラウザの経路は、session と CSRF を確かめてから `source: 'browser'` で呼ぶ。作業 G の MCP の受け口は、OAuth の認可から `ownerUserId` を得て `source: 'mcp'` で呼ぶ。招待制、停止、上限の判定は関数の中にあるので、どちらの入口でも同じになる。

## 認可

- **開始。** `requireOwner`(`src/auth/owner-middleware.ts`)を通す。session が有効で、GitHub の user ID が `AUTHOR_GITHUB_IDS` にあり、停止中でないこと。ログインしていなければ 401。ログインはしているが登録から外された人には、403 と `code: invitation_only` を返し、送り手が招待制であることを伝える(F22-AC16)。
- **ほかの人のスライド。** `:deck` は、session の作者の slug として引く(`resolveDeck`)。ほかの人のスライドは見つからず、存在しないスライドと同じ 404 になる(F22-AC17)。
- **送信、確定、状態。** 一時の資格情報の hash が版の行と合うことに加えて、要求のたびに、スライドの持ち主がいまも登録された作者で、停止中でなく、スライドが削除待ちでないことを確かめる。登録から外す、停止する、スライドを消すと、発行済みの資格情報での送信も止まる。
- **GitHub の OIDC。** 検証の処理(`src/uploads/oidc.ts`)ごとなくす。`Authorization: Bearer <OIDC の token>` を開始に送っても、session がないので 401 になる(F22-AC18)。

一時の資格情報は、開始の応答でだけ渡す。有効期間は 1 時間(`credentialSeconds`)。ブラウザは、変数に持つだけで、URL、cookie、IndexedDB、`localStorage` に置かない。期限が切れたら、同じ `attempt` で開始をやり直すと、新しい資格情報に替わる(古いものは失効する)。

### CSRF

cookie で認可して書き込むのは、開始の 2 つと `POST /slides/:deck/slug` だけである。

- cookie は `SameSite=Lax` なので、ほかのサイトからの POST には付かない。
- 既存のフォームと同じ `csrf()`(`hono/csrf`)を通す。`Origin` と `Sec-Fetch-Site` が自分の origin を指さない要求を 403 にする。
- 開始は `Content-Type: application/json` だけを受け付け、それ以外は 415 にする。ほかの origin の script がこの型で送るには preflight が要り、CORS を許していないので届かない。`csrf()` が検査するのはフォームの型(`text/plain` など)だけなので、型を限って隙間をなくす。

送信、確定、状態は cookie を読まない。資格情報を知らないサイトからは呼べないので、CSRF の対象にならない。

## 同じ内容を二重に受け取らない

GitHub の実行番号の代わりに、送り手が `attempt` を作る。ブラウザは、ドロップ 1 回につき `crypto.randomUUID()` で 1 つ作り、その受け取りが終わるまで使い続ける。未ログインで預かったファイルには、預かるときに作った `attempt` をいっしょに保存する。

- 保存する鍵(`deployments.idempotency_key`)は、新しいスライドなら `new:<作者の ID>:<attempt>`、新しい版なら `<deck の ID>:<attempt>` にする。作者や deck をまたいで衝突しない。
- 同じ鍵の開始が来たら、新しい行を作らずに、同じ受け取りを続ける。資格情報を新しくし、受領済みのファイルを応答で示すので、送り手は残りだけを送る。新しいスライドの開始では、スライドも 2 つ目を作らない。
- 同じ鍵で、一覧の digest が違う開始は 409 `inventory_conflict` にする。ファイルを直して送り直すときは、送り手が新しい `attempt` を作る。
- 期限切れ(`session_expired`)や失敗(`session_failed`)の受け取りは続けられない。送り手は、新しい `attempt` で始める。

ページを 2 回読み込んで同じファイルを 2 回ドロップしたときは、`attempt` が違うので、スライドが 2 つできる。これは作者の操作どおりで、要らないほうは 1 本の管理ページで消せる。

## スキーマ

migration `0029` で、`deployments` から GitHub 由来の列を消し、出どころの列を足す。

| 列 | 扱い |
| --- | --- |
| `source_sha`、`run_id`、`run_attempt`、`actor_id`、`repository_id`、`owner_id`、`source_ref` | 消す(`ALTER TABLE … DROP COLUMN`)。どの索引、CHECK、外部キーにも使われていない |
| `source` | 足す。`browser` か `mcp`(CHECK 制約)。`NOT NULL DEFAULT 'browser'` |
| `idempotency_key`、`inventory_digest` | 残す。鍵の作り方だけが変わる |
| `publish_intent`、`start_revision` | この作業では残し、常に NULL を入れる。リポジトリに従う公開といっしょに、作業 R が消す(F22-AC31) |

- 既存の行を新しい形へ移す処理は書かない。本番のデータは空にする前提である。`source` の `DEFAULT` は、SQLite が `NOT NULL` の列を足すのに要るために付けるもので、コードは必ず値を渡す。ローカルに残っている GitHub 由来の版は、`browser` と表示される。
- 表を作り直さないので、`deployments` を指す表(`decks`、`upload_files`、`preview_launches`、`content_sessions`、`citations`)と、その行は変わらない。空の D1 に最初から最後まで適用できる(F22-AC19)。
- 1 つ前の版のコードは、消した列に書き込むので、この migration のあとでは動かない。deploy を戻せることは求めない前提である。

`decks` は、この作業では変えない。`publication_mode`、`ci_run_id`、`ci_run_attempt` と `repository_bindings` は、作業 R が消す。新しく作るスライドは、`publication_mode` が既定の `manual` になる。

## スライドを作る

`POST /api/slides` は、スライドの行と、受け取りの行を、1 つの D1 の batch で作る。

- スライドの鍵(`decks.id`)は乱数にする。URL の名前(`decks.slug`)は、下の規則で決める。
- スライドの本数の上限(`limits.decks`)は、挿入の文の条件に含める(同時の開始で超えないため)。超えたときは 409 と `code: deck_limit` を返し、何も作らない。
- 受け取りの上限で開始を断ったとき(`start_rejected`)は、スライドも作らない。拒否の記録は、版の履歴を持つスライドがあるとき、つまり新しい版の開始のときだけ残す。

### URL の名前を決める

純粋な関数にする(`src/decks/slug-name.ts`)。

1. 元にする文字列を、`name.title`、`name.fileName`(最後の拡張子を除く)、`slide` の順に試し、slug にできた最初のものを使う。
2. slug にする: NFKC で正規化し、英字を小文字にし、`a-z0-9` 以外の続きを `-` 1 つに置き換え、前後の `-` を取り、63 文字で切って末尾の `-` を取る。空になったら、その元は使えない。日本語だけの題名は空になるので、ファイル名へ進む。
3. 予約した名前は、そのままでは使わない。`new`、`connect`(`/slides` の下の固定の経路)と、`following`、`followers`(`/@handle` の下の一覧。F21-AC20)。
4. 同じ作者に同じ名前のスライドがあるとき、または予約した名前のときは、`-2`、`-3` と順に付ける。付けた結果が 64 文字を超えないように、元を切り詰める。

空きを決める処理は、作者の slug を読んで純粋な関数で選び、`UNIQUE(owner_user_id, slug)` に当たったら読み直してやり直す(3 回まで)。削除待ちのスライドの名前も、掃除が終わるまでは使用中として扱う。

### URL の名前を変える

1 本の管理ページの「URL の名前」の枠(`shareUrlFrame`)に、入力欄と「変更する」を置く。`POST /slides/:deck/slug` は、1 つの条件付きの UPDATE で変える。条件は、持ち主が本人であること、`first_published_at IS NULL` であること(1 度でも公開したら、止めたあとも変えられない。F22-AC14)、削除待ちでないこと。

- 形式に合わない名前、予約した名前(`following`、`followers`、`new`、`connect`)は、理由を示して断る。自動で `-2` を付けない(作者が自分で選ぶため)。
- 同じ作者のほかのスライドと重なる名前は、`UNIQUE` 制約で断り、理由を示す。
- 変えたあとは、303 で新しい `/slides/<slug>` へ移る。

## 送り手(ブラウザ)

ドロップ枠は `"use client"` のコンポーネントにし、トップ(`HomeDropFrame`)、スライドの管理(`deckListDropFrame`)、1 本の管理の差し替え(`replaceFrame`)に置く。判断と変換は純粋な関数に分け、`src/drops/` に置いて Vitest で確かめる。

| 処理 | 置き場 | 内容 |
| --- | --- | --- |
| zip を読む | `src/drops/zip.ts` | central directory を読み、`DecompressionStream('deflate-raw')` で展開する。依存を足さない。対応するのは、無圧縮と deflate、zip64 なし、暗号化なし。それ以外は理由を示して断る |
| 根を決める | `src/drops/root.ts` | `__MACOSX/` と `.DS_Store` を除く。直下に `index.html` があればそこ、なければ、全ファイルが 1 つのフォルダの下にあり、その直下に `index.html` があるときに、そのフォルダを根にする。決まらなければ断る |
| 送る前の検査 | `src/drops/precheck.ts` | 種類(HTML 1 ファイルか zip)、1 ファイルの大きさ、版の合計、ファイルの数。上限は `DEFAULT_UPLOAD_LIMITS` の値を使う。展開は、合計が上限を超えた時点でやめる(展開後の大きさを偽る zip のため) |
| ページを伝える script | `scripts/page-script.mjs` | `Buffer` を使わない形に直し、ブラウザと Node の両方から読み込む。判定のテスト(`scripts/page-script.test.mjs`)を、そのまま共有する |
| 一覧を作る | `src/drops/plan.ts` | script を足したあとの byte で、path、size、SHA-256 を作る |
| 送る | コンポーネント | 開始、未受領のファイルを 1 つずつ送信、確定。`files_missing` なら不足分を送り直す。失敗したら、同じ `attempt` で開始からやり直す。進み具合を `role="progressbar"` で示す |

サーバーは、ブラウザの検査を信用しない。一覧の検査と上限は、これまでどおり開始のときにサーバーが行う。

### 未ログインで預かる

- 預かるのは IndexedDB の 1 件(データベース `slide-drop`、store `pending`、固定の鍵)。中身は、選んだファイルそのもの(`File`)、名前、大きさ、`attempt`、預かった時刻。新しく選ぶと置き換える。
- 預かる前に、送る前の検査を済ませる。この時点では、サーバーに何も送らない(F22-AC9)。
- 「GitHub でログインして続ける」は `/auth/github` へ進む。戻り先はトップである。トップは、ログイン中だとわかったとき(`GET /api/session`)に預かりを読み、あれば受け取りを始めて、預かりを消す。なければ、ふつうのログイン中のトップを出す(F22-AC11)。
- 24 時間を過ぎた預かりは、読んだときに消して、無かったものとして扱う。
- 登録されていないアカウントでログインしようとした人は、`/auth/invitation-only` に着き、トップには戻らないので、預かりは送られない。ログイン中に登録から外された人の開始は、403 `invitation_only` で断られ、枠の中に招待制であることを出す(F22-AC16)。

## 差し替え

1 本の管理ページのドロップ枠は、`POST /api/slides/:deck/uploads` で新しい版を受け取る。確定しても、公開中の版(`decks.public_deployment_id`)は変えない。作者は、版の履歴から、既存の公開の操作で入れ替える(F22-AC15)。受け取りの失敗や再送が公開中の版に触れないことは、受け取りの処理が `decks` の公開の列に書き込まないことで保つ(F22-AC20)。

## 確かめるためのデータの入れ方

`scripts/upload.mjs` は、作者の cookie で開始する、ローカルと確認のための送り手にする。`SLIDE_OWNER_COOKIE`(`__Host-slide_owner=…`)と `SLIDE_ID`(slug)を受け取り、`POST /api/slides/:deck/uploads` で始める。GitHub Actions のための出力(`GITHUB_OUTPUT`、マスク)と OIDC の取得は消す。

`scripts/demo-reactions.mjs` と `scripts/verify-upload.mjs` は、ローカルの D1 に作者の session とスライドの行を作り、そのあとは実際の経路(session での開始、送信、確定)を通す。版の行を D1 に直接は作らない。Worker に、認証を迂回する経路は足さない。

## PR の分け方

1. この文書。
2. テスト名の ID の付け替え(F01-AC5〜AC10 を F22-AC21〜AC26 へ)。
3. 受け取りの作り替え。migration `0029`、新しい版の開始を session にする、OIDC の撤去、確定のあとの自動の公開をやめる、版の履歴の出どころ、データの入れ方の移行。
4. 新しいスライドの開始(`POST /api/slides`)と URL の名前の決め方。ブラウザの送り手(HTML 1 ファイル)。
5. zip。
6. 未ログインの預かり。
7. 差し替えと、URL の名前の変更。

## 作業 R に残すもの

- `repository_bindings`、`POST /slides/connect`、連携の認可(`src/auth/` の `bind`)。
- `decks.publication_mode`、`ci_run_id`、`ci_run_attempt`、`deployments.publish_intent`、`start_revision` と、リポジトリに従う公開の遷移(`src/publication/transitions.ts` の `decideCi` など)。
- `action.yml`、アップロードの確認用の workflow、`wrangler.jsonc` の `OIDC_AUDIENCE`、F01 の文書。

この作業で確定のあとの自動の公開をやめるので、それを行う `src/publication/ci.ts` は、呼ぶ場所がなくなる時点(PR 3)で消す。
