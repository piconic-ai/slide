# ドロップして置くための実装設計

[スライドを、ドロップして置く](../features/f22-browser-drop.md)を実装するための契約。受け取り(開始、ファイルごとに送る、確定)を GitHub から切り離し、ログイン中の作者の session で始める形にする。[AI エージェントから置く](../features/f23-agent-upload.md)も、同じ開始を呼ぶ。

状態: 実装中(2026-11-20)。受け取りの側(新しい版の開始、新しいスライドの開始、URL の名前の決め方、スキーマ、OIDC の撤去、データの入れ方)は実装と合っている。ブラウザの送り手、zip、未ログインの預かり、差し替え、URL の名前の変更は、これから作る設計である。実装した PR が、この文書の該当する節を実際に合わせて直す。

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

本人確認(誰が、どの手段で)と、開始そのもの(上限、session の作成、資格情報の発行)を分ける。開始は、次の入力を受け取る 1 つの関数にする(`src/uploads/api.ts` の `startUpload(c, start)`)。`c` は `env` と `req.url` を持つものなら何でもよく、どの経路の context も渡せる。

| 入力 | 内容 |
| --- | --- |
| `ownerUserId` | 作者の GitHub の user ID。呼ぶ側が、認可を済ませた値を渡す |
| `source` | `browser` か `mcp`(`src/db/schema.ts` の `UploadSource`)。出どころとして版に記録する |
| `target` | `{ kind: 'version', deck }`(新しい版を受け取る、作者自身のスライド。`resolveDeck` の結果の `id` と `slug`)か、`{ kind: 'new', name }`(新しいスライド。`name` は `title` と `fileName`) |
| `attempt`、`inventory` | 本文を解析した値(`src/uploads/start-request.ts` の `parseStartRequest`、`src/uploads/inventory.ts` の `parseInventoryStructure`) |

戻り値は、開始の応答そのもの(受領票、`credential`、`slug`、`manageUrl`)である。断るときは、状態と `code` を持つ例外を投げる。`deckUploadsApi` の経路はそれを JSON の応答に変えるので、別の入口から呼ぶときは、同じ変換をするか、例外の `status`・`code`・`details` を読む。

ブラウザの経路は、session と CSRF を確かめてから `source: 'browser'` で呼ぶ。作業 G の MCP の受け口は、OAuth の認可から `ownerUserId` を得て、`source: 'mcp'` で呼ぶ(差し替えのときは、`resolveDeck` で自分のスライドを引いて渡す)。cookie も `Origin` も要らない。渡された `ownerUserId` が登録された作者であること、停止中でないこと、新しい版のときはそのスライドの持ち主であることとスライドが削除待ちでないこと、それに上限と容量の判定は、関数の中で確かめる(合わなければ 403)。途中で止まった受け取りの入れ替えも、関数の中にある。どちらの入口でも同じになる。送信と確定でも、入口によらず、要求のたびに確かめ直す。


## 認可

- **開始。** session が有効で、GitHub の user ID が `AUTHOR_GITHUB_IDS` にあり、停止中でないこと。ログインしていなければ 401。署名の正しい session はあるが登録にない人(ログイン中に登録から外された人)には、403 と `code: invitation_only` を返す(`src/uploads/api.ts` の `requireAuthor`。`ownerSession` は登録にない人の session を無いものとして扱うので、`src/auth/owner-session.ts` の `hasSignIn` で見分ける)。送り手は、この応答を受けて、招待制であることを枠の中に出す(F22-AC16)。
- **ほかの人のスライド。** `:deck` は、session の作者の slug として引く(`resolveDeck`)。ほかの人のスライドは見つからず、存在しないスライドと同じ 404 になる(F22-AC17)。
- **送信、確定、状態。** 一時の資格情報の hash が版の行と合うことに加えて、要求のたびに、スライドの持ち主がいまも登録された作者で、停止中でなく、スライドが削除待ちでないことを確かめる。登録から外す、停止する、スライドを消すと、発行済みの資格情報での送信も止まる。
- **GitHub の OIDC。** 検証の処理(`src/uploads/oidc.ts`)ごとなくす。`Authorization: Bearer <OIDC の token>` を開始に送っても、session がないので 401 になる(F22-AC18)。

