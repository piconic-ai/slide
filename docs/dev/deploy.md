# 本番に反映する

Worker `slide`、domain `slide.community`、D1 `slide`、非公開 R2 `slide-uploads` へ変更を反映する手順。migration を含む変更は、ここに書いた順序で行う。

## 作業の分担

本番に影響する操作は、作者が行うか、作者の許可を得てから行う。エージェントは許可なく merge・deploy しない。

開発中のあいだ、作者は merge と deploy を開発ループに任せている(2026-11-16)。CI が通り、Pullfrog が最新の commit をレビューして直すべき指摘が残っておらず、仕様の未決事項に触れない変更が対象で、migration を含む変更も含む。データが消える migration(表や列の削除など)を含む PR だけは、merge の前に作者に確かめる。手順は `dev-loop` skill(`.agents/skills/dev-loop/SKILL.md`)にある。利用者が増えたら、この委任を見直す。

| 操作 | 行う人 |
| --- | --- |
| GitHub App の作成・インストール、callback URL の登録 | 作者 |
| client secret の登録（`wrangler secret put`） | 作者 |
| migration の適用、deploy | 作者、または作者が許可したエージェント |
| Issue のクローズ | 作者、または作者が許可したエージェント |

GitHub App の private key（`.pem`）は、ブラウザの本人確認では使わない。生成した場合も、リポジトリ・wrangler secret・エージェントには渡さない。client secret もエージェントに渡さず、作者が `wrangler secret put` で直接入力する。

## 初回の設定

