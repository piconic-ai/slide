# GitHub Actions から送って結果を確認する

F01 の実装（Issue #2、完了）。ビルド済み directory を送信し、非公開の ready deployment と公開可能な結果レポートを作る。アップロードによるスライドの一般公開は行わない。

## 実物を試す

1. 本人としてログインし、`/decks/new` で deck `try-static` と `try-markdown` をこの repository の `main` に連携する（[repository を deck に連携する](#repository-を-deck-に連携する)）。
2. repository variable `SLIDE_UPLOAD_SMOKE_ENABLED` を `true` にする。`false` の間、[アップロード確認 workflow](../../.github/workflows/try-upload.yml) は skipped になる。

   ```sh
   gh variable set SLIDE_UPLOAD_SMOKE_ENABLED --body true --repo piconic-ai/slide
   ```

3. workflow を `main` で実行する。

   ```sh
   gh workflow run try-upload.yml --ref main --repo piconic-ai/slide
   ```

4. 実行結果の artifact `slide-upload-reports` をダウンロードして展開する（`gh run download <run-id> --repo piconic-ai/slide`）。有効期間は1日。
5. `static.json` と `markdown.json` で deploymentId・commit・statusUrl を確認し、`state` が `ready` であることを確かめる。
6. `/decks/try-static` と `/decks/try-markdown` の受領履歴に、同じ commit と deployment ID が「受領完了」で出ていることを確かめる。一般公開するまで、その版は作者だけのものです。この画面は本人のログインが必要なため、作者がブラウザで確認する。

workflow はチェックイン済み HTML と、作者側の CI が Marp で Markdown から作った HTML を同じ uploader で送る。サービス内でビルドしない。結果レポートには認証情報を含めず、公開 repository の artifact として扱う。ブラウザに読み込む受領票としては使用できない。CI から作った deployment を本人がブラウザでプレビューする導線は、後続の本人ログインの実装で用意する。

## 作者の CI から送る

Node.js 22 以降と `id-token: write` を設定し、作者側のビルド後に実行する。`SLIDE_DECK` には、この repository を連携した deck ID を指定する。

```sh
mkdir -p "$RUNNER_TEMP/public-reports"
SLIDE_DECK=my-talk \
SLIDE_REPORT_FILE="$RUNNER_TEMP/public-reports/upload.json" \
  node scripts/upload.mjs path/to/prebuilt https://slide.piconic.ai
```

GitHub Action として呼ぶ場合は、この repository の `action.yml` を使う。Action はビルドも依存の導入もせず、指定した directory を送るだけで、出力に deployment ID・commit・state・状態確認 URL を返す。配布名は未決のため、当面は repository を commit SHA で固定して参照する。

```yaml
permissions:
  contents: read
  id-token: write
steps:
  - uses: actions/checkout@v6.1.0
  - uses: actions/setup-node@v7.1.0
    with:
      node-version: 24
  - run: npm ci && npm run build # 作者のビルド
  - id: slide
    uses: piconic-ai/slide@<commit-sha>
    with:
      directory: dist
      deck: my-talk
  - run: echo "${{ steps.slide.outputs.status-url }}"
```

uploader は symlink を拒否し、path・size・SHA-256 の一覧を作る。GitHub OIDC と専用の認証情報を交換し、未受領ファイルを送って ready にする。完了時の `SLIDE_REPORT_FILE`、stdout と `GITHUB_OUTPUT` には deploymentId・commit・state・statusUrl のみを出す。レポートの既存ファイルは上書きしない。

uploader は途中で失敗しても同じ attempt で続ける。認証情報の期限切れ（`credential_expired`）では fresh OIDC token で再認証して同じ session を続け、finalize が `files_missing` を返したら不足分を再送して finalize し直す（3回まで）。コードのない 409、5xx、開始以外の `upload_busy` は間隔を空けて5回まで再試行する。開始時の `upload_busy` は同じアカウントの別のアップロードが終わるまで続くため、5秒から倍に延ばし最大30秒の間隔で待つ（`Retry-After` があれば従う）。最初の開始から5分を超える待ちは行わず、`upload_busy` と対処方法を示して終了する。ただし、待ちの途中で別の一時的な失敗が起きると、その再試行の分だけ5分を超えることがある。間隔には揺らぎを加え、並列の job がそろって再送しないようにする。待つたびに理由と待ち時間を表示する。サーバーは同じ attempt の同時開始の競合にも `upload_busy` を返すため、その場合も同じ間隔で待つ。待ち時間の基準は `SLIDE_RETRY_DELAY_MS`（既定1000、テスト用）で変えられ、正の数でなければ開始前に終了する。1つの repository から複数の deck を matrix で送る場合も、workflow を変えずに順に完了する。待ち時間を避けたい場合は matrix に `max-parallel: 1` を指定する。待機の判定は `scripts/retry-policy.mjs` の純粋関数で行う。開始の拒否（`start_rejected`）は理由を表示して終了し、`session_expired`・`session_failed` は再試行せずに終了する。上限はサービスが判定するため、uploader は件数や容量を事前に検査しない。OIDC token の audience は送信先 URL の origin にするため、別のホストへ送った token を本番で使い回せない。結果の commit と state は検証してから出力する。GitHub Actions では runner に認証情報のマスク登録を行い、公開ログへの表示も防ぐ。

`SLIDE_CREDENTIAL_FILE` はローカル専用の private 受領票 `{deploymentId, credential, api, statusUrl}` を mode0600 で新規作成する。GitHub Actions では認証・session 作成前にこの指定を拒否する。結果レポート・private 受領票・`GITHUB_OUTPUT` は異なるファイルパスを指定する。

ローカルで認証情報を保持して再開・プレビューする場合のみ、無視対象の `.private/receipts/` に受領票を保存する。既存ファイルは上書きしない。

```sh
mkdir -p .private/receipts
SLIDE_CREDENTIAL_FILE=".private/receipts/local.json" \
  node scripts/upload.mjs path/to/prebuilt http://localhost:8794
```

ローカル実行は `SLIDE_DEPLOYMENT_ID`・`SLIDE_UPLOAD_CREDENTIAL` を環境変数で渡し、既存 session を再開する。認証情報をコマンドの引数や URL に入れない。private 受領票を artifact・ログ・repository に保存しない。アップロード先の Slide に private 受領票を読み込むと、受領状態と HTML 単体のプレビューを確認できる。ブラウザは認証情報を URL や browser storage に保存せず、HTML は同一 origin の権限を持たない iframe sandbox 内で表示する。相対パスの画像・CSS・JS は読み込まない。

## 初期の連携設定

`wrangler.jsonc` の `GITHUB_ACTOR_ID`（`722500`）が、ログインと upload を許可する本人の GitHub user ID になる。repository と許可 ref は deck ごとの連携情報（[repository を deck に連携する](#repository-を-deck-に連携する)）で決める。

upload の開始は `POST /api/decks/:deck/uploads`。OIDC の署名・issuer・audience・有効期限・発行時刻・not-before と numeric claim を検証し、push と workflow_dispatch のみ受け付ける。そのうえで claim の repository ID・owner ID・ref が deck の連携情報と一致し、actor が deck の owner かつ本人であることを確かめる。連携のない deck や許可外の ref は 403 になる。commit と実行番号は署名済み claim を使う。repository 移転は owner ID の不一致で拒否する。作成後の送信・状態確認・finalize でも、毎回 deck の現在の連携情報と照合するため、連携を変更・解除すると以降の送信は止まる。

[アップロード確認 workflow](../../.github/workflows/try-upload.yml) は deck `try-static` と `try-markdown` に送る。実行前に、二つの deck をこの repository に連携しておく。Actions 画面から手動で実行でき（`workflow_dispatch`）、実行する branch を deck の許可 branch に含める。

同じ deck・repository・run・attempt・inventory なら再開し、別 inventory なら同じ run 内で別 deployment を作る。再認証すると以前の認証情報は失効する。session の有効期限は作成時に決まる。認証情報は session より短い期限を持ち、session の期限を超えない。

| 状態 | 意味 | 同じ attempt の再認証 |
| --- | --- | --- |
| `uploading` | 受信中。期限内ならファイルを受け付ける | 認証情報を更新して再開する |
| `ready` | 全ファイルを受領し、変更できない | 読み取り用の認証情報を更新する |
| `expired` | 期限切れ。受信中の期限切れも同じ扱い | 409 `session_expired`。新しい attempt で始める |
| `failed` | 失敗理由を記録して終了した | 409 `session_failed`。新しい attempt で始める |

期限切れの認証情報は 401 と `code: credential_expired` を返す。uploader は同じ attempt で fresh OIDC token を取得して再認証すれば、同じ session を続けられる。再認証では repository・ref・actor を再び検証するため、期限の更新だけで権限の変更を迂回できない。session の期限切れや失敗後の送信・finalize は、再認証では直らないため 409 と `session_expired`・`session_failed` を返す。同時に再認証した場合は一方だけが認証情報を更新し、他方は 409 `session_changed` を返す。状態確認の応答は認証情報の期限 `credentialExpiresAt` と、失敗時の `failureReason` を含む。ファイルの受信と finalize は、D1 の更新条件でも session の期限を確認する。

初期上限は100ファイル、一ファイル5MiB、一版10MiB、保持・予約合計50MiB、24時間で5回、同時アップロード1件、deck 20個。session の有効期間24時間、認証情報の有効期間1時間、ファイル受信の lease 120秒も仮の値として同じ設定に含める。値は `src/uploads/limits.ts` の既定値を使い、`wrangler.jsonc` の `UPLOAD_LIMITS` で項目ごとに上書きする。有効期限とファイル数・容量の上限は次に作成する session から適用し、作成済み session の再送には適用しない。受信 lease は30秒から15分の運用値として、作成済み session も含め次に受信するファイルから適用する。不正な設定では session の作成・再送とファイルの受信、repository の接続が失敗し、既存の認証情報は変えない。uploader の事前検査は既定値のままで、サーバーの設定とは連動していない。

認証後に上限で開始を拒否した場合は、拒否理由を `failed` の deployment として記録し、`code: start_rejected` と `reason`・`deploymentId` を返す。413・409 は同じ attempt の再試行では解消しない。同じ attempt の再送は 409 `session_failed` と同じ `reason` を返す。拒否の記録は容量を予約せず、開始回数にも数えない。記録は24時間で20件（仮の値、`refusalsPerDay`）までとし、超えた拒否は `deploymentId` なしで理由だけを返す。別のアップロードが進行中の場合や、進行中の session の予約分だけで容量を超える場合、同じ attempt の同時開始が競合した場合は、一時的な状態として記録しない。429 `upload_busy` で同じ attempt の再試行を促す。記録されなかった拒否は、上限が空けば同じ attempt で再試行できる。保持・予約の容量、同時アップロード、24時間の開始回数と拒否の記録は、アカウントごとに数える。アカウントは deck の所有者（`decks.owner_user_id`）で、その deck に属する deployment だけを集計する。repository の所有者（`deployments.owner_id`）や workflow の実行者は使わない。deck に属さない deployment（deck を導入する前の試行）は、どのアカウントにも数えない。

| reason | status | 意味 |
| --- | --- | --- |
| `too_many_files` | 413 | ファイル数が一版の上限を超える |
| `file_too_large` | 413 | 一ファイルの上限を超える |
| `deployment_too_large` | 413 | 一版の合計が上限を超える |
| `author_bytes_exceeded` | 409 | 保持中と予約中の合計が上限を超える |
| `daily_starts_exceeded` | 409 | 24時間の開始回数が上限に達した |

ファイルは SHA-256 を指定して R2 に保存し、R2 自身にも内容を検証させる。finalize は受領済みの全ファイルについて R2 の object を確認し、欠損・size 違い・SHA-256 の不一致・checksum のない object を見つけると受領を取り消す。取り消した object は R2 からも削除する。そのうえで 409 `files_missing` と不足一覧を返すので、uploader は再送すれば続けられる。R2 の一時的な障害で確認できない場合は、受領を変えずに 429 `upload_busy` を返す。この変更より前に受信した object は checksum を持たないため、受信中の session は finalize 時に再送が必要になる。ファイル数の上限は、finalize が一回で全 object を確認するため500までとする。ready の確定は D1 の一回の条件付き更新で行い、途中で中断しても中間状態は残らない。同じ finalize の再送は同じ ready を返す。

ready にするとき、`index.html` の先頭 64 KiB から、コメント、`script`・`style` などの中、属性値の中を除いた最初の `<title>` を読み、文字参照を `entities` で戻して空白をまとめ、200 文字までを `deployments.title` に保存する。デッキの一覧はこの題名で資料を示す。`<title>` がない・空のとき、または R2 から読めないときは NULL のまま ready にする。題名は一覧に出すだけなので、読めなくても受領は止めない。同じ 64 KiB から、同じ範囲を除いた最初の `<meta name="description">` の `content` も読み、300 文字までを `deployments.description` に保存する。ないとき・空のときは NULL にする。

R2 は非公開で、受領票と保存ファイルの取得にも Bearer 認証が必要。ready のファイルは変更できない。

## ローカルで確認する

```sh
pnpm install
pnpm exec wrangler types --include-runtime=false
pnpm exec wrangler d1 migrations apply slide --local
pnpm exec wrangler dev --local --port 8794 --infer-origin-from-routes=false
```

別の terminal で実行する。

```sh
node scripts/verify-upload.mjs http://localhost:8794
pnpm exec tsc --noEmit
pnpm test
```

確認用 script はローカル D1 のみに session を作り、実際の HTTP・uploader・R2 を通す。不足時の再送、hash 不一致、ready 後の上書き拒否、finalize 再送、匿名取得の拒否を確認する。production の認証を迂回する route は設けない。

## 配置先

Worker `slide`、domain `slide.piconic.ai`、D1 `slide`、非公開 R2 `slide-uploads` を使用する。反映の手順は [本番に反映する](deploy.md) にまとめた。ready の保持容量は期限後も使用量に含める。

## 本人ログイン

ブラウザの本人確認と session 管理には [Better Auth](https://better-auth.com/docs/integrations/hono) を使う。GitHub App のユーザー認可を使用し、repository 権限は `Metadata: Read-only` のみにする。OAuth App の `repo` scope は使わず、webhook は無効にする。

1. `GET /auth/github` が Better Auth の OAuth を開始する。state と PKCE の生成、state cookie と一度限りの状態の検証はライブラリが担当する。
2. `/auth/github/callback` がライブラリの callback に渡し、GitHub user ID を `GITHUB_ACTOR_ID` と照合する。許可した本人だけがログインできる。
3. `__Host-slide_owner` cookie は host-only・Secure・HttpOnly・SameSite=Lax、有効期限12時間で自動延長しない。D1 の `auth_session` で session を管理し、cookie は Better Auth が署名する。新しいログインは D1 の `UNIQUE(user_id) ON CONFLICT REPLACE` により同じ本人の session を原子的に置き換える。
4. `POST /auth/logout` は同一 origin の要求だけを受け付け、session を削除する。`GET /auth/owner` はログイン中の本人を返す。各要求で GitHub の数値 ID と allowlist を再照合する。

`auth_user`・`auth_account`・`auth_session`・`auth_verification` は認証専用で、共有 URL の固定 handle を持つ既存の `accounts` とは分ける。GitHub user token は D1 に保存せず、callback の最後に GitHub 側で失効させる。Better Auth の必須 email には GitHub 数値 ID から作る `ID@users.noreply.github.com` を使い、メールは送信しない。GitHub provider は `/user/emails` も確認するが、その権限がなくてもログインできる。D1 で user 作成後に provider account の保存が一時的に失敗した場合、再ログインで同じ数値 ID 由来の email に GitHub account を連携し直す。信頼する provider は GitHub だけで、照合前に allowlist を検証する。email・user 更新、account linking、パスワード認証の endpoint は公開しない。

GitHub App の callback URL は引き続き `https://slide.piconic.ai/auth/github/callback`。`PUBLIC_ORIGIN` から固定の callback URL を作る。Client ID と `GITHUB_APP_CLIENT_SECRET` に加えて、32文字以上のランダムな `BETTER_AUTH_SECRET` を `pnpm exec wrangler secret put BETTER_AUTH_SECRET` で登録する。変更すると既存の署名 cookie が使えなくなるため、安定した値を保つ。

ローカルでは `.dev.vars.example` を `.dev.vars` に複写して Client ID・client secret・`BETTER_AUTH_SECRET` と `PUBLIC_ORIGIN` を設定する。`__Host-` cookie を使うため HTTPS の localhost を推奨する。必要な設定がない間、ログインは 503 を返す。migration `0012_better_auth.sql` は既存 deck・GitHub所有者 ID・handle を維持し、旧 session の行を消すため、反映後に再ログインする。`owner_sessions` の表自体は切戻し期間中の旧 Worker 用に残し、新 Worker は認証に使わない。表の削除は切戻し期間の終了後、別の migration で行う。

自動テストは GitHub の外部 API だけを置き換え、実際の Better Auth callback とローカル D1 を通して本人照合・state 改ざんと再利用・PKCE・CSRF・期限切れ・logout・連携途中の session 失効・退会を確認する。GitHub App の実際の認可画面と本番ドメインでの login・連携は、反映後に本人が確認する。GitHub Actions OIDC と content origin の隔離用 session は別の仕組みとして維持する。

## repository を deck に連携する

本人は deck ごとに repository と許可 branch を連携する。一つの repository を複数の deck に連携できる。

1. ログイン中に `POST /decks/connect`（form: `deck`・`repository`・`branches`）を送る。同一 origin の要求だけを受け付け、入力を検証してから GitHub の認可へ移動する。
2. callback で、連携を開始した元の session が今も有効で、GitHub の user と一致することを確かめる。連携では新しいログイン session を発行せず、途中の logout・別の login への置き換えを拒否する。そのうえで user token を使って `GET /repos/{owner}/{repo}` を読む。`permissions.admin` が true の場合だけ、repository ID・owner ID・正式名・許可 ref を `repository_bindings` に保存する。token はその場で失効させる。
3. GitHub App を installation していない private repository は見えないため 404、管理権限がない場合は 403 を返し、何も保存しない。他の owner の deck は 409 で拒否する。
4. `GET /api/decks` は本人の deck と連携情報を返す。

deck ID は英小文字・数字・ハイフンの64文字以内、branch は10個までとする。連携の確認は登録時に行い、登録後の権限の喪失は upload 時の OIDC 照合（repository ID・owner ID・ref）と本人の allowlist で止める。

## 受領履歴を確認する

本人は `/decks` でデッキの一覧を、`/decks/:deck` でデッキごとの受領履歴を確認できる。連携ページ（`/decks/new`）には連携フォームと、GitHub Actions の workflow の例を載せる。例の Action は配布名が決まるまで commit SHA で参照するため、`src/decks/pages.ts` の `ACTION_REF` を Action の変更に合わせて更新する。deck ID の `new` と `connect` は `/decks` 配下の固定 path と重なるため、連携では受け付けない。JSON は `GET /api/decks/:deck/deployments`（新しい順に50件。続きがある場合は応答の `nextCursor` を `before` に渡す。cursor は作成時刻と ID の組で、同じ時刻の版も漏れなく辿れる）を返す。

各版には commit・ref・実行番号・状態・開始時刻・失敗理由・受領ファイル数を表示する。受信中と期限切れの版は未受領のファイルを20件まで示す。期限を過ぎた受信中の版は、清掃の前でも期限切れとして表示する。画面では開始の拒否の理由を日本語で示す。

ログインしていない場合は 401、他の owner のデッキと存在しないデッキはどちらも 404 にして、存在を区別させない。画面はサービス自身の HTML だけを描画し、`default-src 'none'` の CSP で配信する。ファイル名などの値はエスケープする。

## 期限切れと orphan の清掃

Cron（仮の値で毎時17分）が `src/uploads/cleanup.ts` を実行する。

1. 期限を過ぎた `uploading` の session を `expired` にし、受信 lease を外す。予約容量は状態から計算するため、この時点で解放される。
2. `ready`・`failed`・`expired` になってから猶予期間（仮の値1時間、`orphanGraceSeconds`）を過ぎた deployment の R2 prefix を一度だけ調べる。`ready` は file map が参照する object を残し、参照されない object だけを削除する。`failed`・`expired` は object をすべて削除し、受領を取り消す。
3. 削除が終わった deployment に `swept_at` を記録する。猶予期間内の object が残る場合は記録せず、次回にもう一度調べる。

一回の実行で古い順に10件までを調べる。一件の失敗は記録して残りを続ける。失敗した deployment は仮の値で6時間後まで後回しにし、他の deployment の清掃を妨げない。`failed`・`expired` の受領は、object がすべて消えてから取り消す。猶予期間は受信 lease より1分以上長くなければならない。ファイル受信は R2 に書き込む直前に lease がまだ有効かを D1 で確かめ、期限切れの確定で lease を外された受信は書き込まない。ただし確認の後の書き込みが終わる時刻には上限がないため、清掃済みの `ready`・`expired` の deployment も仮の値で7日ごとに再び調べる。後から書き込まれた object も、次の再清掃で回収される。一回の実行では、まだ清掃していない deployment を優先し、次に前回の清掃から最も時間の経った deployment を調べる。開始の拒否は object を持たないため、作成時に清掃済みとして記録する。各手順は繰り返しても同じ結果になる。途中で失敗しても次の実行で続きから収束し、使用量を二重に増減しない。ローカルでは `wrangler dev --test-scheduled` で起動し、`/__scheduled?cron=17+*+*+*+*` で実行できる。

公開・限定公開と読者 URL は F02・F03 で扱う。ready object を手動削除して容量を空けず、必要な削除手順を次の実装で用意する。

認証の根拠は [GitHub OIDC claims](https://docs.github.com/en/actions/reference/security/oidc) と [GitHub discovery](https://token.actions.githubusercontent.com/.well-known/openid-configuration)、[jose の検証 API](https://github.com/panva/jose/blob/main/docs/jwt/verify/functions/jwtVerify.md) を参照する。