一時の資格情報は、開始の応答でだけ渡す。有効期間は 1 時間(`credentialSeconds`)。ブラウザは、変数に持つだけで、URL、cookie、IndexedDB、`localStorage` に置かない。期限が切れたら、同じ `attempt` で開始をやり直すと、新しい資格情報に替わる(古いものは失効する)。

### CSRF

cookie で認可して書き込むのは、開始の 2 つと `POST /slides/:deck/slug` だけである。

- cookie は `SameSite=Lax` なので、ほかのサイトからの POST には付かない。
- 開始は、`Origin` ヘッダーが、要求を受けた URL の origin と一致することを求める(`src/uploads/start-request.ts` の `isOwnOrigin`)。一致しない、`null`(sandbox の iframe)、ヘッダーがない要求は、`Content-Type` が何であっても 403 にする。`hono/csrf` の `csrf()` は、フォームの型(`application/x-www-form-urlencoded`、`multipart/form-data`、`text/plain`)のときだけ `Origin` を見るので、JSON を受ける開始には使わない。
- 開始は `Content-Type: application/json` だけを受け付け、それ以外は 415 にする。ほかの origin の script がこの型で送るには preflight が要り、CORS を許していないので届かない。`Origin` の検査の、もう 1 枚の守りである。
- `POST /slides/:deck/slug` はフォームなので、既存のフォームと同じ `csrf()` を通す。

送信、確定、状態は cookie を読まない。資格情報を知らないサイトからは呼べないので、CSRF の対象にならない。

## 同じ内容を二重に受け取らない

GitHub の実行番号の代わりに、送り手が `attempt` を作る。ブラウザは、ドロップ 1 回につき `crypto.randomUUID()` で 1 つ作り、その受け取りが終わるまで使い続ける。未ログインで預かったファイルには、預かるときに作った `attempt` をいっしょに保存する。

- 保存する鍵(`deployments.idempotency_key`)は、新しいスライドなら `new:<作者の ID>:<attempt>`、新しい版なら `<deck の ID>:<attempt>` にする。作者や deck をまたいで衝突しない。
- 同じ鍵の開始が来たら、新しい行を作らずに、同じ受け取りを続ける。資格情報を新しくし、受領済みのファイルを応答で示すので、送り手は残りだけを送る。新しいスライドの開始では、スライドも 2 つ目を作らない。
- 同じ鍵で、一覧の digest が違う開始は 409 `inventory_conflict` にする。ファイルを直して送り直すときは、送り手が新しい `attempt` を作る。
- 期限切れ(`session_expired`)や失敗(`session_failed`)の受け取りは続けられない。送り手は、新しい `attempt` で始める。

### 途中で止まった受け取り

同時に開いておける受け取りは、作者 1 人につき 1 つである(`activeSessions`)。送り手が途中で止まると(タブを閉じる、通信が切れる、script を止める)、その `attempt` を知っているものがいなくなり、受け取りは期限(24 時間)まで開いたまま残る。そのままでは、次の開始がすべて 429 `upload_busy` になる。

そこで、新しい開始は、誰も送っていない古い受け取りを放棄して入れ替える。