1. GitHub App を作成する。権限と callback URL は [本人ログイン](f01-local-slice.md#本人ログイン) に従う。
   `BETTER_AUTH_SECRET` は `openssl rand -base64 32` で生成する。署名・暗号化に使う32文字以上のランダムな秘密値で、GitHub の client secret とは別にする。値を Git やチャットへ貼らず、次の `wrangler secret put` の入力欄へ登録する。ローカルと本番では別の値を使い、通常の deploy では変更しない。Better Auth 移行時は migration `0012_better_auth.sql` を適用して再ログインする。その移行では GitHub App の callback URL を変えない。callback URL は `PUBLIC_ORIGIN` から作るので、`PUBLIC_ORIGIN` を変える deploy では、GitHub App の設定の callback URL も同じタイミングで `<PUBLIC_ORIGIN>/auth/github/callback`（本番は `https://slide.community/auth/github/callback`）に変える。変えるまでログインできない。

   GitHub App は公開にする(App の設定の Advanced → Make public)。非公開の App は、持ち主のアカウント(organization なら、そのメンバー)しか認可も install もできず、招いた作者が `/auth/github` から進むと、GitHub の認可画面が 404 になる。この 404 は GitHub が返すもので、slide には届かない。公開にしても、ログインできるのは `AUTHOR_GITHUB_IDS` に登録した人だけで、ほかの人には招待制のページを返す([招いた作者の実装設計](f01-invited-authors.md))。

2. Client ID を `wrangler.jsonc` の `GITHUB_APP_CLIENT_ID` に書き、PR で反映する。
3. client secret を登録する。

   ```sh
   pnpm exec wrangler secret put GITHUB_APP_CLIENT_SECRET
   pnpm exec wrangler secret put BETTER_AUTH_SECRET
   ```

4. 配信ドメイン `slideusercontent.com` の zone に、Proxied の DNS レコード `*`（`A 192.0.2.1`）を作る。AAAA だけのレコードでは Cloudflare が IPv6 のアドレスしか返さず、IPv4 だけの環境から名前を解決できない。版ごとの origin `d-<deployment ID>.slideusercontent.com` を Worker の route `*.slideusercontent.com/*` に届けるため。route は deploy で作られる。
5. zone の Email Obfuscation、Automatic HTTPS Rewrites、Replace insecure JavaScript libraries は既定の On のままでよい。作者のファイルは `Cache-Control: no-transform` で返し、Cloudflare に本文を書き換えさせない。書き換えうる機能が効くと weak な `ETag` も外れ、browser の再検証で 304 を返せない（[読者向けの配信と内部 cache](f03-sharing.md#読者向けの配信と内部-cache)）。Configuration Rule は要らない。
6. zone `slide.community` と `slideusercontent.com` の Cloudflare Web Analytics は、自動設定（Automatic setup）を使わない。この設定は HTML に `static.cloudflareinsights.com/beacon.min.js` を差し込むが、slide のページの CSP は外部 script を許可しないため、読み込めずに console にエラーが出る。設定が有効になっても差し込まれないよう、slide は管理画面の HTML の応答に `Cache-Control: no-transform` を付ける（`src/site/middleware.ts`）。この指定は Cloudflare の圧縮も止めるため、HTML 以外には付けない。配信ドメインの応答も `no-transform` を持つ。閲覧の分析は [どのページまで読まれたか確かめる](../features/f11-analytics.md) で扱い、Web Analytics は使わない。

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
   pnpm run deploy
   ```

   `pnpm deploy` は pnpm 自身の別のコマンドなので、`run` を付ける。

migration を含まない変更は、3 だけを行う。

Better Auth への切替で使う `0012` は、旧 `owner_sessions` の行を消し、表は残す。migration の適用後も、まだ稼働している旧 Worker は再ログイン・認証参照・ログアウトを実行できる。新 Worker は旧表を認証に使わない。切戻し期間が終わるまで旧表を保持し、削除は後続の migration に分ける。旧表の削除をこの手順に追加しない。

## 反映後に確認する

| 確認 | 期待する結果 |
| --- | --- |
| `curl -sI https://slide.community/auth/github` | `303` で GitHub の認可画面へ移動し、URL に `client_id` と `code_challenge_method=S256` を含む |
| `curl -s -o /dev/null -w '%{http_code}' https://slide.community/api/slides` | 未ログインで `401` |
| `curl -s -o /dev/null -w '%{http_code}' https://slide.community/slides/try-static` | 未ログインで `401` |
| `pnpm exec wrangler d1 execute slide --remote --command "SELECT state, count(*) FROM deployments GROUP BY state"` | 反映前にあった `ready` の件数が減っていない |
| `curl -s -o /dev/null -w '%{http_code}' https://d-00000000-0000-4000-8000-000000000000.slideusercontent.com/` | 存在しない deployment の origin で `404` |
| `curl -s -o /dev/null -w '%{http_code}' https://www.slideusercontent.com/slides` | 管理画面の route は配信ドメイン側で応答せず `404` |
| 一般公開中の版の origin に `curl -s -o /dev/null -D -` で GET を 2 回送る | どちらも `200`・`Cache-Control: no-cache, no-transform`・`ETag: W/"…"`。`X-Content-Cache` は 1 回目が `MISS`（すでに温まっていれば `HIT`）、2 回目が `HIT` |
| 上の `ETag` を `If-None-Match` に付けて送る | `304`。`ETag` が付かないときは、`Cache-Control` に `no-transform` があるかを確かめる |
| `curl -s -A 'Mozilla/5.0' -H 'Accept: text/html' --compressed https://slide.community/ \| grep -c cloudflareinsights` | `0`。Web Analytics の script が差し込まれていない |
| 一般公開中の版の deployment ID で `curl -s -o /dev/null -D - https://slide.community/covers/<deployment ID>.jpg` を 2 回送る | どちらも `200`・`Content-Type: image/jpeg`・`Cache-Control: no-cache`。`X-Content-Cache` は 2 回目が `HIT`。画像を開き、スライドの 1 枚目が写っていることを目で確かめる。`503` のときは Browser Rendering の上限を確かめる（[表紙の画像](f03-sharing.md#表紙の画像)） |
| `curl -s -o /dev/null -w '%{http_code}' --max-time 20 https://slide.piconic.ai/` と `https://www.kobaken.co/api/slides`、`https://d-00000000-0000-4000-8000-000000000000.kobaken.co/` | 以前のドメインが Worker に届かない（管理画面の `200`・`401` や gateway の `404` を返さない）。配信ドメインの外の host は管理画面として扱うので、以前の custom domain や route が残っていたら Cloudflare の Workers の画面で外す |
| `curl -sI https://slide.community/favicon.ico` | `200` で `Content-Type: image/svg+xml` |
| `pnpm exec wrangler r2 bucket dev-url get slide-uploads` と `pnpm exec wrangler r2 bucket domain list slide-uploads` | r2.dev の公開が無効で、custom domain がない。R2 を gateway の外から読めない |

アップロードの経路全体と、ログインした本人にしか見えない履歴ページは、作者がブラウザで、スライドを 1 つ置いて確かめる。本番に向けた確認用の workflow は、GitHub からの更新といっしょに取り除いた。

## 戻す

deploy だけを戻す場合は、Cloudflare の Workers の画面か `pnpm exec wrangler rollback` で前の版に戻す。migration は戻さず、前の版のコードが新しいスキーマでも動くことを PR の時点で確かめておく。D1 を戻す必要がある場合は、[D1 を復元する](#d1-を復元する) の手順に入る前に作者と判断する。

`0012` 適用後に Better Auth 導入前の Worker へ切り戻す場合、切戻し前に新旧の認証 session と OAuth state を失効させる。以前の cookie や途中の認可要求を再び使わせないため。

```sh
pnpm exec wrangler d1 execute slide --remote --command "DELETE FROM auth_session; DELETE FROM auth_verification; DELETE FROM owner_sessions"
pnpm exec wrangler rollback <pre-Better-Auth-version-ID>
```

切戻し後は旧 Worker で GitHub ログイン・ログアウトと既存資料の操作を確認する。cookie の形式が異なるため再ログインする。`0012` の認証テーブルは残してよく、スライド・所有者 ID・固定 handle を戻す必要はない。

## D1 を復元する

D1 は [Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/) で、過去の任意の時点に戻せる。メンテナンスの切り替えは [サービスの基本の備え](service-basics.md#エラーページとメンテナンス) を参照する。設定は不要で、Workers Paid では 30 日、Free では 7 日前まで戻せる。`wrangler d1 export` のバックアップは、それより古い時点に戻す場合と、D1 の外に控えを残す場合に使う。復元は本番の書き込みなので、作者が行うか、作者の許可を得てから行う。

1. メンテナンスを始める。復元からセッションの削除までの間に、戻った行を HTTP や cron に使わせないため。メンテナンス中は、管理画面・API・アップロード・content domain での配信が `503` を返し、cron の掃除も止まる。

   ```sh
   pnpm exec wrangler secret put MAINTENANCE   # 値に on を入力する
   ```

   次の 3 つを確かめてから先へ進む。`503` は新しい request が止まったことしか示さないため、切り替え前に始まった処理が終わるのを別に待つ。
   - `curl -s -o /dev/null -w '%{http_code}' https://slide.community/slides` が `503` になる。
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

   復元したスキーマが `0012` 以降なら、新旧の認証セッション・状態行をすべて消す。

   ```sh
   pnpm exec wrangler d1 execute slide --remote --command "DELETE FROM auth_session; DELETE FROM auth_verification; DELETE FROM owner_sessions; DELETE FROM preview_launches; DELETE FROM content_sessions"
   ```

   `0012` より前のスキーマへ戻し、新 migration を再適用しない場合は、まだ存在しない Better Auth の表を指定せずに消す。

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
