# GitHub Actions から送って結果を確認する

最初に触って確認するための F01 の実装。ビルド済み directory を送信し、非公開の ready deployment と公開可能な結果レポートを作る。Issue #2 全体は未完了で、アップロードによるスライドの一般公開は行わない。

## 実物を試す

1. [アップロード確認 workflow](../../.github/workflows/try-upload.yml) を実行する。配置後に repository variable `SLIDE_UPLOAD_SMOKE_ENABLED=true` を設定すると、開発 branch への push で起動する。未配置の間は実行しない。
2. 実行結果の artifact `slide-upload-reports` をダウンロードして展開する。有効期間は1日。
3. `static.json` または `markdown.json` で deploymentId・commit・state・statusUrl を確認する。

workflow はチェックイン済み HTML と、作者側の CI が Marp で Markdown から作った HTML を同じ uploader で送る。サービス内でビルドしない。結果レポートには認証情報を含めず、公開 repository の artifact として扱う。ブラウザに読み込む受領票としては使用できない。CI から作った deployment を本人がブラウザでプレビューする導線は、後続の本人ログインの実装で用意する。

## 作者の CI から送る

Node.js 22 以降と `id-token: write` を設定し、作者側のビルド後に実行する。

```sh
mkdir -p "$RUNNER_TEMP/public-reports"
SLIDE_REPORT_FILE="$RUNNER_TEMP/public-reports/upload.json" \
  node scripts/upload.mjs path/to/prebuilt https://slide.piconic.ai
```

uploader は symlink を拒否し、path・size・SHA-256 の一覧を作る。GitHub OIDC と専用の認証情報を交換し、未受領ファイルを送って ready にする。完了時の `SLIDE_REPORT_FILE`、stdout と `GITHUB_OUTPUT` には deploymentId・commit・state・statusUrl のみを出す。レポートの既存ファイルは上書きしない。GitHub Actions では runner に認証情報のマスク登録を行い、公開ログへの表示も防ぐ。

`SLIDE_CREDENTIAL_FILE` はローカル専用の private 受領票 `{deploymentId, credential, api, statusUrl}` を mode0600 で新規作成する。GitHub Actions では認証・session 作成前にこの指定を拒否する。結果レポート・private 受領票・`GITHUB_OUTPUT` は異なるファイルパスを指定する。

ローカルで認証情報を保持して再開・プレビューする場合のみ、無視対象の `.private/receipts/` に受領票を保存する。既存ファイルは上書きしない。

```sh
mkdir -p .private/receipts
SLIDE_CREDENTIAL_FILE=".private/receipts/local.json" \
  node scripts/upload.mjs path/to/prebuilt http://localhost:8794
```

ローカル実行は `SLIDE_DEPLOYMENT_ID`・`SLIDE_UPLOAD_CREDENTIAL` を環境変数で渡し、既存 session を再開する。認証情報をコマンドの引数や URL に入れない。private 受領票を artifact・ログ・repository に保存しない。アップロード先の Slide に private 受領票を読み込むと、受領状態と HTML 単体のプレビューを確認できる。ブラウザは認証情報を URL や browser storage に保存せず、HTML は同一 origin の権限を持たない iframe sandbox 内で表示する。相対パスの画像・CSS・JS は読み込まない。

## 初期の連携設定

`wrangler.jsonc` に repository ID `1446590227`、owner ID `248307881`、actor ID `722500` を事前設定している。許可 ref は `refs/heads/main` と、実動確認用の `refs/heads/f01/upload-contract`。後者は開発中の確認用で、マージ後に取り除く。

OIDC の署名・issuer・audience・有効期限・発行時刻・not-before と numeric claim を検証し、push と workflow_dispatch のみ受け付ける。commit と実行番号は署名済み claim を使う。repository 移転は owner ID の不一致で拒否する。GitHub のブラウザログイン、repository 登録画面、管理権限の再確認は後続の実装。

同じ repository・run・attempt・inventory なら再開し、別 inventory なら同じ run 内で別 deployment を作る。再認証すると以前の認証情報は失効する。session の有効期限は作成時に決まる。認証情報は session より短い期限を持ち、session の期限を超えない。

| 状態 | 意味 | 同じ attempt の再認証 |
| --- | --- | --- |
| `uploading` | 受信中。期限内ならファイルを受け付ける | 認証情報を更新して再開する |
| `ready` | 全ファイルを受領し、変更できない | 読み取り用の認証情報を更新する |
| `expired` | 期限切れ。受信中の期限切れも同じ扱い | 409 `session_expired`。新しい attempt で始める |
| `failed` | 失敗理由を記録して終了した | 409 `session_failed`。新しい attempt で始める |