- 開始が、開いている受け取りのために断られるとき(同時の数、または予約済みの容量)、その作者の `uploading` の受け取りのうち、ファイルを受信中でないもの(受信の lease がない、または切れている)を `expired` にし、期限をいまにする(`src/uploads/start-store.ts` の `expireIdleSessions`)。1 件でも放棄できたら、開始をもう一度だけ試す。
- ファイルを受信している最中の受け取り(lease が有効。長くて `receiveLeaseSeconds`)は放棄しない。このときは、これまでどおり 429 `upload_busy` を返し、送り手は少し待ってやり直す。
- 放棄された受け取りの送り手がまだ動いていたら、次の要求で 409 `session_expired` を受けて止まる。2 つのタブで同時に送ると、あとから始めたほうが残る。
- 放棄は、期限切れと同じ状態にするだけである。受信済みのファイルは、期限切れの受け取りと同じ掃除が消す。`decks` の公開の列には書き込まないので、公開中の版は変わらない(F22-AC20)。
- 上限に空きがあるとき(`activeSessions` が 2 以上で、まだ 1 つしか開いていない、など)は、何も放棄しない。

ページを 2 回読み込んで同じファイルを 2 回ドロップしたときは、`attempt` が違うので、スライドが 2 つできる。これは作者の操作どおりで、要らないほうは 1 本の管理ページで消せる。

## スキーマ

migration `0029` で、`deployments` から GitHub 由来の列を消し、出どころの列を足す。

| 列 | 扱い |
| --- | --- |
| `source_sha`、`run_id`、`run_attempt`、`actor_id`、`repository_id`、`owner_id`、`source_ref` | 消す(`ALTER TABLE … DROP COLUMN`)。どの索引、CHECK、外部キーにも使われていない |
| `source` | 足す。`browser` か `mcp`(CHECK 制約)。`NOT NULL DEFAULT 'browser'` |
| `idempotency_key`、`inventory_digest` | 残す。鍵の作り方だけが変わる |
| `publish_intent`、`start_revision` | 消す。リポジトリに従う公開といっしょに、migration `0038_manual_publication.sql` で取り除いた(F22-AC31) |

- 既存の行を新しい形へ移す処理は書かない。本番のデータは空にする前提である。`source` の `DEFAULT` は、SQLite が `NOT NULL` の列を足すのに要るために付けるもので、コードは必ず値を渡す。ローカルに残っている GitHub 由来の版は、`browser` と表示される。
- 表を作り直さないので、`deployments` を指す表(`decks`、`upload_files`、`preview_launches`、`content_sessions`、`citations`)と、その行は変わらない。空の D1 に最初から最後まで適用できる(F22-AC19)。
- 1 つ前の版のコードは、消した列に書き込むので、この migration のあとでは動かない。deploy を戻せることは求めない前提である。

`decks` の `publication_mode`、`author_revision`、`ci_run_id`、`ci_run_attempt` と、表 `repository_bindings` は、GitHub 連携を取り除く作業で消した(migration `0037_drop_repository_bindings.sql`、`0038_manual_publication.sql`。F22-AC31)。どちらも表を作り直さないので、`decks` と `deployments` の行は変わらない。公開の方式は手動だけである。

## スライドを作る

`POST /api/slides` は、スライドの行と、受け取りの行を、1 つの D1 の batch で作る(`src/uploads/start-store.ts` の `insertDeckWithSession`)。batch は 3 つの文からなる。スライドを足す、受け取りを足す、受け取りのないスライドを消す。受け取りが断られたときは、足したスライドも同じ batch の中で消えるので、中身のないスライドは残らない。

- スライドの鍵(`decks.id`)は乱数にする。URL の名前(`decks.slug`)は、下の規則で決める。
- スライドの本数の上限(`limits.decks`)は、スライドを足す文の条件に含める(同時の開始で超えないため)。超えたときは 409 と `code: deck_limit` を返し、何も作らない。削除待ちのスライドは数えない。
- 受け取りの上限で開始を断ったとき(`start_rejected`)は、スライドも作らない。拒否の記録(`failed` の版)も残さず、応答に `deploymentId` を付けない。記録を残すのは、版の履歴を持つスライドがあるとき、つまり新しい版の開始のときだけである。
- 同じ `attempt` の開始がもう一度来たら、前に作ったスライドの受け取りを続け、2 つ目のスライドを作らない。そのスライドが消されていたら 403 にする。

