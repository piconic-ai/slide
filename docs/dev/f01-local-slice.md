# アップロードを試す

ビルド済みのファイルを受け取って、公開されていない、変更できない版(ready の deployment)にする仕組みの、状態・上限・確かめ方をまとめる。受け取りの入口、認可、スライドの作り方は [ドロップして置くための実装設計](f22-browser-drop.md) にある。受け取りは、スライドを一般公開しない。公開は [公開管理の実装設計](f02-publication.md) が扱う。

GitHub のリポジトリからスライドを送る仕組み(リポジトリの連携、公式の Action、GitHub Actions の OIDC での開始)は、取り除いた([GitHub からスライドを更新する](../features/f01-github-deploy.md))。

## 受け取りの状態と上限

受け取りは、開始(`POST /api/slides/:deck/uploads`)、ファイルごとの送信、確定(finalize)の順に進む。開始は、ログイン中の作者の session で認可する。開始の応答が渡す一時の資格情報で、送信・状態確認・確定を行う。同じ `attempt` の開始をやり直すと、同じ受け取りを続け、以前の資格情報は失効する。session の有効期限は作成時に決まる。資格情報は session より短い期限を持ち、session の期限を超えない。

| 状態 | 意味 | 同じ attempt で開始をやり直したとき |
| --- | --- | --- |
| `uploading` | 受信中。期限内ならファイルを受け付ける | 認証情報を更新して再開する |
| `ready` | 全ファイルを受領し、変更できない | 読み取り用の認証情報を更新する |
| `expired` | 期限切れ。受信中の期限切れも同じ扱い | 409 `session_expired`。新しい attempt で始める |
| `failed` | 失敗理由を記録して終了した | 409 `session_failed`。新しい attempt で始める |

期限切れの資格情報は 401 と `code: credential_expired` を返す。送り手は、同じ `attempt` で開始をやり直せば、同じ受け取りを続けられる。開始のたびに、作者の session と、スライドの持ち主であることを確かめ直すので、期限の更新だけで権限の変更を迂回できない。session の期限切れや失敗後の送信・finalize は、やり直しても直らないため 409 と `session_expired`・`session_failed` を返す。状態確認の応答は資格情報の期限 `credentialExpiresAt` と、失敗時の `failureReason` を含む。ファイルの受信と finalize は、D1 の更新条件でも session の期限を確認する。

初期上限は100ファイル、一ファイル5MiB、一版10MiB、保持・予約合計50MiB、24時間で5回、同時アップロード1件、deck 20個。session の有効期間24時間、認証情報の有効期間1時間、ファイル受信の lease 120秒も仮の値として同じ設定に含める。値は `src/uploads/limits.ts` の既定値を使い、`wrangler.jsonc` の `UPLOAD_LIMITS` で項目ごとに上書きする。有効期限とファイル数・容量の上限は次に作成する session から適用し、作成済み session の再送には適用しない。受信 lease は30秒から15分の運用値として、作成済み session も含め次に受信するファイルから適用する。不正な設定では session の作成・再送とファイルの受信が失敗し、既存の認証情報は変えない。

認証後に上限で開始を拒否した場合は、拒否理由を `failed` の deployment として記録し、`code: start_rejected` と `reason`・`deploymentId` を返す。413・409 は同じ attempt の再試行では解消しない。同じ attempt の再送は 409 `session_failed` と同じ `reason` を返す。拒否の記録は容量を予約せず、開始回数にも数えない。記録は24時間で20件（仮の値、`refusalsPerDay`）までとし、超えた拒否は `deploymentId` なしで理由だけを返す。別のアップロードが進行中の場合や、進行中の session の予約分だけで容量を超える場合、同じ attempt の同時開始が競合した場合は、一時的な状態として記録しない。429 `upload_busy` で同じ attempt の再試行を促す。記録されなかった拒否は、上限が空けば同じ attempt で再試行できる。保持・予約の容量、同時アップロード、24時間の開始回数と拒否の記録は、アカウントごとに数える。アカウントは deck の所有者（`decks.owner_user_id`）で、その deck に属する deployment だけを集計する。deck に属さない deployment（deck を導入する前の試行）は、どのアカウントにも数えない。

| reason | status | 意味 |
| --- | --- | --- |
| `too_many_files` | 413 | ファイル数が一版の上限を超える |
| `file_too_large` | 413 | 一ファイルの上限を超える |
| `deployment_too_large` | 413 | 一版の合計が上限を超える |
| `author_bytes_exceeded` | 409 | 保持中と予約中の合計が上限を超える |
| `daily_starts_exceeded` | 409 | 24時間の開始回数が上限に達した |

