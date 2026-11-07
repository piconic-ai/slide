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
| deck の連携（`/decks/new`） | 作者（本人のログインが必要） |
| Issue のクローズ | 作者、または作者が許可したエージェント |

GitHub App の private key（`.pem`）は、ブラウザの本人確認では使わない。生成した場合も、repository・wrangler secret・エージェントには渡さない。client secret もエージェントに渡さず、作者が `wrangler secret put` で直接入力する。

## 初回の設定

1. GitHub App を作成する。権限と callback URL は [本人ログイン](f01-local-slice.md#本人ログイン) に従う。
2. Client ID を `wrangler.jsonc` の `GITHUB_APP_CLIENT_ID` に書き、PR で反映する。
3. client secret を登録する。

   ```sh
   pnpm exec wrangler secret put GITHUB_APP_CLIENT_SECRET
   ```

4. 試用の配信ドメイン `kobaken.co` の zone に、Proxied の DNS レコード `*`（`A 192.0.2.1`）を作る。AAAA だけのレコードでは Cloudflare が IPv6 のアドレスしか返さず、IPv4 だけの環境から名前を解決できない。版ごとの origin `d-<deployment ID>.kobaken.co` を Worker の route `*.kobaken.co/*` に届けるため。route は deploy で作られる。
5. zone の Email Obfuscation、Automatic HTTPS Rewrites、Replace insecure JavaScript libraries は既定の On のままでよい。作者のファイルは `Cache-Control: no-transform` で返し、Cloudflare に本文を書き換えさせない。書き換えうる機能が効くと weak な `ETag` も外れ、browser の再検証で 304 を返せない（[読者向けの配信と内部 cache](f03-sharing.md#読者向けの配信と内部-cache)）。Configuration Rule は要らない。

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
| `curl -s -o /dev/null -w '%{http_code}' https://d-00000000-0000-4000-8000-000000000000.kobaken.co/` | 存在しない deployment の origin で `404` |
| `curl -s -o /dev/null -w '%{http_code}' https://www.kobaken.co/decks` | 管理画面の route は `kobaken.co` 側で応答せず `404` |
| 一般公開中の版の origin に `curl -s -o /dev/null -D -` で GET を 2 回送る | どちらも `200`・`Cache-Control: no-cache, no-transform`・`ETag: W/"…"`。`X-Content-Cache` は 1 回目が `MISS`（すでに温まっていれば `HIT`）、2 回目が `HIT` |
| 上の `ETag` を `If-None-Match` に付けて送る | `304`。`ETag` が付かないときは、`Cache-Control` に `no-transform` があるかを確かめる |
| `pnpm exec wrangler r2 bucket dev-url get slide-uploads` と `pnpm exec wrangler r2 bucket domain list slide-uploads` | r2.dev の公開が無効で、custom domain がない。R2 を gateway の外から読めない |

アップロードの経路全体は、[実物を試す](f01-local-slice.md#実物を試す) の確認用 workflow で確かめる。ログインした本人にしか見えない履歴ページは、作者がブラウザで確認する。

## 戻す

deploy だけを戻す場合は、Cloudflare の Workers の画面か `pnpm exec wrangler rollback` で前の版に戻す。migration は戻さず、前の版のコードが新しいスキーマでも動くことを PR の時点で確かめておく。D1 を戻す必要がある場合は、[D1 を復元する](#d1-を復元する) の手順に入る前に作者と判断する。

## D1 を復元する

D1 は [Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/) で、過去の任意の時点に戻せる。メンテナンスの切り替えは [サービスの基本の備え](service-basics.md#エラーページとメンテナンス) を参照する。設定は不要で、Workers Paid では 30 日、Free では 7 日前まで戻せる。`wrangler d1 export` のバックアップは、それより古い時点に戻す場合と、D1 の外に控えを残す場合に使う。復元は本番の書き込みなので、作者が行うか、作者の許可を得てから行う。

1. メンテナンスを始める。復元からセッションの削除までの間に、戻った行を HTTP や cron に使わせないため。メンテナンス中は、管理画面・API・アップロード・content domain での配信が `503` を返し、cron の掃除も止まる。

   ```sh
   pnpm exec wrangler secret put MAINTENANCE   # 値に on を入力する
   ```

   次の 3 つを確かめてから先へ進む。`503` は新しい request が止まったことしか示さないため、切り替え前に始まった処理が終わるのを別に待つ。
   - `curl -s -o /dev/null -w '%{http_code}' https://slide.piconic.ai/decks` が `503` になる。
   - 切り替え前に始まった cron が終わっている。cron は最長 15 分動くので、切り替え前の最後の cron（毎時 17 分）の開始から 15 分経つまで待つ。
   - `pnpm exec wrangler tail slide --format pretty` を見て、`503` 以外の応答で終わる request が 1 分以上出ていない。

   HTTP には実行時間の上限がない。そのため、body を読み込み中の request が、この後も D1 に書くことがある。待機だけでは収束を保証できないので、手順 6 で、復元した時点より後に書かれた行を確かめる。

   **残るリスク**：この手順は、復元をまたぐ書き込みを完全には防がない。メンテナンスを始める前に受け付け、上の待機（最短でも 15 分）を過ぎても body を読み続けている request は、復元の後や手順 6 の確認の後にも D1 へ書ける。公開状態の変更のように新しい deployment を作らない書き込みは、手順 6 の確認でも見つからない。Workers には実行中の request を止める手段がなく、そうした request は通常の利用では起きないため、このリスクは受け入れる。コードで防ぐ（メンテナンス前に始まった request の書き込みを拒否する）必要が出たら、別の issue で扱う。

2. 今の時点の bookmark を控える。復元をやり直すときに、この bookmark へ戻せる。

   ```sh
   pnpm exec wrangler d1 time-travel info slide --json
   ```

3. 戻したい時点の bookmark を確かめる。時刻は RFC3339 か Unix 秒で指定する。

   ```sh
   pnpm exec wrangler d1 time-travel info slide --timestamp=2026-11-06T09:00:00Z
   ```

4. 復元する。データベース全体が、その時点の内容に置き換わる。

   ```sh
   pnpm exec wrangler d1 time-travel restore slide --timestamp=2026-11-06T09:00:00Z
   ```

5. 復元した時点より後に適用した migration は、`d1_migrations` の記録ごと戻っている。`migrations list` で未適用の migration を確かめる。今のコードのまま動かすなら、ここで適用し直す。前のスキーマで動かす場合も、コードのロールバックはここでは行わず、手順 7 で行う。Worker の version は secret も含めて保存されているため、手順 1 より前の version に戻すと `MAINTENANCE` がなくなり、メンテナンスが外れる。

   ```sh
   pnpm exec wrangler d1 migrations list slide --remote
   pnpm exec wrangler d1 migrations apply slide --remote
   ```

6. ログインと作者限定のセッションを、すべて失効させる。復元によって、ログアウトや公開状態の変更で失効させたセッションが戻るため。本人は、ログインし直せば使い続けられる。

   ```sh
   pnpm exec wrangler d1 execute slide --remote --command "DELETE FROM owner_sessions; DELETE FROM preview_launches; DELETE FROM content_sessions"
   ```

   続けて、復元した時点（Unix 秒）より後に作られた deployment がないかを確かめる。切り替え前に始まった request が、復元の後に書いた行である。あれば、その deployment を作者と確かめ、不要なら行を消す。消した deployment のファイルは、R2 に残る（下の「復元した時点より後に始めた版」と同じ扱い）。

   ```sh
   pnpm exec wrangler d1 execute slide --remote --command "SELECT id, deck_id, state, created_at FROM deployments WHERE created_at > <restored Unix seconds>"
   ```

7. メンテナンスを終える。今のコードのまま動かす場合は、secret を消す。前のスキーマで動かす場合は、secret を消す代わりに、復元した時点で動いていたコードの version に戻す。`wrangler deployments list` で、復元した時点に配信していた version ID を確かめ、`wrangler rollback` にその ID を渡す。引数を省くと直前の version が選ばれ、それはメンテナンスを始める前の今のコードなので、復元したスキーマとは合わない。ロールバックした時点で、その version の設定に戻り、メンテナンスも外れる。secret を変えた後のロールバックは、wrangler が確認を求めることがある。表示された差分が `MAINTENANCE` だけであることを確かめてから進める。

   ```sh
   pnpm exec wrangler secret delete MAINTENANCE
   # or, to run the code for the restored schema:
   pnpm exec wrangler deployments list
   pnpm exec wrangler rollback <version ID deployed at the restored point>
   ```

8. [反映後に確認する](#反映後に確認する) の確認を行う。deployment の件数は、復元した時点の件数と比べる。

R2 は復元されない。そのため、復元の後は D1 と R2 の内容が次のようにずれる。
- **公開できる版**：`ready` の deployment が参照するファイルは、cron の掃除で消えない。そのため、復元した時点で `ready` だった版は、そのまま読める。
- **アップロード中だった版**：復元した時点でアップロード中だった deployment は、`uploading` に戻る。そのファイルは、その後の掃除で R2 から消えていることがある。この deployment は期限切れになると掃除され、D1 と R2 の内容が揃う。続けて使う deck は、作者がもう一度アップロードする。
- **復元した時点より後に始めた版**：これらの deployment は D1 から消えるが、R2 には `<deployment ID>/` で始まるファイルが残る。cron の掃除は D1 にある deployment しか見ないため、これらのファイルは自動では消えない。費用が問題になる量であれば、作者が Cloudflare の画面で確かめて消す。