#### 版のないスライドを残さない

最初の受け取りが終わらなかったスライド(送り手が途中で止まった、失敗した、期限が切れた、新しい開始に入れ替えられた)は、版を 1 つも持たない。これを、スライドとして扱わない。仕様にない細部なので、ここで決めた。

- 「版のないスライド」は、`ready` の版が 1 つもなく、開いている受け取り(`uploading` で期限内)もないスライドである。
- 新しいスライドの開始は、名前を決める前に、その作者の版のないスライドを手放す(`src/uploads/start-store.ts` の `releaseEmptySlides`)。手放したスライドは、削除待ちにし(`deleted_at`)、URL の名前を、誰にも付かない名前(`gone-` と乱数)に替える。行、受け取りの記録、R2 のファイルは、削除したスライドと同じ掃除が消す。
- そのため、版のないスライドは、本数の上限に数えられず、名前もふさがない。同じファイルを置き直せば、`-2` ではなく、元の名前になる。一覧にも出なくなる。
- 開いたままの受け取りを入れ替えたとき(上の「途中で止まった受け取り」)は、入れ替えのあとにもう一度手放してから、名前を決め直す。
- 手放すのは、新しいスライドの開始のときだけである。それまでは、版のないスライドが一覧に残ることがある(名前は URL の名前で出る)。作者が開いて、差し替えの枠から置き直すこともできる。
- ブラウザの経路でも、ほかの入口(MCP)でも、同じ `startUpload` の中で行う。

### URL の名前を決める

純粋な関数にしてある(`src/decks/slug-name.ts` の `slugBase`、`freeSlug`、`chosenSlug`)。

1. 元にする文字列を、`name.title`、`name.fileName`(最後の拡張子を除く)、`slide` の順に試し、slug にできた最初のものを使う。
2. slug にする: NFKC で正規化し、英字を小文字にし、`a-z0-9` 以外の続きを `-` 1 つに置き換え、前後の `-` を取り、64 文字で切って末尾の `-` を取る。空になったら、その元は使えない。日本語だけの題名は空になるので、ファイル名へ進む。
3. 予約した名前は、そのままでは使わない。`new`、`connect`(`/slides` の下の固定の経路)と、`following`、`followers`(`/@handle` の下の一覧。F21-AC20)。
4. 同じ作者に同じ名前のスライドがあるとき、または予約した名前のときは、`-2`、`-3` と順に付ける。付けた結果が 64 文字を超えないように、元を切り詰める。

空きを決める処理は、作者の slug を読んで純粋な関数で選び、`UNIQUE(owner_user_id, slug)` に当たったら読み直してやり直す(3 回まで)。削除待ちのスライドの名前も、掃除が終わるまでは使用中として扱う。

### URL の名前を変える

1 本の管理ページの「URL の名前」の枠(`shareUrlFrame`)に、入力欄と「変更する」を置く。`POST /slides/:deck/slug` は、1 つの条件付きの UPDATE で変える。条件は、持ち主が本人であること、`first_published_at IS NULL` であること(1 度でも公開したら、止めたあとも変えられない。F22-AC14)、削除待ちでないこと。

- 形式に合わない名前、予約した名前(`following`、`followers`、`new`、`connect`)は、理由を示して断る。自動で `-2` を付けない(作者が自分で選ぶため)。
- 同じ作者のほかのスライドと重なる名前は、`UNIQUE` 制約で断り、理由を示す。
- 変えたあとは、303 で新しい `/slides/<slug>` へ移る。

## 送り手(ブラウザ)

ドロップ枠は、サーバーが描いた枠(`[data-drop-zone]`)を、script が使えるようにする形にしてある。BarefootJS の `"use client"` のコンポーネントにはしていない。理由は 2 つある。