ファイルは SHA-256 を指定して R2 に保存し、R2 自身にも内容を検証させる。finalize は受領済みの全ファイルについて R2 の object を確認し、欠損・size 違い・SHA-256 の不一致・checksum のない object を見つけると受領を取り消す。取り消した object は R2 からも削除する。そのうえで 409 `files_missing` と不足一覧を返すので、uploader は再送すれば続けられる。R2 の一時的な障害で確認できない場合は、受領を変えずに 429 `upload_busy` を返す。この変更より前に受信した object は checksum を持たないため、受信中の session は finalize 時に再送が必要になる。ファイル数の上限は、finalize が一回で全 object を確認するため500までとする。ready の確定は D1 の一回の条件付き更新で行い、途中で中断しても中間状態は残らない。同じ finalize の再送は同じ ready を返す。

ready にするとき、`index.html` の先頭 64 KiB から、コメント、`script`・`style` などの中、属性値の中を除いた最初の `<title>` を読み、文字参照を `entities` で戻して空白をまとめ、200 文字までを `deployments.title` に保存する。スライドの一覧はこの題名で資料を示す。`<title>` がない・空のとき、または R2 から読めないときは NULL のまま ready にする。題名は一覧に出すだけなので、読めなくても受領は止めない。同じ 64 KiB から、同じ範囲を除いた最初の `<meta name="description">` の `content` も読み、300 文字までを `deployments.description` に保存する。ないとき・空のときは NULL にする。同じく最初の `<meta property="og:image">`（`name` でもよい）のうち、`content` がスライド内の画像ファイル（`.png`・`.jpg`・`.jpeg`・`.webp`・`.gif`）を相対 URL で指すものを読み、スライドの root からのパス（300 文字まで）を `deployments.cover_path` に保存する。別サイトの URL（`https://…`、`//…`）は採らない。サービスが出す表紙は、自分が保管するファイルに限るためである。パスは保存済みのファイルと同じく NFC に揃える。その版にそのパスのファイルがないときも NULL にし、後に書かれた `og:image` は見ない。

R2 は非公開で、受領票と保存ファイルの取得にも Bearer 認証が必要。ready のファイルは変更できない。

## ローカルで確認する

```sh
pnpm install
pnpm exec wrangler types --include-runtime=false
pnpm exec wrangler d1 migrations apply slide --local
pnpm exec wrangler dev --local --port 8794 --infer-origin-from-routes=false \
  --var PUBLIC_ORIGIN:http://localhost:8794 \
  --var BETTER_AUTH_SECRET:local-demo-only-better-auth-secret-000000 \
  --var MAIL_OUTBOX:on
```

受け取りの開始は作者の session で認可するので、ログインの設定(`PUBLIC_ORIGIN`、`BETTER_AUTH_SECRET`、コードを送信箱に書く `MAIL_OUTBOX`)が要る。`.dev.vars` に設定済みなら、`--var` は要らない。

別の terminal で実行する。

```sh
node scripts/verify-upload.mjs http://localhost:8794
pnpm exec tsc --noEmit
pnpm test
```

確認用 script は、ローカルの D1 に作者の session とスライドの行だけを作り、受け取りは実際の HTTP・送り手(`scripts/upload.mjs`)・R2 を通す。session のない開始、ログインに使えない token(Bearer)での開始(F22-AC18)、ほかの origin からの開始、JSON でない開始、持っていないスライドへの開始が断られること、hash 不一致、ファイルが足りない確定の拒否、開始のやり直しによる資格情報の更新、ready 後の上書き拒否、finalize 再送、匿名取得の拒否を確認する。production の認証を迂回する route は設けない。

`--persist-to` を付けて起動した Worker には、同じ置き場を `SLIDE_PERSIST_TO` で渡す。Worker の `BETTER_AUTH_SECRET` が既定の値(`.agents/skills/verify-slide/launch.sh` が渡す値)と違うときは、同じ値を環境変数 `BETTER_AUTH_SECRET` で渡す。この script は作者の session を作り直すので、前に使っていた cookie は使えなくなる。

## 配置先

Worker `slide`、domain `slide.community`、D1 `slide`、非公開 R2 `slide-uploads` を使用する。反映の手順は [本番に反映する](deploy.md) にまとめた。ready の保持容量は期限後も使用量に含める。

## 本人ログイン

2026-11-22(第二スコープ)に、GitHub でのログインをやめ、メールに送る 6 桁のコードだけにした。設計は [メールのコードでログインする実装設計](f28-email-login.md) にある。ここには、変わらない部分だけを書く。

