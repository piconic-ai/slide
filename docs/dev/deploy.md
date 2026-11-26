# 本番に反映する

Worker `slide`、domain `slide.community`、D1 `slide`、非公開 R2 `slide-uploads` へ変更を反映する手順。設計と、確かめる条件は [リリースの流れの設計](release-flow.md) にある。

> **この文書の新しい流れが効く条件。** 本番に反映するのは、依頼者が tagpr のリリース PR を merge したときだけ、という流れは、次の 2 つがそろった後から効く。1 つ目は、第四スコープの統合ブランチ `scope4` が `main` に入っていること。2 つ目は、依頼者が [依頼者が最初に行う設定](#依頼者が最初に行う設定) を済ませ、[最初の 1 回の流れ](#最初の-1-回の流れ) でリリースが通ったこと。それまでは、`main` への merge の後に、[移行前の手順](#移行前の手順) で手で反映する。この文書の「作業の分担」、`AGENTS.md`、`dev-loop` skill は、条件がそろうまで、移行前の決まりを残してある。

## 全体の流れ

本番は、tagpr のリリース PR を merge したときにだけ変わる。`main` に merge しただけでは変わらない。

1. 変更の PR を `main` に merge する。エージェントが行ってよいのは、ここまでである。
2. tagpr が、リリース PR(`CHANGELOG.md` への追記)を開くか、更新する。本番は変わらない。
3. 依頼者が、[リリース PR を merge する前に見るもの](#リリース-pr-を-merge-する前に見るもの) を確かめ、リリース PR を merge する。tagpr がタグ(`v0.4.0` の形)を作る。
4. タグが作られたときだけ、workflow が `release` ブランチをそのタグのコミットまで進める。
5. Workers Builds が `release` への push を見て、build し、deploy のコマンド(`node scripts/release-deploy.mjs`)を動かす。
6. スクリプトが、D1 の Time Travel の位置の記録、migration の適用、`wrangler deploy`、反映の後の確認を、この順に行う。失敗したら、そこで止まり、Discord に知らせる([反映が止まったとき](#反映が止まったとき))。

環境は本番の 1 つだけである。`main` に入った変更は、本番に出る前に、ローカルと CI でしか確かめられない。だから、リリース PR を merge する前に、依頼者が見るものを決めてある。

## 作業の分担

本番に影響する操作は、次のように分ける。

| 操作 | 行う人 |
| --- | --- |
| `main` への merge | 依頼者、または依頼者が許可したエージェント(開発ループ。[dev-loop](../../.agents/skills/dev-loop/SKILL.md)) |
| リリース PR の merge | 依頼者だけ |
| タグと `release` ブランチ | tagpr と workflow だけ。人が作るのは、最初の 1 回の `v0.3.0` と `release` だけ |
| migration の適用、deploy | Workers Builds が、`release` への push で行う。人もエージェントも手では行わない(障害からの復旧を除く) |
| Worker を前の版に戻す | 依頼者、または依頼者が許可したエージェント([戻す](#戻す)) |
| Cloudflare と GitHub の設定、secret の登録、送信サービスの登録、SPF・DKIM・DMARC、Turnstile の widget の作成 | 依頼者 |
| Issue のクローズ | 依頼者、または依頼者が許可したエージェント |

secret は、エージェントに渡さず、依頼者が `wrangler secret put` で直接入力する。本番の D1・R2・Worker・secret・DNS には、エージェントは触れない。

## 依頼者が最初に行う設定

次の順に、1 回だけ行う。画面の名前は、2026-11-26 に公式の文書で確かめたものである。画面が変わっていたら、文書の方を直す。確かめた出典は [リリースの流れの設計](release-flow.md#確かめた仕様) にある。

1. [GitHub の Actions の設定](#github-の-actions-の設定)
2. [secret scanning と push protection](#secret-scanning-と-push-protection)
3. [アカウントの 2 要素認証](#アカウントの-2-要素認証)
4. [最初のタグと `release` ブランチ](#最初のタグと-release-ブランチ)
5. [ブランチの保護](#ブランチの保護)
6. [Cloudflare の API token](#cloudflare-の-api-token)
7. [Workers Builds を本番の Worker につなぐ](#workers-builds-を本番の-worker-につなぐ)

### GitHub の Actions の設定

リポジトリの Settings > Actions > General で、次のとおりにして Save する。

| 項目 | 値 | 理由 |
| --- | --- | --- |
| Workflow permissions | 読み取りだけ(Read repository contents and packages permissions) | workflow は、必要な書き込みを自分で宣言する(`tagpr.yml` のとおり) |
| Allow GitHub Actions to create and approve pull requests | 入れる | tagpr がリリース PR を開くのに要る |
| Approval for running fork pull request workflows from contributors | Require approval for all external contributors | 外の人の PR が、権限を持つ workflow を動かさないようにする |

### secret scanning と push protection

リポジトリの Settings > Security and quality > Advanced Security で、Secret Protection を Enable にし、続けて Push protection の Enable を押す。token や webhook の URL をうっかり push しても、止まる。

### アカウントの 2 要素認証

本番に触れる 2 つのアカウントで、どちらも 2 要素認証を入れる。リカバリーコードは、パスワードマネージャーに保管する。

- Cloudflare: ダッシュボードの My Profile > Authentication で、Mobile App Authentication か Security Key Authentication を Add する。2 つ以上の方法を入れ、セキュリティキーは複数登録する。
- GitHub: Settings > Password and authentication で、2 要素認証を入れる(パスキーかセキュリティキーを勧める)。

### 最初のタグと `release` ブランチ

`scope4` を `main` に merge する前に、1 回だけ行う。tagpr は、タグが無いと `v0.0.0` から数え、これまでのすべての PR を `CHANGELOG.md` に並べる。

```sh
git fetch origin
git tag v0.3.0 origin/main
git push origin v0.3.0
git push origin "v0.3.0^{commit}:refs/heads/release"
```

- `origin/main` の先頭は、第三スコープまでが入った、いまの本番と同じコミットであること。`pnpm exec wrangler deployments status` で動いている版の時刻を見て、そのコミットより後に `main` へ入った変更が無いことを確かめる。
- `v0.3.0` は、タグを push しても、workflow も Workers Builds も動かさない(どちらも、ブランチへの push だけで動く)。
- `release` は、`v0.3.0` と同じコミットから始まる。以後、tagpr のタグのコミットまで、workflow だけが進める。
- リポジトリに `minor` のラベルが無ければ、Issues > Labels で作る(色と説明は任意)。最初のリリースを `v0.4.0` にするためである。

### ブランチの保護

リポジトリの Settings > Rules > Rulesets で、New ruleset > New branch ruleset を 2 つ作る。どちらも Enforcement status は Active にする。

**1 つ目: `main`**

| 項目 | 値 |
| --- | --- |
| Ruleset name | `main` |
| Target branches | Add target > Include default branch |
| Bypass list | 空にする |
| Restrict deletions | 入れる |
| Block force pushes | 入れる |
| Require a pull request before merging | 入れる(必要な承認数は 0) |
| Require status checks to pass | 入れる。次の check を足す: `Workflow lockfile`、`Build, types and tests`、`Viewer on webkit`、`Viewer on firefox`、`Cognitive complexity`、`Documentation` |

check の名前は、PR で CI が一度動いた後に、検索の欄に出る。`Build, types and tests` は、すべてのテストの分割を待つので、テストごとの check は足さなくてよい。

**2 つ目: `release`**

| 項目 | 値 |
| --- | --- |
| Ruleset name | `release` |
| Target branches | Add target > Include by pattern > `release` |
| Bypass list | Add bypass で `GitHub Actions` だけを足す |
| Restrict creations | 入れる |
| Restrict updates | 入れる |
| Restrict deletions | 入れる |
| Block force pushes | 入れる |

これで、`release` を進められるのは、tagpr のタグを作った run の `advance-release-branch` だけになる。依頼者も、エージェントも、`release` に直接 push できない。

- Bypass list に `GitHub Actions` が出ないときは、公式の文書にこの組み合わせの記載が無い。その場合は、`release` の規則から `Restrict updates` だけを外す(`Restrict creations`、`Restrict deletions`、`Block force pushes` は残す)。`release` への直接の push は、依頼者が行わない決まりにする。これは保護が弱い形なので、どちらにしたかを、[最初の 1 回の流れ](#最初の-1-回の流れ) の記録に書く。
- 最初の `release` ブランチは、規則を作る前に作ってある(上の節)。

### Cloudflare の API token

Workers Builds が使う token である。user token だけが使える。ダッシュボードの My Profile > API Tokens > Create Token で、テンプレートを使わずに作る。

| 項目 | 値 |
| --- | --- |
| Token name | `slide-workers-builds` |
| Account の権限 | Workers Scripts: Edit、D1: Edit、Workers R2 Storage: Edit、Account Settings: Read。Account Resources は、この account だけ |
| Zone の権限 | Workers Routes: Edit、DNS: Edit。Zone Resources は、`slide.community` と `slideusercontent.com` の 2 つだけ |
| User の権限 | User Details: Read、Memberships: Read |
| Client IP Address Filtering | 設定しない(Workers Builds の出どころの住所は決まっていない) |
| Token expiration | 任意。決めたら、期限の前に作り直す日を決めておく |

token は、作ったときの 1 回しか表示されない。Workers Builds の設定に選ぶ(次の節)ので、貼る場所は Cloudflare の画面だけにし、リポジトリ、チャット、`.dev.vars` に置かない。自動で作られる token には D1 の編集が入っていないので、migration の適用が失敗する。そのため、自分で作る。権限が足りなければ、最初の build のログに権限の誤りが出る。そのときは、足りない権限を足して、build を取り直す。

### Workers Builds を本番の Worker につなぐ

1. Cloudflare のダッシュボードで、Workers & Pages > `slide` > Settings > Builds(画面によって `Build` と出る)を開き、Git repository を Connect する。GitHub の `piconic-ai/slide` を選ぶ。Cloudflare Workers & Pages の GitHub App は、`Only select repositories` で `piconic-ai/slide` だけに許す。
2. Branch control で、Production branch を `release` にする。Enable Preview Builds を外す(本番以外のブランチの build を使わない)。
3. 次の値を入れる。

   | 項目 | 値 |
   | --- | --- |
   | Build command | `pnpm run build` |
   | Deploy command | `node scripts/release-deploy.mjs` |
   | Root directory | 空 |
   | API token | 上で作った `slide-workers-builds` |

4. Build variables and secrets に、次の 2 つを足す。build のときだけ読める値で、実行中の Worker には渡らない。

   | 名前 | 値 |
   | --- | --- |
   | `PNPM_VERSION` | `12.16.1` |
   | `DISCORD_WEBHOOK_URL` | Discord の webhook の URL。作り方は [通知と監視](#通知と監視作業-m) |

5. Worker の名前が `slide`(`wrangler.jsonc` の `name`)であることを確かめる。違うと build が失敗する。

つないだ直後に build が走ることがある。`release` は、まだ `scripts/release-deploy.mjs` を持たない `v0.3.0` のコミットなので、deploy のコマンドは失敗する。まだ何も反映されていないので、そのままにしてよい。最初のリリースで、スクリプトが入る。

## 最初の 1 回の流れ

タグが無い状態から、最初のリリースまでの流れである。前の節の設定をすべて済ませた後で行う。各段階の後に、見るものを書いた。

1. **本番の D1 をバックアップする。** 出力はリポジトリに入れない。

   ```sh
   pnpm exec wrangler d1 export slide --remote --output "${TMPDIR:-/tmp}/slide-backup-$(date +%Y%m%d%H%M).sql"
   ```

2. **足した binding の先の資源を作る。** バックアップのバケットなど。[運用の手順](#運用の手順) と [R2 をバックアップから戻す](#r2-をバックアップから戻す) の、作業ごとの節にある。
3. **secret を登録する。** Discord の webhook、暗号の鍵、計測の読み取りのトークン。それぞれの節に従い、`wrangler secret put` で入力する。鍵の控えを保管する。
4. **「依頼者が最初に行う設定」をすべて行う。** 最初のタグと `release` の作成、ブランチの保護、token、Workers Builds の接続まで。
5. **`scope4` の PR に `minor` のラベルを付けて、`main` に merge する。** 本番は変わらないことを確かめる(`pnpm exec wrangler deployments status` の版が、merge の前と同じ)。`main` の CI が通ること。Actions の `tagpr` の run が成功し、リリース PR が開くこと。リリース PR のラベルに `tagpr:minor` が付き、題名が `v0.4.0` になっていること。
6. **リリース PR を確かめて、merge する。** [リリース PR を merge する前に見るもの](#リリース-pr-を-merge-する前に見るもの) をすべて見る。
7. **反映を見届ける。** merge の後に、Actions の `tagpr` の run で、タグ `v0.4.0` が作られ、`Advance the release branch` の job が成功する。Cloudflare の Workers & Pages > `slide` > Deployments(Builds)で、build が走り、ログに次が順に出ること: `step 1/4` から `step 4/4`、`Time Travel bookmark before this release`、各確認の行、`the release is checked`。止まったら [反映が止まったとき](#反映が止まったとき)。
8. **反映の後の確認の残りを行う。** [反映後に確認する](#反映後に確認する) の、人が行う行。
9. **それぞれの節の初回の作業を行う。** 暗号化の書き換え、Cloudflare のアラート、通知を 1 つずつ試すこと、バックアップの戻し方を一度試すこと([運用の手順](#運用の手順))。
10. **規約とプライバシーポリシーの文面を仕上げて、施行日を入れる。** もう一度リリースする。それまで、規約のページは「下書き」として出る。9 は、8 の後のいつ行ってもよい。

実際に動かして確かめるまで、次は確かめていない。結果を、この節の末尾に日付とともに記録する。

- GitHub Actions を `release` の迂回する者に置けたか(置けなかったときの形)。
- Workers Builds の token の権限が足りたか。
- build に渡した値が、deploy のコマンドから読めたか(通知が届いたか)。
- Workers Builds が、`release` の最初の push で build を始めたか。

## 反映の仕組み

| ファイル | 役目 |
| --- | --- |
| `.tagpr` | tagpr の設定。`vPrefix`、`releaseBranch = main`、`versionFile = -`、`changelog` |
| `.github/workflows/tagpr.yml` | `main` への push で tagpr を動かす。タグが作られたときだけ、`release` を API で進める(`force=false`) |
| `scripts/release-deploy.mjs` | Workers Builds の deploy のコマンド。記録、migration、deploy、確認の順に動く |
| `scripts/post-deploy-checks.mjs` | 反映の後の確認(ログインなしの項目) |
| `scripts/release-steps.mjs`、`scripts/release-options.mjs`、`scripts/discord-notice.mjs` | 上の部品。順番、起動の条件、Discord への通知 |

反映のスクリプトは、Workers Builds の外では、何も行わずに断る(`--allow-outside-ci` を付けたときを除く。付けるのは、依頼者が復旧のために手で動かすときだけ)。確認だけを手で動かすには、`node scripts/post-deploy-check.mjs` を使う。起動したときの origin は、`--site`、`--content-origin`、`--admin-origin` で渡す(省略すると `wrangler.jsonc` の値)。1 つでも失敗した項目があれば、終了コード 1 で終わり、失敗した項目を出す。設計と、確かめる条件は [リリースの流れの設計](release-flow.md) にある。

## リリース PR を merge する前に見るもの

`main` に入った変更は、本番に出る前には、ローカルと CI でしか確かめられていない。リリース PR を merge すると、確認なしで migration が本番の D1 に適用され、deploy される。次を、merge の前にすべて見る。

1. **リリース PR の CI が通っていること。** tagpr が `GITHUB_TOKEN` で作る PR には、CI が自動では走らない。PR を `Close pull request` で閉じ、すぐ `Reopen pull request` で開き直すと、CI が動く。リリース PR が更新されるたびに、開き直す。通ったことを、PR の最新のコミットで見る。`main` の最新のコミットの CI も通っていること。

   ```sh
   gh run list --branch main --workflow ci.yml --limit 1 --json conclusion,headSha
   ```

2. **`CHANGELOG.md` の追記を読むこと。** 前のリリースから入る PR の題名が並ぶ。意図しない変更、題名から中身が分からない変更は、PR を開いて見る。
3. **migration の有無。** 前のリリースのタグから、入る migration を数える。データが消えるもの(`DROP`、`DELETE FROM`、表の作り直し、値が失われる型の変更)があれば、リリース PR のコメントに書いてあること。コメントが無くても、自分で見る。

   ```sh
   git fetch origin --tags
   prev=$(git describe --tags --abbrev=0 origin/main)
   git diff --stat "$prev"..origin/main -- migrations/
   git diff "$prev"..origin/main -- migrations/ | grep -inE '^\+.*(DROP|DELETE FROM|TRUNCATE|RENAME|ALTER TABLE .* DROP)'
   pnpm exec wrangler d1 migrations list slide --remote
   ```

   データが消える migration を含むときは、バックアップ(Time Travel の位置は、反映のスクリプトが記録する)で足りるか、消える前に取り出すものがあるかを決めてから merge する。リリースを 2 つに分けたいときは、リリース PR を merge せずに、`main` の側で直す。
4. **`wrangler.jsonc` の変更。** binding、cron、`vars` が増えていないか。増えていれば、その先の資源と secret が、本番に用意されていること。権限に関わる値(`ACCESS_TEAM_DOMAIN`、`ACCESS_AUD`、`routes`、`account_id`、D1 と R2 の本番の名前)が変わっていないこと。
   ```sh
   git diff "$prev"..origin/main -- wrangler.jsonc
   ```
5. **ほかのリリースが進んでいないこと。** Cloudflare の Builds に、動いている build が無いこと。前のリリースが止まったままなら、先に [反映が止まったとき](#反映が止まったとき) を片づける。

## migration

migration は、足すだけ(表・列・索引の追加)にする。適用済みのファイルは変えない。番号は連番である。

- 適用は、反映のスクリプトが、deploy より先に行う。新しいコードが、新しい列や表を前提にしているためである。適用の前に、Time Travel の位置が記録される。
- 非対話の環境では、`wrangler d1 migrations apply` は確認を飛ばして適用する。確認は、リリース PR を merge する前の人の確認が受け持つ。
- 適用してから deploy が終わるまでの間と、Worker を戻したときのために、1 つ前の版のコードが、新しいスキーマでも動くようにしておく。列と表の追加は動く。列名の変更や制約の追加は、動くことをテストで示す。
- **データが消える migration を含むリリースは、リリース PR のコメントに書く。** 書くのは、そのような migration を含む PR を `main` に merge したエージェントである(merge の後、リリース PR が開いているか、更新されたときに `gh pr comment` で書く)。ファイルの名前と、消えるものを書く。tagpr は、リリース PR の本文を書き直すことがあるので、本文でなくコメントに書く。書き忘れても、依頼者は上の「migration の有無」で自分で見る。
- `src/db/destructive-migrations.test.ts` が、0036 以降で表・列・行を消す文を数え、[第二スコープの反映の記録](#第二スコープの反映の記録) の一覧と合っていることを確かめる。消す文を足したら、テストと一覧を同時に直す。

## secret と初回の設定

1. `BETTER_AUTH_SECRET` を `openssl rand -base64 32` で生成する。署名と、ログインのコードの保存に使う 32 文字以上のランダムな秘密値。値を Git やチャットへ貼らず、次の `wrangler secret put` の入力欄へ登録する。ローカルと本番では別の値を使い、通常の deploy では変更しない(変えると、すべての session が切れる)。
2. 送信サービスと Turnstile を設定する([メールのコードでログインする実装設計](f28-email-login.md#本番に反映する前に依頼者が行うこと))。実際のメール送信(`MAIL_API_TOKEN` など)を使うときは、Turnstile の `TURNSTILE_SITE_KEY` と `TURNSTILE_SECRET` も両方要る。そろっていないと、コードを求める要求は 503 になる。
3. secret を登録する。

   ```sh
   pnpm exec wrangler secret put BETTER_AUTH_SECRET
   pnpm exec wrangler secret put MAIL_API_TOKEN
   pnpm exec wrangler secret put TURNSTILE_SECRET
   ```

4. 配信ドメイン `slideusercontent.com` の zone に、Proxied の DNS レコード `*`（`A 192.0.2.1`）を作る。AAAA だけのレコードでは Cloudflare が IPv6 のアドレスしか返さず、IPv4 だけの環境から名前を解決できない。版ごとの origin `d-<deployment ID>.slideusercontent.com` を Worker の route `*.slideusercontent.com/*` に届けるため。route は deploy で作られる。
5. zone の Email Obfuscation、Automatic HTTPS Rewrites、Replace insecure JavaScript libraries は既定の On のままでよい。作者のファイルは `Cache-Control: no-transform` で返し、Cloudflare に本文を書き換えさせない。書き換えうる機能が効くと weak な `ETag` も外れ、browser の再検証で 304 を返せない（[読者向けの配信と内部 cache](f03-sharing.md#読者向けの配信と内部-cache)）。Configuration Rule は要らない。
6. zone `slide.community` と `slideusercontent.com` の Cloudflare Web Analytics は、自動設定（Automatic setup）を使わない。この設定は HTML に `static.cloudflareinsights.com/beacon.min.js` を差し込むが、slide のページの CSP は外部 script を許可しないため、読み込めずに console にエラーが出る。設定が有効になっても差し込まれないよう、slide は管理画面の HTML の応答に `Cache-Control: no-transform` を付ける（`src/site/middleware.ts`）。この指定は Cloudflare の圧縮も止めるため、HTML 以外には付けない。配信ドメインの応答も `no-transform` を持つ。閲覧の分析は [どのページまで読まれたか確かめる](../features/f11-analytics.md) で扱い、Web Analytics は使わない。

## 反映後に確認する

「自動」の列に 〇 を付けた行は、反映のスクリプトが、deploy の後に自動で確かめる(`scripts/post-deploy-checks.mjs`。公開中のスライドが 1 本もないときは、公開中の版の 2 行を飛ばす)。ビルドのログの `failed` の行と、Discord の通知に、失敗した項目の名前が出る。手で確かめるときは `node scripts/post-deploy-check.mjs` を動かす。ほかの行は、リリースの後に、人が確かめる。

| 自動 | 確認 | 期待する結果 |
| --- | --- | --- |
|  | `curl -sI https://slide.community/auth/github` | `404`(GitHub のログインの経路はない) |
| 〇 | `curl -s -o /dev/null -w '%{http_code}' https://slide.community/login` | `200` |
| 〇 | `curl -s -o /dev/null -w '%{http_code}' https://slide.community/api/slides` | 未ログインで `401` |
| 〇 | トップページ、`/robots.txt`、`/terms`、`/privacy`、`/privacy/external`、`/help` | `200`(`/robots.txt` は `text/plain`) |
| 〇 | 一覧に出ている公開中のスライド 1 本の共有 URL と、その版の origin | どちらも `200` |
|  | `pnpm exec wrangler d1 execute slide --remote --command "SELECT state, count(*) FROM deployments GROUP BY state"` | 反映前にあった `ready` の件数が減っていない |
| 〇 | `curl -s -o /dev/null -w '%{http_code}' https://d-00000000-0000-4000-8000-000000000000.slideusercontent.com/` | 存在しない deployment の origin で `404` |
| 〇 | `curl -s -o /dev/null -w '%{http_code}' https://www.slideusercontent.com/slides` | 管理画面の route は配信ドメイン側で応答せず `404` |
| 〇 | 運営 origin(`https://admin.slide.community/`)に、Cloudflare Access を通さずに GET を送る | 開かない(`301`、`302`、`303`、`307`、`308`、`401`、`403`、`404`) |
|  | 一般公開中の版の origin に `curl -s -o /dev/null -D -` で GET を 2 回送る | どちらも `200`・`Cache-Control: no-cache, no-transform`・`ETag: W/"…"`。`X-Content-Cache` は 1 回目が `MISS`（すでに温まっていれば `HIT`）、2 回目が `HIT` |
|  | 上の `ETag` を `If-None-Match` に付けて送る | `304`。`ETag` が付かないときは、`Cache-Control` に `no-transform` があるかを確かめる |
|  | `curl -s -A 'Mozilla/5.0' -H 'Accept: text/html' --compressed https://slide.community/ \| grep -c cloudflareinsights` | `0`。Web Analytics の script が差し込まれていない |
|  | 一般公開中の版の deployment ID で `curl -s -o /dev/null -D - https://slide.community/covers/<deployment ID>.jpg` を 2 回送る | どちらも `200`・`Content-Type: image/jpeg`・`Cache-Control: no-cache`。`X-Content-Cache` は 2 回目が `HIT`。画像を開き、スライドの 1 枚目が写っていることを目で確かめる。`503` のときは Browser Rendering の上限を確かめる（[表紙の画像](f03-sharing.md#表紙の画像)） |
|  | `curl -s -o /dev/null -w '%{http_code}' --max-time 20 https://slide.piconic.ai/` と `https://www.kobaken.co/api/slides`、`https://d-00000000-0000-4000-8000-000000000000.kobaken.co/` | 以前のドメインが Worker に届かない（管理画面の `200`・`401` や gateway の `404` を返さない）。配信ドメインの外の host は管理画面として扱うので、以前の custom domain や route が残っていたら Cloudflare の Workers の画面で外す |
|  | `curl -sI https://slide.community/favicon.ico` | `200` で `Content-Type: image/svg+xml` |
|  | 作者が設定の「プロフィール画像」で JPEG の写真を選び(iPhone の Safari でも)、`curl -sI https://slide.community/avatars/<利用者の id>` を送る | 画像が切り替わる。応答は `200`・`Content-Type: image/png`・`X-Content-Type-Options: nosniff`。縮小はブラウザで行い、Cloudflare Images の binding は使わない(`wrangler.jsonc` に `images` はない)。それより前に WebP で保存した画像は `Content-Type: image/webp` のまま配られる |
|  | `pnpm exec wrangler r2 bucket dev-url get slide-uploads` と `pnpm exec wrangler r2 bucket domain list slide-uploads` | r2.dev の公開が無効で、custom domain がない。R2 を gateway の外から読めない |

アップロードの経路全体と、ログインした本人にしか見えない履歴ページは、作者がブラウザで、スライドを 1 つ置いて確かめる。本番に向けた確認用の workflow は、GitHub からの更新といっしょに取り除いた。

## 反映が止まったとき

反映のスクリプトが失敗すると、Workers Builds の build が失敗として残り、Discord に通知が届く(webhook を入れてあれば)。Cloudflare のダッシュボードの Workers & Pages > `slide` > Deployments(Builds)で、失敗した build のログを開く。止まった段階は、ログの `stopped at:` の行と、通知の「止まった段階」に出る。

| 止まった段階 | 本番はどうなっているか | すること |
| --- | --- | --- |
| `record`(Time Travel の位置の記録) | 何も変わっていない | ログの原因を読む。token の権限と、`wrangler` の誤りが多い。直したら、build を取り直す |
| `migrate`(migration の適用) | 失敗した migration は戻り、前の成功までが残る。Worker は前の版のまま | ログで、どの migration の何の誤りかを読む。前の版のコードは、適用済みの migration のスキーマでも動く決まりである。直すには、`main` で migration を直す PR を出し、新しいリリースにする(適用済みの migration のファイルは変えない)。一時的な誤り(通信)なら、build を取り直す。D1 を戻す必要があれば、ログの `Time Travel bookmark before this release` の位置に戻す([D1 を戻す](#d1-を戻す)) |
| `deploy`(`wrangler deploy`) | migration は適用済みで、Worker は前の版のまま | ログの原因を読み、build を取り直す。取り直しは、適用済みの migration を飛ばす |
| `verify`(反映の後の確認) | deploy 済み。自動では戻さない | 失敗した項目を見て、原因を調べる。直らない、または影響が大きければ、[Worker を戻す](#worker-を戻す)。確認が一時的な誤りに見えるときは、`node scripts/post-deploy-check.mjs` を動かし直す |

- build の取り直しは、Builds の一覧で、その build の `Retry build`(画面によって名前が違う)を押す。取り直しは、同じ `release` のコミットを、同じ 4 段階で行う。
- `release` ブランチは、戻さない。戻そうとしても、ブランチの保護と `force=false` で止まる。直すには、`main` に修正を merge し、次のリリース PR を merge する。
- 本番のブランチ以外の build が本番に出ないことは、スクリプトが `WORKERS_CI_BRANCH` で確かめる。`refused:` の行が出ていたら、Workers Builds の本番のブランチの設定を確かめる([Workers Builds を本番の Worker につなぐ](#workers-builds-を本番の-worker-につなぐ))。

## 戻す

### Worker を戻す

Worker だけを、前の版に戻す。Workers Builds の流れでも、戻し方は同じである。

1. 動いている版と、前の版の version ID を確かめる。

   ```sh
   pnpm exec wrangler deployments status
   pnpm exec wrangler deployments list
   ```

   前の版は、リリースの前に動いていた版である。反映のスクリプトのログには、deploy の出力に新しい version ID が出る。その 1 つ前が、前の版である。

2. 戻す。Cloudflare の Workers & Pages > `slide` > Deployments の画面からも、同じことができる。

   ```sh
   pnpm exec wrangler rollback <前の version ID>
   ```

3. 戻した後に、[反映後に確認する](#反映後に確認する) の自動の項目を、手で動かし直す。

   ```sh
   node scripts/post-deploy-check.mjs
   ```

- **migration は戻さない。** 前の版のコードが、新しいスキーマでも動くことを、PR の時点で確かめてある(列と表の追加は動く)。D1 を戻す必要があると考えたら、[D1 を戻す](#d1-を戻す) の手順に入る前に、依頼者が判断する。
- **`release` ブランチは戻さない。** Worker だけを戻しても、`release` は新しいコミットのままである。`release` を巻き戻そうとしても、ブランチの保護と `force=false` で止まる。
- **戻した後に、次のリリースで何が起きるか。** `main` には、問題のあった変更が入ったままである。次のリリース PR を merge すると、その変更を含む版が、もう一度本番に出る。戻した後は、リリース PR を merge せずに、`main` に修正(または元に戻す PR)を merge する。tagpr がリリース PR を更新するので、中身を確かめてから merge する。Workers Builds の取り直しも、`release` のコミットを deploy し直すので、戻した版を新しい版が上書きする。
- Cloudflare の Deployments の画面で、戻した後の「動いている版」を見ておく。次の build が、それを上書きする。

### D1 を戻す

D1 は Time Travel で戻せる。下の手順は、メンテナンスを始めるところから、終えるところまでを書いている。反映の途中で、新しい migration が壊れたときは、反映のスクリプトが記録した位置(build のログの `Time Travel bookmark before this release`)に戻す。

メンテナンスの切り替えの順番は、[メンテナンス](#メンテナンス作業-n) の節にある。`release` の反映の途中では切り替えない。

#### D1 を復元する

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

### R2 をバックアップから戻す

(作業 B が書く。1 つのスライドを戻す手順、すべてを戻す手順、D1 を Time Travel で戻したときに R2 と合わせる手順。依頼者がバケットを作る手順と、戻し方を一度試す手順。)

## 運用の手順

作業ごとの節を、この下に足す。見出しは `###` で、自分の作業の記号を括弧に入れる。ほかの作業の節と、上の節は書き換えない。

### 通知と監視(作業 M)

(作業 M が書く。Discord の webhook の作り方と secret の登録、見張りの Worker の deploy、Observability のアラート、Budget alerts。)

### メールアドレスの暗号化の鍵(作業 C)

(作業 C が書く。鍵の作り方、secret の登録、控えの保管、書き換えの実行、鍵の入れ替え、鍵を失ったときに起きること。)

### メンテナンス(作業 N)

(作業 N が書く。予告を出す、切り替える、確かめる、終える。`release` の反映の途中は切り替えないこと。D1 を Time Travel で戻すときの順番。)

## 移行前の手順

新しい流れが効く前([この文書の冒頭](#本番に反映する) の条件)に、`main` に merge した変更を反映する手順である。これまでの開発ループの手順を、そのまま残してある。条件がそろった後は使わない。Workers Builds が `release` の push で反映するので、手で `wrangler deploy` や migration の適用をしない(復旧を除く)。

### 手で反映する

deploy 用の checkout(`../slide-deploy`)で行う。自分の worktree からは deploy しない。反映は、同時に 1 つだけが行う。そのために、手順 1 で鍵を取り、手順 8 で返す。

1. 鍵を取る。`mkdir` は、すでにあると失敗するので、先に取った 1 つだけが進める。

   ```sh
   mkdir ../slide-deploy.lock && echo "PR <PR> $(date -u +%FT%TZ)" > ../slide-deploy.lock/owner
   ```

   `mkdir` が失敗したら、ほかの反映が進んでいる。止まる条件 7 に当たる。`cat ../slide-deploy.lock/owner` の内容を依頼者に伝える。自分が作っていない鍵を消さない。ここから先で止まるとき、失敗したとき、戻したときも、最後に必ず手順 8 を行う。

2. deploy 用の checkout を用意し、main の CI が通っていることを確かめる。

   ```sh
   test -d ../slide-deploy || git worktree add --detach ../slide-deploy origin/main   # 初回だけ作られる
   gh run list --branch main --workflow ci.yml --limit 1 --json conclusion,headSha
   cd ../slide-deploy
   git status --porcelain            # 何も出なければ clean
   git fetch origin
   git checkout --detach origin/main
   git rev-parse HEAD                # 上の headSha と同じであること
   pnpm install --frozen-lockfile
   pnpm exec wrangler whoami         # ログインしていなければ、止まる条件 3
   ```

   CI の `conclusion` が `success` でない、`headSha` が違う(CI がまだ終わっていない)、または `git status --porcelain` が何かを出したときは、反映しない。出てきた変更は、ほかの人の作業かもしれないので、消さずに依頼者に知らせる。

3. 反映の前の状態を控える。あとの確認と、戻すときに使う。

   ```sh
   pnpm exec wrangler deployments status                   # いま動いている version ID を控える
   pnpm exec wrangler d1 execute slide --remote --command "SELECT state, count(*) FROM deployments GROUP BY state"
   pnpm exec wrangler d1 migrations list slide --remote    # 未適用の migration があるか
   ```

4. 未適用の migration が 1 つでもあれば(今回の PR のものでなくても)、その SQL(`migrations/<名前>.sql`)をもう 1 度すべて読む。データを消すものがあれば、適用も deploy もせずに止まる(止まる条件 5)。なければ、バックアップを取ってから適用する。バックアップはリポジトリの外に置く。

   ```sh
   pnpm exec wrangler d1 export slide --remote --output "${TMPDIR:-/tmp}/slide-backup-$(date +%Y%m%d%H%M).sql"
   pnpm exec wrangler d1 migrations apply slide --remote
   ```

5. 反映する。`pnpm deploy` は pnpm の別のコマンドなので、必ず `run` を付ける。

   ```sh
   pnpm run deploy
   ```

6. [反映後に確認する](#反映後に確認する)の表のうち、コマンドだけで判定できる行をすべて実行する(`curl` と `wrangler` の行。`ready` の件数は 3 で控えた値と比べる)。公開中の版が要る行は、`https://slide.community/` の一覧に出ているスライドを 1 つ使う。目で見る確認、確認用 workflow、作者のブラウザが要る行は実行せず、7 で「人の確認」として issue に書く。
7. 今回変えた機能のうち、匿名の読者が本番で通れる経路(共有 URL、トップページ、ヘルプなど)は、`curl` で 1 度通して、期待する状態コードと内容を確かめる。ログインが要る経路は、本番では操作せず、「人の確認」に書く。
8. 鍵を返す。確認が失敗したときは、下の「戻す」を終えてから返す。

   ```sh
   rm -r ../slide-deploy.lock
   ```

9. 報告に、commit の SHA、push 済みであること、deploy の結果(新しい version ID)、`git status --porcelain` が空であることを書く。

### 手で戻す

6 か 7 の確認が 1 つでも失敗したら、原因を調べる前に戻す。鍵を持っている間は、ほかの反映が割り込まないので、控えた version は自分の反映の 1 つ前である。

```sh
pnpm exec wrangler rollback <3 で控えた version ID>
```

- migration は戻さない。D1 を戻す必要があると考えたら、何もせずに依頼者に知らせる。
- 戻したあと、失敗した確認をもう 1 度実行し、直ったことを確かめる。
- 鍵を返す(手順 8)。
- 止まる条件 6 に当たる。issue と依頼者に、失敗した確認、戻した version、いまの本番の状態を伝える。次の issue には進まない。

### migration を含む変更を反映する(いまの手順)

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

## 第二スコープの反映の記録

メールのコードでのログインに切り替えるとき、依頼者が行うこと。詳細は [メールのコードでログインする実装設計](f28-email-login.md#本番に反映する前に依頼者が行うこと)。

1. いまの GitHub でのログインで退会する。本番の D1 と R2 を空にする。
2. 送信サービスを登録し、SPF・DKIM・DMARC を設定する。`MAIL_API_TOKEN`(secret)、`MAIL_ACCOUNT_ID`、`MAIL_FROM` を設定する。
3. Turnstile の widget を作り、`TURNSTILE_SITE_KEY` と `TURNSTILE_SECRET`(secret)を設定する。
4. 反映する(migration 0044 が `accounts.terms_accepted_at` を足す)。運営の画面で、自分のメールアドレスを招待の一覧に入れ、`/login` から登録し直す。`/welcome` で利用規約とプライバシーポリシーに同意する。同意しないまま終えた人の記録は、「登録せずに終了する」と、既存の毎時の掃除(`scheduled`。新しい trigger は足していない)が消す。
5. 使わなくなった値を片づける: secret の `GITHUB_APP_CLIENT_SECRET`、GitHub App(削除する)。`wrangler.jsonc` の `AUTHOR_GITHUB_IDS` と `GITHUB_APP_CLIENT_ID` は、2026-11-25 にリポジトリから外した。


### データを消す migration(0036〜0047)

第二スコープの migration は、空の D1 に 0001 から 0048 まで連番で適用できる(`src/db/migration-numbers.test.ts`、`src/db/email-login-migration.test.ts`)。このうち、表を消す、または作り直すのは次の 4 つである。ほかの 8 つ(0036、0039〜0044、0046)は、表と列を足すだけで、行を消さない。

| 番号 | 消えるもの | 残るもの |
| --- | --- | --- |
| `0037_profiles_without_github.sql` | 表 `profiles` の全行と、GitHub の写しの列(`login`、`avatar_url`、`has_sponsors`、`synced_at`)。表を作り直し、表示名・自己紹介・場所・Web サイトだけの列にする | なし(行は引き継がない) |
| `0038_remove_github_leftovers.sql` | 表 `owner_sessions`(GitHub の利用者番号とログイン名。0012 から読み手がない)、表 `notifications` の全行(種類 `github_followee_joined` をなくすため作り直す)、表 `notification_opt_outs` の全行 | `notifications` は、種類 `cited`、`followee_published`、`followed` だけを受ける形で作り直される |
| `0045_related_link_title_optional.sql` | 表 `related_links` を作り直す(題名の NOT NULL を外すため)。消える行はない | 全行を新しい表へ写してから、古い表を消す。写した後の行は、題名なしを許す形になる |
| `0047_drop_page_script_deployments.sql` | 表 `page_script_deployments`(版の `index.html` がページを伝える script を読み込んでいたかの記録)。配信のときに script を差し込むようになり、読み手がなくなった | なし。行は版の `index.html` から導いた値だけで、ほかの情報を持たない。消しても、どの版も、これまでどおり配られ、ページの画像も撮られる |
| `0049_auth_session_per_device.sql` | 表 `auth_session` を作り直す(1 人 1 つの制約 `UNIQUE(user_id) ON CONFLICT REPLACE` を外すため)。消える行はない | 全行を新しい表へ写してから、古い表を消す。いまのログインは、そのまま続く。前の version の Worker も、この表で動く(新しいログインが前のログインを置き換えなくなるだけ) |

注意:

- `decks.owner_user_id`、`accounts.user_id`、`follows`、`mutes`、`suspensions` など、利用者の識別子を持つ列は、GitHub の利用者番号から利用者の id(Better Auth の `auth_user.id`)に意味が変わった。migration はその列の値を変換しない。だから、本番の D1 と R2 を空にしてから反映する(上の手順 1)。空にせずに反映すると、古い GitHub の番号が利用者の id として残り、だれのものでもない行になる。
- 0037・0038・0047 は、前のスコープの Worker が読む表や列を消す。適用してから新しい Worker を deploy するまでの間、前の Worker は 500 を返しうる。第二スコープの反映は、本番を空にして入れ直す手順(上の手順 1)の中で行い、反映の後に前のスコープの Worker へは戻さない(`wrangler rollback` で第二スコープより前の version に戻さない)。
- `src/db/destructive-migrations.test.ts` が、0036 以降で表・列・行を消す文を数え、この一覧と合っていることを確かめる。消す文を足したら、テストとこの表を同時に直す。
- 適用後のスキーマに、GitHub の利用者番号を前提にした列と、お知らせの種類 `github_followee_joined` の値が残らないことは、`src/db/email-login-migration.test.ts`(F28-AC32、F28-AC28)が確かめる。
- 本番を空にする操作は、D1 と R2 の両方が対象である。実行は依頼者が行う([メールのコードでログインする実装設計](f28-email-login.md#本番に反映する前に依頼者が行うこと))。

### 第二スコープより前の Worker への切戻し

`0012` 適用後に Better Auth 導入前の Worker へ切り戻す場合、切戻し前に新旧の認証 session と OAuth state を失効させる。以前の cookie や途中の認可要求を再び使わせないため。

```sh
pnpm exec wrangler d1 execute slide --remote --command "DELETE FROM auth_session; DELETE FROM auth_verification; DELETE FROM owner_sessions"
pnpm exec wrangler rollback <pre-Better-Auth-version-ID>
```

切戻し後は旧 Worker のログイン・ログアウトと既存資料の操作を確認する。cookie の形式が異なるため再ログインする(第二スコープより前の Worker に戻す場合は、GitHub でのログインになる)。`0012` の認証テーブルは残してよく、スライド・所有者 ID・固定 handle を戻す必要はない。