- **3 つの画面で、同じ送り手を使うため。** 枠は、トップ(`HomeDropFrame`。ビルド時に JSX から生成する静的なファイル)、スライドの管理(`deckListDropFrame`)、1 本の管理の差し替え(`replaceFrame`)にある。後ろの 2 つは Hono の `html` テンプレートで、コンポーネントの hydration の仕組みに乗っていない。
- **管理画面の CSP を弱めないため。** 管理画面は `script-src 'self'` で、インラインの script を許さない。同じ origin の module を 2 つ読み込むだけなら、CSP を変えずに済む。

読み込むものは 2 つである。

| ファイル | 中身 | 確かめ方 |
| --- | --- | --- |
| `public/drop.js` | 手で書いた module。枠の要素を読み、イベントを受け、状態を描く。判断はしない | Playwright(`src/drops/drop.browser.test.ts`) |
| `public/drop-core.js` | `src/drops/browser.ts` を Vite でまとめた生成物(`vite.drop.config.ts`、`pnpm build` が作る。git には入れない)。何を送るか、何を断るか、どう送るかを決める | 元の TypeScript を Vitest で確かめる |

枠は、ボタンを `disabled` にして描く。`/drop.js` が動いたときにだけ押せるようになるので、script が動かない環境では、使えるように見えない。枠の決まり: `data-drop-zone` は `new`(新しいスライド)か `replace`(`data-deck` に slug)。中に、`data-drop-title`、`data-drop-choose`(ボタン)、`data-drop-input`(本物の `<input type="file">`)、`data-drop-note` を置く。進み具合(`role="progressbar"`)と、理由や状況を伝える行(`role="alert"`・`role="status"`)は、script が足す。

以前は `public/share.js` が、枠の上の dragover・drop の既定の動き(ブラウザがファイルを開いてページを離れる)を止めていた。いまは `/drop.js` が枠ごとに止めるので、`share.js` からは外した。

判断と変換は、純粋な関数として `src/drops/` に置いてある。