- ブラウザの本人確認と session 管理には [Better Auth](https://better-auth.com/docs/plugins/email-otp) の emailOTP を使う。`/login`(メールアドレス、コード)と `/welcome`(はじめの 1 回だけ、ハンドルと表示名)がページである。
- ログインできるのは、運営が招待の一覧(D1 の `invited_emails`。運営の画面で足す・外す)に入れたメールアドレスの人だけ。招待されていないアドレスでも、画面は同じ「コードを送りました」になり、コードは送られない。
- `__Host-slide_owner` cookie は host-only・Secure・HttpOnly・SameSite=Lax、有効期限 24 時間で、使うと 1 時間に 1 度まで期限と cookie を延ばす。D1 の `auth_session` で session を管理し、cookie は Better Auth が署名する。session は端末ごとに 1 行で、同じ本人が複数の端末で同時にログインできる(2026-11-25、0049 で 1 人 1 つの制約を外した)。
- `POST /auth/logout` は同一 origin の要求だけを受け付け、session を削除する。`GET /auth/owner` はログイン中の本人を返す。各要求で、メールアドレスがいま招待の一覧にいるかを確かめる。外された人の session は、次の操作で消える。
- `auth_user`・`auth_account`・`auth_session`・`auth_verification` は認証専用で、共有 URL の固定 handle を持つ `accounts` とは分ける。
- `BETTER_AUTH_SECRET`(32 文字以上のランダムな値)を `pnpm exec wrangler secret put BETTER_AUTH_SECRET` で登録する。変更すると、既存の署名 cookie が使えなくなる。コードの保存にも、この値で鍵をかける。
- ローカルでは `.dev.vars.example` を `.dev.vars` に複写して `BETTER_AUTH_SECRET`、`PUBLIC_ORIGIN`、`MAIL_OUTBOX=on` を設定する。`__Host-` cookie を使うため HTTPS の localhost を推奨する。必要な設定がない間、コードを求める要求は 503 を返す。

## 受領履歴を確認する

本人は `/slides` でスライドの一覧を、`/slides/:deck`(スライドの編集)で、読者に見えている版と、まだ公開していない新しい版の 2 行までを確認できる。版の全部の一覧は、画面にはなく、JSON で読む。JSON は `GET /api/slides/:deck/deployments`（新しい順に50件。続きがある場合は応答の `nextCursor` を `before` に渡す。cursor は作成時刻と ID の組で、同じ時刻の版も漏れなく辿れる）を返す。`GET /api/slides` は、本人のスライドの名前(slug)の一覧を返す。

JSON の各版は、出どころ(ブラウザ、AI エージェント)・状態・受領ファイル数・開始した日・deployment の ID・失敗理由を持つ。commit や実行番号は持たない。受信中と期限切れの版は未受領のファイルを20件まで示す。期限を過ぎた受信中の版は、清掃の前でも期限切れとして表示する。これらは作者向けの画面には出さない(F02-AC8)。画面が理由を示すのは、受け取りを断られたドロップ枠の中だけで、画面の言語で示す。

ログインしていない場合は 401、他の owner のスライドと存在しないスライドはどちらも 404 にして、存在を区別させない。画面はサービス自身の HTML だけを描画し、`default-src 'none'` の CSP で配信する。ファイル名などの値はエスケープする。

## 期限切れと orphan の清掃

Cron（仮の値で毎時17分）が `src/uploads/cleanup-store.ts` を実行する。

1. 期限を過ぎた `uploading` の session を `expired` にし、受信 lease を外す。予約容量は状態から計算するため、この時点で解放される。
2. `ready`・`failed`・`expired` になってから猶予期間（仮の値1時間、`orphanGraceSeconds`）を過ぎた deployment の R2 prefix を一度だけ調べる。`ready` は file map が参照する object を残し、参照されない object だけを削除する。`failed`・`expired` は object をすべて削除し、受領を取り消す。
3. 削除が終わった deployment に `swept_at` を記録する。猶予期間内の object が残る場合は記録せず、次回にもう一度調べる。

一回の実行で古い順に10件までを調べる。一件の失敗は記録して残りを続ける。失敗した deployment は仮の値で6時間後まで後回しにし、他の deployment の清掃を妨げない。`failed`・`expired` の受領は、object がすべて消えてから取り消す。猶予期間は受信 lease より1分以上長くなければならない。ファイル受信は R2 に書き込む直前に lease がまだ有効かを D1 で確かめ、期限切れの確定で lease を外された受信は書き込まない。ただし確認の後の書き込みが終わる時刻には上限がないため、清掃済みの `ready`・`expired` の deployment も仮の値で7日ごとに再び調べる。後から書き込まれた object も、次の再清掃で回収される。一回の実行では、まだ清掃していない deployment を優先し、次に前回の清掃から最も時間の経った deployment を調べる。開始の拒否は object を持たないため、作成時に清掃済みとして記録する。各手順は繰り返しても同じ結果になる。途中で失敗しても次の実行で続きから収束し、使用量を二重に増減しない。ローカルでは `wrangler dev --test-scheduled` で起動し、`/__scheduled?cron=17+*+*+*+*` で実行できる。

公開・限定公開と読者 URL は F02・F03 で扱う。ready object を手動削除して容量を空けない。