期限切れの認証情報は 401 と `code: credential_expired` を返す。uploader は同じ attempt で fresh OIDC token を取得して再認証すれば、同じ session を続けられる。再認証では repository・ref・actor を再び検証するため、期限の更新だけで権限の変更を迂回できない。session の期限切れや失敗後の送信・finalize は、再認証では直らないため 409 と `session_expired`・`session_failed` を返す。同時に再認証した場合は一方だけが認証情報を更新し、他方は 409 `session_changed` を返す。状態確認の応答は認証情報の期限 `credentialExpiresAt` と、失敗時の `failureReason` を含む。ファイルの受信と finalize は、D1 の更新条件でも session の期限を確認する。

初期上限は100ファイル、一ファイル5MiB、一版10MiB、保持・予約合計50MiB、24時間で5回、同時アップロード1件。session の有効期間24時間、認証情報の有効期間1時間、ファイル受信の lease 120秒も仮の値として同じ設定に含める。値は `src/uploads/limits.ts` の既定値を使い、`wrangler.jsonc` の `UPLOAD_LIMITS` で項目ごとに上書きする。有効期限とファイル数・容量の上限は次に作成する session から適用し、作成済み session の再送には適用しない。受信 lease は30秒から15分の運用値として、作成済み session も含め次に受信するファイルから適用する。不正な設定では session の作成・再送とファイルの受信が失敗し、既存の認証情報は変えない。uploader の事前検査は既定値のままで、サーバーの設定とは連動していない。

認証後に上限で開始を拒否した場合は、拒否理由を `failed` の deployment として記録し、`code: start_rejected` と `reason`・`deploymentId` を返す。同じ attempt の再送は 409 `session_failed` と同じ `reason` を返す。拒否の記録は容量を予約せず、開始回数にも数えない。別のアップロードが進行中の場合は一時的な状態として記録せず、429 `upload_busy` で同じ attempt の再試行を促す。

| reason | status | 意味 |
| --- | --- | --- |
| `too_many_files` | 413 | ファイル数が一版の上限を超える |
| `file_too_large` | 413 | 一ファイルの上限を超える |
| `deployment_too_large` | 413 | 一版の合計が上限を超える |
| `author_bytes_exceeded` | 429 | 保持中と予約中の合計が上限を超える |
| `daily_starts_exceeded` | 429 | 24時間の開始回数が上限に達した |

R2 は非公開で、受領票と保存ファイルの取得にも Bearer 認証が必要。ready のファイルは変更できない。

## ローカルで確認する

```sh
pnpm install
pnpm exec wrangler types --include-runtime=false
pnpm exec wrangler d1 migrations apply slide --local
pnpm exec wrangler dev --local --port 8794
```

別の terminal で実行する。

```sh
node scripts/verify-upload.mjs http://localhost:8794
pnpm exec tsc --noEmit
pnpm test
```

確認用 script はローカル D1 のみに session を作り、実際の HTTP・uploader・R2 を通す。不足時の再送、hash 不一致、ready 後の上書き拒否、finalize 再送、匿名取得の拒否を確認する。production の認証を迂回する route は設けない。

## 配置先と残りの作業

Worker `slide`、domain `slide.piconic.ai`、D1 `slide`、非公開 R2 `slide-uploads` を使用する。remote migration を適用してから通常の deploy を行う。

Issue #2 の完了までには、本人ログイン・repository 管理権限の再確認、期限切れの認証更新、失敗・期限切れと orphan の清掃、障害・並行実行からの復旧、本人の履歴画面が残る。現在は期限切れの session が予約容量を占有しなくなるが、放棄した R2 object の清掃は自動化していない。ready の保持容量は期限後も使用量に含める。

公開・限定公開と読者 URL は F02・F03 で扱う。ready object を手動削除して容量を空けず、必要な削除手順を次の実装で用意する。

認証の根拠は [GitHub OIDC claims](https://docs.github.com/en/actions/reference/security/oidc) と [GitHub discovery](https://token.actions.githubusercontent.com/.well-known/openid-configuration)、[jose の検証 API](https://github.com/panva/jose/blob/main/docs/jwt/verify/functions/jwtVerify.md) を参照する。