| 処理 | 置き場 | 内容 |
| --- | --- | --- |
| 種類と上限の検査 | `src/drops/precheck.ts` | 種類(HTML 1 ファイルか zip)、ファイルの数、ファイルの名前、1 ファイルの大きさ、版の合計。最初に当たったものを、数やファイルの名前といっしょに返す。名前の規則(`.` で始まる名前、`%`・`?`・`#`・`:`、`node_modules`、`credentials*` など。ファイルとフォルダの同名も)は、サーバーが一覧を検査するのと同じ関数(`src/uploads/path-rules.ts`)を使うので、サーバーが断る名前は、送る前に、どのファイルかを示して断る。未ログインの人には、預かる前に断る。上限は `src/uploads/version-limits.ts`(サーバーの既定値と同じ定数)、受け取れる種類は `src/uploads/media-types.ts`(サーバーと同じ表)を使う |
| ページを伝える script、一覧 | `src/drops/plan.ts` | `scripts/page-script.mjs` の `withPageScript` をそのまま呼ぶ(`Buffer` を使わない形に直し、ブラウザと Node の両方から読み込む。判定のテストは `scripts/page-script.test.mjs` のまま)。script を足したあとの byte で、path、size、SHA-256 を作り、その大きさで上限を確かめる |
| 送る | `src/drops/send.ts` | 開始、未受領のファイルを 1 つずつ送信、確定。通信そのもの(`request`)と待ち時間(`wait`)は引数で受け取る。資格情報の期限切れ、`files_missing` は、同じ `attempt` で開始からやり直す(4 回まで)。429・5xx・コードのない 409 は、間隔を倍にしながら 5 回まで試す。断られた理由は、種類(`sign_in`、`invitation_only`、`deck_limit`、`limit` と上限の名前、`busy` など)で返す |
| 文言 | `src/drops/text.ts` | 断った理由と、受け取り中の表示。日本語と英語 |
| zip を読む | `src/drops/zip.ts` | central directory からファイルの一覧を読み(`readZipDirectory`)、1 つずつ展開する(`unpackEntry`。`DecompressionStream('deflate-raw')`。依存は足していない)。対応するのは、無圧縮と deflate。暗号化、zip64、ほかの圧縮方式、UTF-8 でない名前、シンボリックリンク(UNIX で作った項目のうち、mode がリンクのもの)は、理由を示して zip ごと断る。シンボリックリンクは、そのまま展開すると「リンク先のパスが書かれたファイル」になり、スライドが黙って壊れる。無視せずに断るのは、仕様にない細部で、ここで決めた。`..`・絶対パス・`\`・制御文字を含む名前、同じ名前の重複も、zip ごと断る。展開は、一覧に書かれた大きさを超えた時点でやめ、大きさと CRC-32 が一覧と合わないものは断る(展開後の大きさを偽る zip のため) |
| 根を決める | `src/drops/root.ts` | `__MACOSX/`、`.DS_Store`、`._` で始まるファイル(AppleDouble。macOS が、exFAT や SMB の上のファイルの隣に足すもの)を除く。`._*` を無いものとして扱うのは、仕様にない細部で、ここで決めた(`__MACOSX/` の中身と同じものが、別の置き方で入っているだけのため)。直下に `index.html` があればそこ、なければ、全ファイルが 1 つのフォルダの下にあり、その直下に `index.html` があるときに、そのフォルダを根にする。決まらなければ断る |
| zip を一覧にする | `src/drops/plan.ts` の `zipDrop`・`planZip` | 根の下のファイルを、zip の一覧の大きさで先に検査し(数、種類、1 ファイル、合計)、通ったものだけを展開する。zip そのものが 1 つの版の上限の 2 倍を超えるときは、読まずに断る |

サーバーは、ブラウザの検査を信用しない。一覧の検査と上限は、これまでどおり開始のときにサーバーが行う。題名から URL の名前を決めるための `name.title` は、`/drop.js` が `DOMParser` で読んで送る(保存する題名は、確定のときにサーバーが読む)。

失敗のあとの置き直しは、同じ受け取りを続ける。送信が終えられなかったとき(通信の失敗など。サーバーが受け取りを閉じたときと、理由を付けて断ったときを除く)、枠は、その `attempt` と、送った一覧(path と SHA-256)を覚えておく。次にドロップされたものの一覧が同じなら、同じ `attempt` で送る(`src/drops/attempt.ts`)。サーバーは同じ受け取りを続けるので、2 つ目のスライドはできない。覚えているのは、ページを開いている間だけである。ページを離れたあとの置き直しは新しい `attempt` になるが、前の受け取りが残した版のないスライドは、開始のときに手放される(「版のないスライドを残さない」)ので、名前は `-2` にならない。

受け取りの間は「ファイルを選ぶ」を隠す。キーボードで操作していた人のフォーカスは、枠の題に移し、枠が元に戻ったときにボタンへ戻す。受け取りの間に重ねてドロップされたものは、何も言わずに受け取らない。中身が 0 byte の HTML は、読まずに断る。

受け取りが終わると、開始の応答の `manageUrl` へ移る(同じ origin のときだけ。違えば `/slides/<slug>`)。

### 未ログインで預かる

預かるのは、トップの枠だけである(`data-drop-stash`)。スライドの管理と 1 本の管理は、作者しか開けない。

- トップは、誰にでも同じ静的なファイルなので、`/drop.js` が `GET /api/session` でログインの状態を聞く。ログイン中なら、枠を小さくする(`drop-zone-large` を外す)。
- 未ログインの人がファイルを選ぶと、ログイン中と同じ検査(種類、上限、zip の中身)を済ませてから、ブラウザの IndexedDB に預かる。データベース `slide-drop`、store `pending`、固定の鍵 `drop` の 1 件で、中身は、選んだファイルそのもの(`File`)、`attempt`、預かった時刻である。新しく選ぶと置き換える。この時点では、サーバーに何も送らない(F22-AC9)。
- 枠は「選んだ後」の表示になる(線を実線にし、ファイル名と大きさ、「GitHub でログインして続ける」、「別のファイルにする」)。「別のファイルにする」は、預かりを消して元の枠に戻す(F22-AC12)。
- 「GitHub でログインして続ける」は `/auth/github?to=top` へ進む。`to=top` は、ログインの戻り先をトップにする指定で、`src/auth/landing.ts` の `landingOf` が受け付ける。既存の仕組み(Better Auth の `callbackURL`)に、行き先を 1 つ足しただけで、GitHub の OAuth アプリの設定は変えていない。
- 預かったファイルを自動で受け取るのは、「GitHub でログインして続ける」を押して、ログインして戻った、その 1 回だけである。仕様にない細部なので、ここで決めた。預かりは、誰が預けたかを持たないので、「預かりがある」かつ「ログイン中」だけで受け取ると、同じブラウザで別の人がログインしたときや、本人がやめたつもりのときに、確認なしにスライドができてしまう。
  - ボタンを押したときに、そのタブの `sessionStorage`(鍵 `slide-drop-continue`)に、預かりの `attempt` を印として置く。戻ったトップは、印を読んだらすぐ消し、印が預かりの `attempt` と合うときだけ受け取りを始める(`src/drops/stash.ts` の `isContinuing`)。
  - 印は 1 回で消えるので、再読み込み、戻るボタンでは、もう一度は受け取らない。`sessionStorage` はタブごとなので、別のタブでは受け取らない。
  - 印がないのにログイン中で預かりがあるとき(ヘッダーからログインした、別の人がログインした)は、何も送らず、何も出さない。預かりは期限まで残り、未ログインでトップを開けば「選んだ後」の表示に戻る。
  - 受け取りは、預かったときの `attempt` で始める。受け取りが終わるか、サーバーが受け取りを閉じるか、理由を付けて断ったら、預かりを消す。通信の失敗などで終えられなかったときは残す(自動ではやり直さない。枠の案内のとおりに同じファイルをドロップすれば、同じ受け取りを続ける)。
- ログインの状態が分かるまで、何も送らない。ドロップは `GET /api/session` の答えを待つ。答えが「ログイン中」でないとき(未ログイン、429、5xx、通信の失敗)は、預かりに回す(F22-AC9)。ログイン中なのに答えが取れなかった人は、「GitHub でログインして続ける」から戻れば受け取られる。
- 預かりがなければ、ふつうのログイン中のトップを出す(F22-AC11)。保存されていたものがファイルでない、`attempt` の形でない、24 時間を過ぎている(`src/drops/stash.ts` の `freshStash`)ときは、消して、無かったものとして扱う。
- ログイン中のつもりでドロップしたのに、session が切れていた(開始が 401)ときは、そのファイルを預かって「選んだ後」の表示にする。
- ブラウザが IndexedDB を使わせないとき(一部のプライベートウィンドウ)は、預からずに、ログインしてからもう一度ドロップするよう伝える。

招待制との関係(F22-AC16):

- 登録されていないアカウントでログインしようとした人は、`/auth/invitation-only` に着き、ログインできない。トップには未ログインのまま戻るので、預かりは送られない。
- ログイン中に登録から外された人は、`/api/session` には未ログインとして見える(`ownerSession` が、登録にない人を作者として扱わないため)。トップでドロップすると、ファイルは預かりになり、何も送られない。「GitHub でログインして続ける」から進むと、ログインが断られ、招待制であることが伝わる。スライドの管理や 1 本の管理を開いたままドロップしたときは、開始が 403 `invitation_only` で断られ、枠の中に招待制であることが出る。

## 差し替え

1 本の管理ページのドロップ枠は、`POST /api/slides/:deck/uploads` で新しい版を受け取る。確定しても、公開中の版(`decks.public_deployment_id`)は変えない。作者は、版の履歴から、既存の公開の操作で入れ替える(F22-AC15)。受け取りの失敗や再送が公開中の版に触れないことは、受け取りの処理が `decks` の公開の列に書き込まないことで保つ(F22-AC20)。

## 確かめるためのデータの入れ方

`scripts/upload.mjs` は、作者の cookie で開始する、ローカルと確認のための送り手にする。`SLIDE_OWNER_COOKIE`(`__Host-slide_owner=…`)と `SLIDE_ID`(slug)を受け取り、`POST /api/slides/:deck/uploads` で始める。GitHub Actions のための出力(`GITHUB_OUTPUT`、マスク)と OIDC の取得は消す。

`scripts/demo-reactions.mjs` と `scripts/verify-upload.mjs` は、ローカルの D1 に作者の session とスライドの行を作り、そのあとは実際の経路(session での開始、送信、確定)を通す。版の行を D1 に直接は作らない。Worker に、認証を迂回する経路は足さない。

作者の session の行と、Better Auth が署名する形の cookie は、`scripts/owner-cookie.mjs` の純粋な関数が作る。Worker は自分の `BETTER_AUTH_SECRET` で署名を確かめるので、secret を知らない Worker には通らない(`scripts/owner-cookie.test.mjs`)。

```sh
# 公開済みのスライドを 2 つ作り、作者の cookie を表示する
SLIDE_DEMO_DECK=try-static SLIDE_PERSIST_TO="$STATE" \
  node scripts/demo-reactions.mjs examples/static http://localhost:8811

