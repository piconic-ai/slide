# 本番に反映する

Worker `slide`、domain `slide.piconic.ai`、D1 `slide`、非公開 R2 `slide-uploads` へ変更を反映する手順。migration を含む変更は、ここに書いた順序で行う。

## 作業の分担

本番に影響する操作は、作者が行うか、作者の許可を得てから行う。エージェントは許可なく merge・deploy しない。

| 操作 | 行う人 |
| --- | --- |
| GitHub App の作成・インストール、callback URL の登録 | 作者 |
| client secret の登録（`wrangler secret put`） | 作者 |
| migration の適用、deploy | 作者、または作者が許可したエージェント |
| repository variable の変更、確認用 workflow の実行 | 作者、または作者が許可したエージェント |
| deck の連携（`/decks`） | 作者（本人のログインが必要） |
| Issue のクローズ | 作者、または作者が許可したエージェント |

GitHub App の private key（`.pem`）は、ブラウザの本人確認では使わない。生成した場合も、repository・wrangler secret・エージェントには渡さない。client secret もエージェントに渡さず、作者が `wrangler secret put` で直接入力する。

## 初回の設定

1. GitHub App を作成する。権限と callback URL は [本人ログイン](f01-local-slice.md#本人ログイン) に従う。
2. Client ID を `wrangler.jsonc` の `GITHUB_APP_CLIENT_ID` に書き、PR で反映する。
3. client secret を登録する。

   ```sh
   pnpm exec wrangler secret put GITHUB_APP_CLIENT_SECRET
   ```

## migration を含む変更を反映する

1. 本番 D1 をバックアップする。出力は repository に入れない。

   ```sh
   pnpm exec wrangler d1 export slide --remote --output "${TMPDIR:-/tmp}/slide-backup-$(date +%Y%m%d%H%M).sql"
   ```

2. 未適用の migration を確認し、適用する。

   ```sh
   pnpm exec wrangler d1 migrations list slide --remote
   pnpm exec wrangler d1 migrations apply slide --remote
   ```

3. deploy する。migration は deploy より先に適用する。新しいコードが新しい列や表を前提にしているため。

   ```sh
   pnpm deploy
   ```

migration を含まない変更は、3 だけを行う。

## 反映後に確認する

| 確認 | 期待する結果 |
| --- | --- |
| `curl -sI https://slide.piconic.ai/auth/github` | `303` で GitHub の認可画面へ移動し、URL に `client_id` と `code_challenge_method=S256` を含む |
| `curl -s -o /dev/null -w '%{http_code}' https://slide.piconic.ai/api/decks` | 未ログインで `401` |
| `curl -s -o /dev/null -w '%{http_code}' https://slide.piconic.ai/decks/try-static` | 未ログインで `401` |
| `pnpm exec wrangler d1 execute slide --remote --command "SELECT state, count(*) FROM deployments GROUP BY state"` | 反映前にあった `ready` の件数が減っていない |

アップロードの経路全体は、[実物を試す](f01-local-slice.md#実物を試す) の確認用 workflow で確かめる。ログインした本人にしか見えない履歴ページは、作者がブラウザで確認する。

## 戻す

deploy だけを戻す場合は、Cloudflare の Workers の画面か `pnpm exec wrangler rollback` で前の版に戻す。migration は戻さず、前の版のコードが新しいスキーマでも動くことを PR の時点で確かめておく。D1 を戻す必要がある場合は、バックアップから復元する前に作者と判断する。
