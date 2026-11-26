# リリースの流れの設計

本番に反映する流れ(tagpr、`release` ブランチ、Workers Builds、反映のスクリプト)の設計。依頼者が行う設定と日々の手順は [本番に反映する](deploy.md) にある。

この流れは、利用者から見える結果を持たない。そのため、機能の仕様(`docs/features/`)は作らず、確かめる条件をこの文書の [受け入れ条件](#受け入れ条件) に書く。

## 前提

- 本番に反映するのは、依頼者が tagpr のリリース PR を merge したときだけである。エージェントが `main` に merge しても、本番は変わらない。
- 環境は本番の 1 つだけである。本番と分けたデータで先に動かす環境(プレビュー環境)と、PR ごとのプレビュー版は、このスコープでは作らない。`main` に入った変更は、ローカルと CI で確かめる。
- この流れが効くのは、`scope4` が `main` に入り、依頼者が [依頼者が最初に行う設定](deploy.md#依頼者が最初に行う設定) を済ませた後である。それまでは、`main` への merge の後に、これまでどおり手で反映する([移行前の手順](deploy.md#移行前の手順))。

## 流れ

1. 変更の PR を `main` に merge する(エージェントが行ってよい)。
2. `main` への push で、tagpr の workflow が動く。tagpr が、リリース PR(`CHANGELOG.md` への追記)を開くか、更新する。この時点で本番は変わらない。
3. 依頼者が、リリース PR の中身を確かめ([リリース PR を merge する前に見るもの](deploy.md#リリース-pr-を-merge-する前に見るもの))、merge する。
4. 同じ workflow が再び動き、tagpr がタグ(`v0.4.0` の形)を作る。
5. tagpr がタグを作ったときだけ、workflow の 2 つ目の job が `release` ブランチをそのタグのコミットまで進める。
6. Workers Builds が `release` への push を見て、build と deploy のコマンドを動かす。deploy のコマンドが、反映のスクリプト(`scripts/release-deploy.mjs`)である。
7. スクリプトが、Time Travel の位置の記録、migration の適用、`wrangler deploy`、反映の後の確認を、この順に行う。失敗したらそこで止まり、Discord に知らせる。

```text
main への merge ──> tagpr: リリース PR を開く・更新する   (本番は変わらない)
リリース PR の merge ──> tagpr: タグを作る ──> release を進める ──> Workers Builds
                                                       └ release-deploy.mjs: 記録 → migration → deploy → 確認
```

## 部品

### tagpr(`.tagpr`)

| 設定 | 値 | 理由 |
| --- | --- | --- |
| `vPrefix` | `true` | タグを `v0.4.0` の形にする |
| `releaseBranch` | `main` | `main` からリリースする |
| `versionFile` | `-` | 版の番号をタグだけで持つ。上げるファイルが無い |
| `changelog` | `true` | リリース PR に `CHANGELOG.md` への追記を入れる |

ほかの項目は既定のままにした。`release` の既定は `true` で、タグのたびに GitHub Release が作られる。`command` と `postVersionCommand`(tagpr がリポジトリのコマンドを動かす項目)は使わない。リポジトリのコードを、書き込みの権限を持つ job で動かさないためである。

- **最初のタグは `v0.3.0` にする。** 第三スコープまでが入った、いまの本番の版である。依頼者が、`scope4` を `main` に merge する前に、そのときの `main` の先頭(本番と同じコミット)に付ける。タグが無いと、tagpr は `v0.0.0` から数え、これまでのすべての PR を `CHANGELOG.md` に並べる。
- **最初のリリースは `v0.4.0` にする。** tagpr は既定で patch を上げる。`scope4` の PR に `minor` ラベルを付けておくと、tagpr がリリース PR に `tagpr:minor` を付け、`v0.4.0` になる。ラベル `minor` は、リポジトリに無ければ依頼者が作る。以後、`v0.X` は第 X スコープの最初のリリースに当てる。
- **`CHANGELOG.md` の初めの形。** 見出し `# Changelog` だけのファイルから始める。tagpr が、版の見出し(`v0.4.0` に前の版との比較への link と日付が付く)の節を、PR の題名と番号とともに足す(tagpr 自身の `CHANGELOG.md` と同じ形)。節の中身は PR の題名がそのまま出るので、PR の題名は変更の内容を表すものにする。

### workflow(`.github/workflows/tagpr.yml`)

起動は、`main` への push だけである。手で起動する入口(`workflow_dispatch`)、PR、定期の起動を持たない。job は 2 つで、同時に 2 つ動かない(`concurrency`、途中で取り消さない)。

| job | 動くとき | 権限 | することと、しないこと |
| --- | --- | --- | --- |
| `tagpr` | `main` への push のたび | `contents: write`、`pull-requests: write`、`issues: read` | tagpr を動かす。リリース PR の枝とタグを push し、PR を開き、本文を書く。使う token は、その run の `GITHUB_TOKEN` だけ。リポジトリのコマンドは動かさない |
| `advance-release-branch` | `tagpr` がタグを作ったときだけ(`needs.tagpr.outputs.tag != ''`) | `contents: write` | `release` ブランチを、GitHub の API で、そのタグのコミットまで進める。checkout せず、リポジトリのコードを動かさない |

- ワークフロー全体の既定の権限は `contents: read` で、job が必要な書き込みを自分で宣言する。
- `release` の更新は、`git push` でなく API(`PATCH /git/refs/heads/release`)で、`force=false` を付ける。`release` が `main` の履歴から外れていれば、サーバーが断り、job が失敗する。ブランチが無いときだけ、`POST /git/refs` で作る。
- タグの名前は `vX.Y.Z` の形だけを受け、そのコミットが `main` の上にあること(比較の結果が `identical` か `behind`)を確かめる。どれかを満たさなければ、何も書かずに失敗する。
- タグの値は、`run` に式として埋めず、環境変数で渡す。

### `release` ブランチ

`release` は、Workers Builds が本番に反映する元である。ここにコミットが入ると、本番が変わる。

| だれ | できること |
| --- | --- |
| workflow(`advance-release-branch`) | タグのコミットまで進める。force なし |
| 依頼者 | 直接は進められない。ブランチの保護で止める。リリース PR の merge が、間接的に進める唯一の道である |
| エージェント | 進められない。`main` までしか merge できない |

ブランチの保護(依頼者が設定する。手順は [deploy.md](deploy.md#ブランチの保護))は、`release` の更新、作成、削除を禁じ、迂回できる者に GitHub Actions だけを置く。

### Workers Builds

本番の Worker `slide` に、リポジトリをつなぐ。設定する値は次のとおりである([deploy.md](deploy.md#workers-builds-を本番の-worker-につなぐ) に画面の場所を書く)。

| 設定 | 値 |
| --- | --- |
| 本番のブランチ | `release` |
| 本番以外のブランチの build(Enable Preview Builds) | 切る |
| build のコマンド | `pnpm run build` |
| deploy のコマンド | `node scripts/release-deploy.mjs` |
| build に渡す値 | `PNPM_VERSION=12.16.1`、`DISCORD_WEBHOOK_URL`(webhook の URL) |
| API token | 権限を絞った自分のトークン(D1 の編集を含む) |

- build に渡す値は、build のときだけ読め、実行中の Worker には渡らない。webhook は反映のスクリプトだけが読む。
- Workers Builds は、Worker の名前が `wrangler.jsonc` の `name`(`slide`)と同じでなければ失敗する。同じである。
- `PNPM_VERSION` を渡すのは、build の既定の pnpm が 9.10.0 で、CI の 12.16.1 と違うためである。Node.js の既定(24.22.1)は CI と同じ系列なので、渡さない。

### 反映のスクリプト(`scripts/release-deploy.mjs`)

Workers Builds の deploy のコマンドとして動く。build のコマンドが作ったファイルを使い、build はしない。

| 段階 | コマンド | 失敗したとき |
| --- | --- | --- |
| 1 記録 | `wrangler d1 time-travel info slide --json` | 止まる。何も変えていない |
| 2 migration | `wrangler d1 migrations apply slide --remote` | 止まる。失敗した migration は戻り、前の成功までが残る(wrangler の仕様) |
| 3 deploy | `wrangler deploy` | 止まる。migration は適用済みで、Worker は前の版のまま |
| 4 確認 | `scripts/post-deploy-checks.mjs` の項目すべて | 止まる。deploy 済み。戻すかどうかは人が決める(自動では戻さない) |

- 失敗したら、後の段階は行わず、終了コード 1 で終わる。Discord には、止まった段階と版(コミットの先頭 7 文字)だけを送る。確認が失敗したときは、失敗した項目の名前を加える。
- 起動の条件を満たさないとき(Workers Builds の外、本番のブランチ以外、引数の誤り)は、何も行わず、終了コード 2 で終わる。Workers Builds の本番のブランチ(`WORKERS_CI_BRANCH`)が `release` でなければ断るので、本番以外のブランチの build がうっかり本番を書き換えない(D-105)。
- 行き先の origin は、`--site`、`--content-origin`、`--admin-origin` で受け取る。省略すると `wrangler.jsonc` の `PUBLIC_ORIGIN`、`CONTENT_ORIGIN`、`OPERATOR_ORIGIN` を使う。origin は、https(自分の機械の http を除く)と host だけを受け、ほかは断る。
- webhook の URL(`DISCORD_WEBHOOK_URL`)は、build に渡す値から読む。無ければ、何も送らず、ログに「送れなかった」と 1 行だけ残し、失敗の終了コードは変えない。URL の形は `src/alerts/webhook-url.ts` と同じ決まりで確かめ、Discord の host と webhook の path だけを受ける。
- webhook の URL と API token は、出力に出さない。wrangler の出力は、URL と token の文字列を伏せてログに流す。wrangler を動かす子プロセスには、webhook を渡さない。
- 通知の本文は、固定の文言と、段階の名前、版、件数、確認の項目の名前だけである。メールアドレスと IP アドレスの形を含む本文は送らない(D-58)。
- 触れるもの: 本番の D1(Time Travel の位置の読み取りと migration の適用)、本番の Worker(deploy)、公開の URL への GET、Discord への POST。R2、secret、DNS には触れない。

### 反映の後の確認(`scripts/post-deploy-checks.mjs`)

ログインなしで確かめられるものである。どれかが失敗すると、全項目を出し切ったうえで、失敗した項目の名前を出して失敗で終わる。

| 項目 | 期待 |
| --- | --- |
| トップページ、`/terms`、`/privacy`、`/privacy/external`、`/help`、`/login` | `200`、`text/html` |
| `/robots.txt` | `200`、`text/plain` |
| `/api/slides`(未ログイン) | `401` |
| 公開中のスライド 1 本(トップページの一覧 `/api/public/slides` の先頭) | 共有 URL が `200`、その版の配信 origin が `200`。公開中のスライドが 1 本もないときは、この 2 項目を「飛ばした」と出し、失敗にしない |
| 存在しない版の配信 origin | `404` |
| 配信ドメインの `www.` に管理画面の経路(`/slides`) | `404` |
| 運営 origin(Access の外から) | 開かない(`301`、`302`、`303`、`307`、`308`、`401`、`403`、`404`。`2xx` と `5xx` は失敗) |

リダイレクトは追わない。1 回の要求は 15 秒で打ち切る。ここにない項目(表紙の画像、アバター、キャッシュの `ETag`、`wrangler` が要るもの)は、[反映後に確認する](deploy.md#反映後に確認する) の表のとおり、人が行う。

### 設定は変えない

`wrangler.jsonc` に環境(`env`)を足さない。Worker の名前、経路、D1、R2、上限(rate limit)、Access の値は、この作業の前と同じである。ほかの作業が binding や cron を足してよいのは、その作業の指示にあるときだけである。

## 確かめた仕様

2026-11-26 に、公式の文書を読んで確かめた。

| 事柄 | 確かめたこと | 出典 |
| --- | --- | --- |
| Workers Builds の設定 | 本番のブランチ(既定はリポジトリの既定のブランチ)、build のコマンド(既定なし)、deploy のコマンド(既定 `npx wrangler deploy`)、build だけに渡す変数と secret(実行時には読めない)、API token(user token のみ) | https://developers.cloudflare.com/workers/ci-cd/builds/configuration/ |
| 本番のブランチと本番以外 | 本番のブランチへの push のたびに build と deploy のコマンドが動く。本番以外のブランチの build は、Branch control の「Enable Preview Builds」を外すと止まる | https://developers.cloudflare.com/workers/ci-cd/builds/build-branches/ |
| build の環境 | `WORKERS_CI=1`、`WORKERS_CI_BRANCH`、`WORKERS_CI_COMMIT_SHA` が入る。Node.js の既定は 24.22.1。pnpm の既定は 9.10.0(`PNPM_VERSION` で変える)。依存関係は自動で入る(`SKIP_DEPENDENCY_INSTALL` で止められる) | 上の configuration と https://developers.cloudflare.com/workers/ci-cd/builds/build-image/ |
| build の上限 | build の時間は 20 分まで。同時の build は Free が 1、有料が 6 | https://developers.cloudflare.com/workers/ci-cd/builds/limits-and-pricing/ |
| 自動で作られる token の権限 | Account Settings(read)、Workers Scripts(edit)、Workers KV Storage(edit)、Workers R2 Storage(edit)、Workers Routes(edit、全 zone)、User Details(read)、Memberships(read)。D1 の編集は含まれない | configuration |
| D1 の migration | `migrations/` の `.sql` を番号順に適用し、`d1_migrations` に記録する。失敗した migration は戻り、前の成功までが残る。CI のような非対話では確認を飛ばす | https://developers.cloudflare.com/d1/reference/migrations/ と https://developers.cloudflare.com/workers/wrangler/commands/d1/ |
| D1 の Time Travel | 有料は 30 日、Free は 7 日の間の任意の分に戻せる。`wrangler d1 time-travel info <DB> --json` が bookmark を返す。復元は上書きで、戻す前の bookmark が返り、それに戻せる | https://developers.cloudflare.com/d1/reference/time-travel/ |
| tagpr の設定と挙動 | `vPrefix`、`releaseBranch`、`versionFile`(`-` はタグだけ)、`changelog`、`release`。`GITHUB_TOKEN` で作ったタグは別の workflow を起こさない。出力 `tag` は、タグを作った run だけ空でない。最初のタグが無いと `v0.0.0` から数える。既定は patch、`minor`・`major` ラベルの PR が `tagpr:minor`・`tagpr:major` をリリース PR に付ける | https://github.com/Songmu/tagpr(README) |
| GitHub のブランチの規則 | 「Restrict updates」「Restrict deletions」「Restrict creations」「Block force pushes」「Require a pull request before merging」「Require status checks to pass」。迂回する者に GitHub Apps を置ける | https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets |

読んでも分からなかったこと(人の確認に回した)は次のとおり。

- GitHub Actions(`GITHUB_TOKEN`)を、規則の迂回する者の一覧に置けるか。公式の文書に書かれていない(コミュニティの投稿には置けるという報告がある)。置けない場合は、[deploy.md](deploy.md#ブランチの保護) の代わりの手順に従う。
- Workers Builds が、すでにつながっている Worker に、つないだ直後の build を走らせるか。
- 自動で作られる token が、`wrangler deploy` に足りるか。D1 の編集と、必要なら DNS の編集が要る。足りなければ、最初の build が失敗する。

## 受け入れ条件

この設計は、機能の仕様を持たないので、ID を `REL-AC<番号>` の形でここに付ける。テストの名前の先頭に ID を入れる(`REL-AC4: Given ...`)。

| ID | 条件 | 確かめるもの |
| --- | --- | --- |
| REL-AC1 | 設定は、変更の前と同じ Worker の名前、account、経路、D1、R2、上限、Access の値になり、環境が足されていない | `scripts/release-flow.test.mjs`(`wrangler.jsonc` を読む) |
| REL-AC2 | `.tagpr` が、`vPrefix = true`、`releaseBranch = main`、`versionFile = -`、`changelog = true` である | 同上 |
| REL-AC3 | tagpr の workflow は `main` への push だけで動き、既定の権限は `contents: read`、job は書き込みを宣言した分だけを持つ。token は `GITHUB_TOKEN` だけで、シェルの手順に式を埋めない | 同上(workflow を読む) |
| REL-AC4 | `release` を進める job は、tagpr がタグを作ったときだけ動き、`force` を使わず(`force=false`)、ブランチが無ければ作る。`vX.Y.Z` 以外のタグ、`main` の上にないコミット、`release` が `main` の履歴から外れているときは、何も書かずに失敗する | 同上(条件を読み、手順のシェルを `gh` を差し替えて動かす) |
| REL-AC5 | workflow の `uses:` が `actions.lock` で固定されている。`gh actions-lock --verify` が通る | 同上(`actions.lock` を読む)。`gh actions-lock --verify`、`actionlint` |
| REL-AC6 | 反映のスクリプトは、記録、migration、deploy、確認の順に動き、どこかで失敗すると、後の段階を行わずに失敗で終わり、Discord に知らせる | `scripts/release-steps.pure.test.mjs`、`scripts/release-deploy.test.mjs`(wrangler を差し替えた別プロセス) |
| REL-AC7 | webhook が無いときは、知らせずに失敗の終了コードだけを返す。webhook の URL と API token は、出力にも通知にも、wrangler の環境にも出ない。通知はメールアドレスと IP アドレスの形を含まない | `scripts/discord-notice.pure.test.mjs`、`scripts/release-steps.pure.test.mjs`、`scripts/release-deploy.test.mjs` |
| REL-AC8 | 反映の後の確認は、項目のどれかが失敗すると失敗で終わり、失敗した項目をすべて名前で出す | `scripts/post-deploy-checks.pure.test.mjs`、`scripts/release-deploy.test.mjs` |
| REL-AC9 | 確認は、ログインなしの項目(上の表)を、引数で受け取った origin に対して行う。origin でない値は断る | `scripts/post-deploy-checks.pure.test.mjs`、`scripts/release-deploy.test.mjs` |
| REL-AC10 | 反映のスクリプトは、Workers Builds の外、本番のブランチ(`release`)以外の build では、何も行わずに断る | `scripts/release-options.pure.test.mjs`、`scripts/release-deploy.test.mjs` |

模擬で通ったことは、Workers Builds、GitHub のブランチの規則、Discord、本番の URL が実際に動く根拠にしない。実際につないでの確認は、[deploy.md](deploy.md#最初の-1-回の流れ) の流れの中で、依頼者が行う。

## 残るリスクと、決めたこと

- **`release` を進められるのは、リポジトリに書き込める人が作る workflow でもある。** 迂回する者に GitHub Actions を置くと、`contents: write` を持つ workflow は、ブランチの上でも `release` を進められる。防ぐのは、`main` の保護(PR が必須)と、書き込める人を少なく保つことである。より強くするには、`release` を進める鍵を、`main` だけに許した Environment の secret に置く GitHub App か deploy key にし、迂回する者をそれだけにする。この流れでは、設定の手間を増やさないため、GitHub Actions のまま始める。依頼者が判断する。
- **リリース PR には CI が自動で走らない。** tagpr が `GITHUB_TOKEN` で作る PR は、`pull_request` の workflow を起こさない。`main` の保護が CI を必須にしていると、リリース PR を merge できない。依頼者が、リリース PR を閉じて開き直す(人が開き直すと CI が動く)。手順は [deploy.md](deploy.md#リリース-pr-を-merge-する前に見るもの) にある。GitHub App の token で tagpr を動かせば不要になるが、App を作る手間が増えるので、このスコープでは採らない。
- **反映の後の確認が失敗しても、自動では戻さない。** deploy 済みで migration も適用済みなので、戻す判断(Worker だけを戻すか、D1 を戻すか)は人が行う(D-111)。手順は [deploy.md](deploy.md#戻す) にある。
- **途中で止まっても、`release` は進んだままである。** 止まったあとの再実行は、Workers Builds の画面から build を取り直す。migration の適用は、適用済みの分を飛ばすので、取り直しても二重に適用されない([deploy.md](deploy.md#反映が止まったとき))。
- **通知の種類は、`deploy_check_failed` だけが D-56 にある。** 「途中で止まった」通知は、固定の文言で同じ口(Discord)に送るが、種類としては数えず、`src/alerts` の通知の型には足していない。作業 M の通知の口と文言を合わせるかは、依頼者が決める。

## 範囲外

- プレビュー環境と、PR ごとのプレビュー版(D-156)。
- Cloudflare と GitHub の設定そのもの(手順だけ書く)。
- `main` への merge、deploy、タグを作ること、`release` ブランチを作ること。
- 反映の自動の巻き戻し。
