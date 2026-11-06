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

同じ repository・run・attempt・inventory なら再開し、別 inventory なら同じ run 内で別 deployment を作る。再認証すると以前の認証情報は失効する。現在の有効期間は作成から24時間で、期限後の更新は未対応。

初期上限は100ファイル、一ファイル5MiB、一版10MiB、保持・予約合計50MiB、24時間で5回、同時アップロード1件。R2 は非公開で、受領票と保存ファイルの取得にも Bearer 認証が必要。ready のファイルは変更できない。

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