# 自分のスライドに、新しい版を足す
SLIDE_ID=try-static SLIDE_OWNER_COOKIE="$COOKIE" \
  node scripts/upload.mjs examples/static http://localhost:8811

# 受け取りの経路を確かめる
SLIDE_PERSIST_TO="$STATE" node scripts/verify-upload.mjs http://localhost:8811
```

## PR の分け方

1. この文書。
2. テスト名の ID の付け替え(F01-AC5〜AC10 を F22-AC21〜AC26 へ)。
3. 受け取りの作り替え。migration `0029`、新しい版の開始を session にする、OIDC の撤去、確定のあとの自動の公開をやめる、版の履歴の出どころ、データの入れ方の移行。
4. 新しいスライドの開始(`POST /api/slides`)と URL の名前の決め方。ブラウザの送り手(HTML 1 ファイル)。
5. zip。
6. 未ログインの預かり。
7. 差し替えと、URL の名前の変更。

## GitHub 連携を取り除く作業で片づけたもの

- `repository_bindings`、`POST /slides/connect`(404 になる。F22-AC29)、連携の認可(`src/auth/` の `bind`)。
- `decks.publication_mode`、`author_revision`、`ci_run_id`、`ci_run_attempt`、`deployments.publish_intent`、`start_revision` と、リポジトリに従う公開の遷移(`decideCi` など)。公開の状態は、作者が押したときだけ変わる(F02-AC6、F02-AC7)。
- `action.yml`、アップロードの確認用の workflow(F22-AC30)、F01 の手順と設計の文書。

`wrangler.jsonc` の `OIDC_AUDIENCE` は、どのコードも読まなくなった。設定の値は作業の中で変えない決まりなので、残してある。消すかどうかは、依頼者が決める。

受け取りの確定のあとの自動の公開をやめたので、それを行っていた `src/publication/ci.ts` と、開始の本文の `publication` を読む `src/publication/intent.ts` は、PR 3 で消した。版を commit で呼んでいた画面(版の履歴、公開の枠)は、出どころと deployment の ID で呼ぶ(F22-AC28)。
