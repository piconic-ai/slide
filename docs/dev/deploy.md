# 本番に反映する

Worker `slide`、domain `slide.community`、D1 `slide`、非公開 R2 `slide-uploads` へ変更を反映する手順。設計と、確かめる条件は [リリースの流れの設計](release-flow.md) にある。

> **この流れは、2026-11-27 から効いている。** 最初のリリース(`v0.4.0`)が、この流れで通った。結果は [最初の 1 回の結果](#最初の-1-回の結果2026-11-27utc-では-2026-11-26) にある。以前の、`main` への merge の後に手で反映する手順は、外した。

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

これとは別に、反映の前に、ダッシュボードで Analytics Engine を有効にする(deploy が止まったとき。[計測の設定](metrics-setup.md#1-analytics-engine-の-dataset)。公式の文書で確かめられていない)。

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

これで、`release` に直接 push できる人はいなくなる。依頼者も、エージェントも、直接は進められない。ただし、**進められるのは `advance-release-branch` だけ、にはならない。** Bypass list に GitHub Actions を置くと、リポジトリに書き込める人が、別のブランチに `contents: write` を持つ workflow を置いて動かせば、`GITHUB_TOKEN` で `release` を、いまの先頭の子孫になる任意のコミットまで進められる。`Block force pushes` と、API の `force=false` は、巻き戻しと履歴の書き換えを止めるだけである。書き込める人を最小に保つこと。

**より強い形(推奨)。** `release` を進める鍵を、GitHub App(または deploy key)にする。Bypass list は、その App(または deploy key)だけにして、GitHub Actions は置かない。App の秘密鍵を、`main` だけに許した Environment(Settings > Environments で作り、Deployment branches and tags を `main` だけにする)の secret に置く。`advance-release-branch` を、その Environment と App の token(`actions/create-github-app-token` のような action)で動かす形に変える。別のブランチの workflow は、その secret を読めない。この変更は、App と secret を足し、`tagpr.yml` と `actions.lock` を変えるので、依頼者が採るかを決めてから、別の PR で行う([リリースの流れの設計](release-flow.md#残るリスクと決めたこと))。

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

2. **足した binding の先の資源を作る。** バックアップのバケット(`slide-uploads-backup`)。[バックアップ](#バックアップ作業-b)。計測の dataset は、`wrangler.jsonc` の binding があれば、最初の書き込みで作られるので、作らない。ただし、反映の前に、ダッシュボードで Analytics Engine を有効にする(deploy が止まったとき。確かめられていない。[計測の設定](metrics-setup.md#1-analytics-engine-の-dataset))。
3. **secret を登録する。** Discord の webhook([通知と監視](#通知と監視作業-m))、計測の読み取りのトークンとアカウントの番号([計測](#計測作業-a))。それぞれの節に従い、`wrangler secret put` で入力する。
4. **「依頼者が最初に行う設定」をすべて行う。** 最初のタグと `release` の作成、ブランチの保護、token、Workers Builds の接続まで。
5. **`scope4` の PR に `minor` のラベルを付けて、`main` に merge する。** 本番は変わらないことを確かめる(`pnpm exec wrangler deployments status` の版が、merge の前と同じ)。`main` の CI が通ること。Actions の `tagpr` の run が成功し、リリース PR が開くこと。リリース PR のラベルに `tagpr:minor` が付き、題名が `v0.4.0` になっていること。
6. **リリース PR を確かめて、merge する。** [リリース PR を merge する前に見るもの](#リリース-pr-を-merge-する前に見るもの) をすべて見る。
7. **反映を見届ける。** [リリース PR を merge した後に見るもの](#リリース-pr-を-merge-した後に見るもの) のとおり、その間は `main` に merge しない。merge の後に、Actions の `tagpr` の run で、タグ `v0.4.0` が作られ、`Advance the release branch` の job が成功する。Cloudflare の Workers & Pages > `slide` > Deployments(Builds)で、build が走り、ログに次が順に出ること: `step 1/4` から `step 4/4`、`Time Travel bookmark before this release`、各確認の行、`the release is checked`。止まったら [反映が止まったとき](#反映が止まったとき)。
8. **反映の後の確認の残りを行う。** [反映後に確認する](#反映後に確認する) の、人が行う行。
9. **それぞれの節の初回の作業を行う。** Cloudflare のアラートと Budget alerts の設定、見張りの Worker の deploy、通知を 1 つずつ試すこと([通知と監視](#通知と監視作業-m))、バックアップのバケットの行を足すことと、戻し方を一度試すこと([バックアップ](#バックアップ作業-b))。実機のブラウザでの保存した版の確認([保存した版](#保存した版作業-o))。
10. **規約とプライバシーポリシーの文面を仕上げて、施行日を入れる。** もう一度リリースする。それまで、規約のページは「下書き」として出る。9 は、8 の後のいつ行ってもよい。(初版の文面には、2026-11-27 の施行日を入れた。この変更を含むリリースで、「下書き」の表示が外れ、3 つのページが検索に載る。)

実際に動かして確かめるまで、次は確かめていない。結果を、この節の末尾に日付とともに記録する。

- GitHub Actions を `release` の迂回する者に置けたか(置けなかったときの形)。
- Workers Builds の token の権限が足りたか。
- build に渡した値が、deploy のコマンドから読めたか。反映の script が Discord に送るのは、止まったときと、反映後の確認に失敗したときだけで、成功の run では通知が出ないので、成功の run だけでは確かめられない(失敗を起こして確かめる)。
- Workers Builds が、`release` の最初の push で build を始めたか。

### 最初の 1 回の結果(2026-11-27。UTC では 2026-11-26)

リリース PR #639(`v0.4.0`)を merge して、Workers Builds が反映するところまで通った。反映したコードは、その前に手で反映していた `0affc86a`(第四スコープと、トップのタイムライン)と同じで、migration は無かった。つまり、仕組みを動かして確かめる試運転だった。

| 確かめること | 結果 |
| --- | --- |
| GitHub Actions を `release` の迂回する者に置けたか | **置けなかった**(Bypass list に `GitHub Actions` が出なかった)。そこで、`release` の規則から **Restrict updates だけを外し**、作成の制限、削除の禁止、force push の禁止は残した。この形で、`GITHUB_TOKEN` の workflow(`Advance the release branch`)が、`release` を `v0.4.0` のコミット(`564585df`)まで、force なしで進められた。弱い形で、書き込める人が、手で `release` を進められる(巻き戻しと書き換えはできない)。決まり: 依頼者もエージェントも、`release` へ直接 push しない。鍵を GitHub App にするかは、保留 |
| Workers Builds の token の権限が足りたか | **足りた。** Account: D1・Workers R2 Storage・Workers Scripts の Edit と Account Settings の Read、Zone(`slide.community`、`slideusercontent.com`): Workers Routes・SSL and Certificates・DNS の Edit、User: Memberships・User Details の Read。Browser Run、KV など、使わない権限は外してあった。ただし、適用する migration が無かったので、**D1 への書き込み(migration の適用)は、この回では動かしていない**。migration を含む次のリリースで確かめる |
| build に渡した値が、deploy のコマンドから読めたか | build は `PNPM_VERSION` を使って最後まで通った。**`DISCORD_WEBHOOK_URL` が読めたかは、確かめていない。** 成功の run は、Discord に何も送らない設計で(送るのは、止まったときと、反映後の確認に失敗したときだけ)、実際に、通知は届かなかった(依頼者が確認した)。失敗の通知が届くことは、失敗を起こして確かめる(通知を確かめる作業と合わせて、後日) |
| Workers Builds が、`release` の最初の push で build を始めたか | **始めた。** merge(17:16:33 UTC)から、新しい版(`bff2b02c-5ea0-4307-bbef-deffa0c5184c`)が出る(17:17:44 UTC)まで、約 1 分。GitHub の `release` のコミットに、check `Workers Builds: slide` が付き、成功した。反映後の確認(`node scripts/post-deploy-check.mjs`)は、14 行すべて ok |

そのほかに分かったこと。

- リリース PR #639 には、`pull_request` の CI が走らなかった。`main` の保護が CI を必須にしているので、依頼者が PR を閉じて開き直して、CI を動かした。毎回の手作業になる。tagpr のワークフローから CI を起動する案(#646)は、「その場しのぎ」に見えるとして、保留にした。GitHub App の token で tagpr を動かす案を、鍵の判断と合わせて、あとで決める。
- 前の版は `51d050a6-643d-4051-9afc-217ce0fe8e4e`。戻すときは、[Worker を戻す](#worker-を戻す)。

## 反映の仕組み

| ファイル | 役目 |
| --- | --- |
| `.tagpr` | tagpr の設定。`vPrefix`、`releaseBranch = main`、`versionFile = -`、`changelog` |
| `.github/workflows/tagpr.yml` | `main` への push で tagpr を動かす。タグが作られたときだけ、`release` を API で進める(`force=false`) |
| `scripts/release-deploy.mjs` | Workers Builds の deploy のコマンド。記録、migration、deploy、確認の順に動く |
| `scripts/post-deploy-checks.mjs` | 反映の後の確認(ログインなしの項目) |
| `scripts/release-steps.mjs`、`scripts/release-options.mjs`、`scripts/discord-notice.mjs`、`scripts/release-fetch.mjs` | 上の部品。順番、起動の条件、Discord への通知、要求の時間の上限 |

反映のスクリプトは、Workers Builds の外では、何も行わずに断る(`--allow-outside-ci` を付けたときを除く)。旗を付けるのは、依頼者が復旧のために手で動かすときだけである。付けたときも、作業ツリーに commit していない変更が無いこと、`HEAD` が push 済みの `origin/release` と同じことを確かめ、違えば断る。つまり、手で反映するときも、commit して push した後、その push 済みのコミットのきれいな checkout から動かす。Workers Builds の build では、旗を付けても、本番のブランチ以外を断る。確認だけを手で動かすには、`node scripts/post-deploy-check.mjs` を使う。起動したときの origin は、`--site`、`--content-origin`、`--admin-origin` で渡す(省略すると `wrangler.jsonc` の値)。1 つでも失敗した項目があれば、終了コード 1 で終わり、失敗した項目を出す。設計と、確かめる条件は [リリースの流れの設計](release-flow.md) にある。

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

## リリース PR を merge した後に見るもの

`tagpr` の workflow は、同時に 1 つしか待てない。リリース PR の merge の run が待っている間に、別の変更が `main` に入ると、その run は新しい run に置き換えられ、タグが作られない(tagpr は、run の commit に結び付いたリリース PR だけを見る)。だから、リリース PR を merge したら、次を済ませるまで、`main` に何も merge しない。依頼者も、開発ループも守る。

1. Actions の `tagpr` の run(リリース PR の merge の commit のもの)が終わるのを待つ。
2. タグが作られたことを見る。

   ```sh
   git ls-remote --tags origin 'v*'
   ```

3. `release` が、そのタグのコミットまで進んだことを見る。

   ```sh
   git ls-remote origin refs/heads/release
   ```

4. Cloudflare の Builds で、build が始まったことを見る([反映を見届ける](#最初の-1-回の流れ))。

**タグが作られなかったとき**(run が置き換えられた、取り消された)。`release` は進まず、本番は変わらない。リリース PR の中身は `main` に入り、`CHANGELOG.md` にも入っている。Actions で、そのリリース PR の merge の commit の `tagpr` の run を開き、`Re-run all jobs` を押す。再実行は、その commit で動くので、tagpr はその merge を見てタグを作るはずである(tagpr のソースから読んだ見込みで、実際には動かしていない)。それで作られなければ、リリース PR をもう一度出す形にしてよいかを、依頼者が決める(tagpr が、同じ変更を含む次のリリース PR を開く)。

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
|  | `curl -s -o /dev/null -w '%{http_code}' https://slide.community/my/slides/try-static` | 未ログインで `401` |
| 〇 | トップページ、`/robots.txt`、`/terms`、`/privacy`、`/privacy/external`、`/help` | `200`(`/robots.txt` は `text/plain`) |
| 〇 | 一覧に出ている公開中のスライド 1 本の共有 URL と、その版の origin | どちらも `200` |
|  | `pnpm exec wrangler d1 execute slide --remote --command "SELECT state, count(*) FROM deployments GROUP BY state"` | 反映前にあった `ready` の件数が減っていない |
| 〇 | `curl -s -o /dev/null -w '%{http_code}' https://d-00000000-0000-4000-8000-000000000000.slideusercontent.com/` | 存在しない deployment の origin で `404` |
| 〇 | `curl -s -o /dev/null -w '%{http_code}' https://www.slideusercontent.com/my/slides` | 管理画面の route は配信ドメイン側で応答せず `404` |
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

- build の取り直しは、Builds の一覧で、その build の `Retry build`(画面によって名前が違う)を押す。取り直しは、同じ `release` のコミットを、同じ 4 段階で行う。**取り直すのは、最新の build だけである。** 古い build を取り直すと、本番がその古い版に後戻りする。Builds の一覧で、取り直す build のコミットが `release` の先頭(`git ls-remote origin refs/heads/release`)と同じことを確かめてから押す。反映のスクリプトも、先頭でないコミットの build を断る(GitHub の API が答えるとき)が、それに頼らない。
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
   - `curl -s -o /dev/null -w '%{http_code}' https://slide.community/my/slides` が `503` になる。
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

R2 の `slide-uploads` のファイルを誤って消したり壊したりしたとき、30 日以内なら、バックアップのバケット `slide-uploads-backup` から戻せる。設計は [R2 のバックアップの実装設計](backup.md) にある。D1 のバックアップは、この節の範囲ではない(D1 は [Time Travel](#d1-を戻す) で戻す)。

覚えておくこと。

- サービスの Worker が、毎日 18 時(UTC。日本の 3 時)に、新しく置かれたファイルだけをバックアップへ写す。キーは元と同じなので、戻すときにキーを変えなくてよい。
- 元から消されたファイルのコピーは、消えたと巡回が気づいてから 30 日残り、過ぎたら消える。元にあるファイルのコピーは、消えない。
- 写さないもの: `gravatar/`(他のサービスの画像の控え)と `exports/`(書き出しの鍵)。どちらも、無ければ作り直される。
- 運営の画面の「運用」の「バックアップ」の枠で、最後に写した日時、写した数、失敗を見る。失敗は、翌日のメールにも入る([通知の手順](alerts-runbook.md#backup-failed))。

#### バケットを作る(依頼者)

エージェントはバケットを作らず、`wrangler.jsonc` にも `UPLOADS_BACKUP` を足していない(足すと、バケットが無い環境で deploy が止まるおそれがあるため。理由は [設計](backup.md#binding))。次の順に、依頼者が行う。順番が逆だと、反映が止まる。

1. バケットを作る。名前は `slide-uploads-backup` とする(違う名前にしたときは、手順 4 の行も合わせる)。

   ```sh
   pnpm exec wrangler r2 bucket create slide-uploads-backup
   pnpm exec wrangler r2 bucket list
   ```

2. 公開していないことを確かめる。`slide-uploads` と同じ確認である([反映後に確認する](#反映後に確認する))。r2.dev の公開が無効で、custom domain がないこと。

   ```sh
   pnpm exec wrangler r2 bucket dev-url get slide-uploads-backup
   pnpm exec wrangler r2 bucket domain list slide-uploads-backup
   ```

3. **バケットに lifecycle の規則を置かない。** 「置いてから N 日で消す」規則は、元にあるファイルのコピーも消してしまう。30 日の決まりは、Worker が守る。

4. `wrangler.jsonc` の `r2_buckets` に、次の行を足す PR を出す(エージェントに頼んでもよい。権限に関わる値は変えない)。

   ```jsonc
   "r2_buckets": [
     { "binding": "UPLOADS", "bucket_name": "slide-uploads" },
     { "binding": "UPLOADS_BACKUP", "bucket_name": "slide-uploads-backup" },
   ],
   ```

   型は `src/env.d.ts` が、binding が無くてもよい形で持っている。`wrangler types` で生成する型に `UPLOADS_BACKUP` が入ったら、`src/env.d.ts` の行を消す。

5. [リリース PR を merge する前に見るもの](#リリース-pr-を-merge-する前に見るもの) の 4 番のとおり、足した binding の先(手順 1 のバケット)があることを確かめて、リリースする。
6. 反映の後、毎時 17 分の実行で、最初の巡回が始まる(それまでに巡回を始めたことがなければ、18 時を待たずに始める)。運営の画面の「バックアップ」の枠が「未設定」でなくなり、巡回が終わると「最後に写した日時」と「最後の巡回で写した数」が出る。Cloudflare の画面の R2 で、`slide-uploads-backup` のオブジェクト数が、`slide-uploads` から `gravatar/` と `exports/` を除いた数に近づくことを確かめる。1 回で終わらない量は、毎時の実行で続きから進む。

#### 1 つのスライドを戻す

`slide-uploads` の、あるスライドのファイルが消えた、または壊れたときの手順である。D1 の行(スライドと版)が残っていることが前提である。D1 の行ごと消えたスライドは、この手順では戻らない。

1. スライドの版とファイルのキーを、D1 から読む。公開中の版は `decks.public_deployment_id` が指す(下書きの版も戻すなら `state = 'ready'` の版すべて)。`<deck id>` は管理画面の URL の slug ではなく、`decks.id` である(`SELECT id FROM decks WHERE slug = '<slug>'` で引ける。slug は作者ごとの名前なので、複数返ったら `owner_user_id` で絞る)。

   ```sh
   pnpm exec wrangler d1 execute slide --remote --command \
     "SELECT f.deployment_id, f.object_key, f.sha256, f.media_type FROM upload_files f JOIN deployments d ON d.id = f.deployment_id WHERE d.deck_id = '<deck id>' AND d.state = 'ready' AND f.object_key IS NOT NULL"
   ```

2. 各キーが、バックアップにあるかを確かめ、取り出す。取り出したファイルの SHA-256 が、手順 1 の `sha256` と同じであることを確かめる。違えば、そのコピーは使わない(元の版を作者がもう一度置く)。

   ```sh
   pnpm exec wrangler r2 object get "slide-uploads-backup/<object_key>" --remote --file "$WORK/<名前>"
   shasum -a 256 "$WORK/<名前>"
   ```

3. `slide-uploads` に、同じキーで置く。種類は、手順 1 の `media_type` と同じにする。

   ```sh
   pnpm exec wrangler r2 object put "slide-uploads/<object_key>" --remote --file "$WORK/<名前>" --content-type "<media_type>"
   ```

4. 管理画面のスライドと、共有 URL を開いて、ファイルが読めることを確かめる。`$WORK` は、リポジトリの外の一時ディレクトリにする。

ファイルが多いときは、下の「すべてを戻す」と同じ道具(rclone)に、このスライドのキーの一覧だけを渡す。

#### すべてを戻す

バケットごとの喪失(誤ってバケットを空にした、など)や、多数のファイルの破損のときの手順である。戻すのは、D1 が指しているファイルだけにする。元から消された deck のコピーまで戻すと、どの行も指さないファイルが R2 に増えるだけである(増えても、掃除は自動では消さない。[D1 を戻す](#d1-を戻す) の「復元した時点より後に始めた版」と同じ)。

1. 書き込みを止める。[メンテナンスの手順](#メンテナンス作業-n) で、メンテナンスの表示に切り替える。cron の処理も止まる。
2. バックアップが戻せる状態かを確かめる。運営の画面の「バックアップ」の枠に、失敗がなく、「バックアップにあるファイル」が元に近い数であること。
3. 戻すキーの一覧を、D1 から作る。スライドのファイル、プロフィール画像、コミュニティの画像である。

   ```sh
   pnpm exec wrangler d1 execute slide --remote --json --command \
     "SELECT object_key AS key FROM upload_files WHERE object_key IS NOT NULL UNION ALL SELECT 'avatars/' || user_id FROM profile_pictures UNION ALL SELECT 'communities/' || id || '/logo' FROM communities WHERE logo_at IS NOT NULL UNION ALL SELECT 'communities/' || id || '/cover' FROM communities WHERE cover_at IS NOT NULL" > "$WORK/keys.json"
   ```

   出力の `key` の列を、1 行に 1 つのキーのファイル(`$WORK/keys.txt`)にする。
4. rclone を、S3 互換の鍵で設定する。鍵は、[R2 の API トークン](https://developers.cloudflare.com/r2/api/tokens/)(2026-11-26 に確かめた)を「Object Read & Write」で作り、2 つのバケットだけに絞る。作業が終わったらトークンを消す。鍵は、リポジトリにも `.dev.vars` にも置かず、keychain から環境変数で入れる。設定の形は [rclone の R2 の文書](https://developers.cloudflare.com/r2/examples/rclone/) にある(`type = s3`、`provider = Cloudflare`、`endpoint = https://<account id>.r2.cloudflarestorage.com`、`no_check_bucket = true`)。以下では remote の名前を `r2` とする。
5. まず試す。`--dry-run` は何も書かない。戻る数と、戻らない理由を確かめる。

   ```sh
   rclone copy r2:slide-uploads-backup r2:slide-uploads --files-from "$WORK/keys.txt" --ignore-existing --dry-run -v
   ```

   `--ignore-existing` は、`slide-uploads` にすでにあるキーを書き換えない。壊れたファイルを置き換えたいときは、そのキーだけの一覧を作り、`--ignore-existing` を外し、`--checksum` を付ける(`rclone copy` の旗は [rclone の文書](https://rclone.org/commands/rclone_copy/)、2026-11-26 に確かめた)。
6. 試しの結果が正しければ、`--dry-run` を外して実行する。
7. 戻したファイルが、D1 の `sha256` と同じかを、何件か抜き出して確かめる(上の「1 つのスライドを戻す」の手順 2)。共有 URL と、管理画面のスライドを開く。
8. メンテナンスの表示を終える。バックアップの枠が、次の巡回でも失敗なく動くことを、翌日に確かめる。

バックアップのバケットそのものを空にしてしまったときは、`backup_objects` が「写した」と覚えているので、次の巡回は何も写さない。記録を空にして、巡回をはじめからやり直させる。

```sh
pnpm exec wrangler d1 execute slide --remote --command \
  "DELETE FROM backup_objects; UPDATE backup_state SET pass_started_at = NULL, cursor = NULL, last_pass_started_at = NULL, progress_at = NULL WHERE id = 1"
```

次の毎時の実行で、新しい巡回が、すべてのファイルを写す。

#### D1 を Time Travel で戻したときに、R2 と合わせる

D1 を [復元した](#d1-を復元する) あとは、D1 の行は復元した時点のもの、R2 はいまのもの、になる。上の「R2 は復元されない」の 3 つの場合に、バックアップは次のとおり使える。

- **復元した時点の行が指すファイルが、R2 に無い**(復元した時点より後に、掃除や誤操作で消えた): 「すべてを戻す」の手順 3 から 7 で、D1 が指すファイルを、バックアップから戻す。復元した後の D1 の行から一覧を作るので、必要なものだけが戻る。`--ignore-existing` で、あるものは書き換えない。
- **復元した時点より後に始めた版のファイル**: R2 に残るが、どの行も指さない。バックアップにも写っていることがある。戻す対象ではなく、消すかどうかを、費用で決める(これまでどおり)。
- **バックアップの記録(`backup_objects`、`backup_state`)**: D1 と一緒に、復元した時点に戻る。次の巡回が、元のバケットと突き合わせ直すので、手当ては要らない。復元した後に写したコピーは、記録に無いので、もう一度同じ中身で書かれるだけである。元から消えて 30 日たったコピーの行が復元されたときは、コピーがもう無いが、元も無いので、次の実行が行を消す。

復元の前にバックアップの枠を見て、失敗が続いていないか、巡回が途中で止まっていないかを確かめる。

#### 戻し方を一度試す(依頼者)

バケットを作って最初の巡回が終わった後、本番で一度試す。試すスライドは、このために置いた使い捨てのものにする。

1. 使い捨てのスライドを置く(小さな HTML 1 つで足りる)。次の巡回(毎時 17 分の実行のうち、巡回が途中なら続き、なければ翌日 18 時)で、バックアップに写るのを待つ。「バックアップにあるファイル」の数が増え、`wrangler r2 object get "slide-uploads-backup/<object_key>" --remote --file "$WORK/x"` で取り出せる。
2. `wrangler r2 object delete "slide-uploads/<object_key>" --remote` で、**そのスライドのファイルだけ**を消す。共有 URL が、ファイルを読めなくなる。
3. 「1 つのスライドを戻す」の手順 2 から 4 で戻す。共有 URL が、元どおり読める。取り出したファイルの SHA-256 が、D1 の `sha256` と同じである。
4. 「すべてを戻す」の手順 3 から 5 を、`--dry-run` のまま実行する(手順 6 は実行しない)。戻す数が 0 であること。
5. 使い捨てのスライドを、管理画面から消す。そのコピーが、バックアップに 30 日残り、運営の画面の「元から消えて保管中のファイル」に数えられること、30 日後に消えることを、覚えておく(30 日後に確かめなくてよい。試験は、ローカルで済ませてある)。

試した日と結果は、この節の末尾に 1 行で足す。

## 本番のデータを手元に写すときの決まり

不具合の調査や試験のために、本番のデータを手元に写すことがある。写しは、本番より守りが弱い(自分のマシン、共有のディスク、バックアップ)ので、メールアドレスを持つ表は写さない([メールアドレスに触れる場所を限る](../features/f43-email-handling.md)。設計は [メールアドレスに触れる場所を限る実装設計](f43-email-handling.md))。写すのは依頼者が行う。エージェントは、本番に触れない。

- **メールアドレスを持つ表を、写さない。** 登録者のメールアドレスを持つ表は、`src/privacy/email-exposure.ts` の `ADDRESS_COLUMNS` で `subscriber` の列を持つ表である(`auth_user`、`invited_emails`、`mail_outbox`、`auth_verification`。宣言に足すと、ここも変わる)。`wrangler d1 export --remote` を、表を選ばずに実行しない。
- **写す表は、手段が決める。** ローカルの D1(`wrangler dev` が使うもの。migration を適用してあること)で、次を動かす。本番を指す `--remote` は受け付けない。
  - `node scripts/db-export-without-email.mjs --output <写しの置き場>/copy.sql` は、ローカルの D1 から、メールアドレスを持つ表を除いて書き出す。
  - 本番の写しが必要なときは、`node scripts/db-export-without-email.mjs --list` が出す表(メールアドレスを持つ表以外の全部)を、依頼者が `wrangler d1 export slide --remote --output <写しの置き場>/copy.sql --table <表...>` の `--table` に渡して書き出す。ローカルの schema と本番の schema は、migration が同じなら同じである。
- **写しを置く場所。** リポジトリの外の、自分だけが読めるフォルダー(たとえば `~/slide-data-copies/`。`chmod 700`)。リポジトリの中には置かない(`.wrangler/` の下だけは、commit されない)。手段は、リポジトリの中に書き出そうとすると断る。クラウドの同期、共有のフォルダー、チャットや issue への貼り付けには置かない。
- **調べ終えたら消す。** 調べ終えた日に、写しを消す(`rm -P` ではなく、普通に消してよい。写しの中にメールアドレスは無い)。残すときは、理由と消す日を、調査の記録に書く。
- **除いても残るもの。** `auth_session` の IP アドレス、利用者の名前、スライドと記事の本文は、写しに入る。人を特定できる情報として扱う。
- **D1 のバックアップと復元用の履歴(Time Travel)には、メールアドレスが入る。** 本番の D1 そのものだからである。メールアドレスを除くことはできない。履歴の期間(有料のプランで 30 日)は、本番の D1 の中に残る。取り出すのは、[D1 を戻す](#d1-を戻す) の復元のときだけで、そのときも写しは作らない。

## 運用の手順

第四スコープで足した仕組みの、依頼者が行う手順の置き場である。作業ごとの節が、**いつ行うか**(「最初の 1 回の流れ」の何番か。指示書 06-DONE.md の「本番での反映の順番」の 8 は、ここでは 9 に当たる。指示書の 7(メールアドレスの書き換え)は、作らないことにしたので無い)、**何を行うか**、**無いときの動き**を書く。長い手順(コマンド、画面の操作、確かめ方)は別の文書にあり、同じ設定を 2 か所に書かないために、ここからは、どの節を開くかだけを示す。メンテナンスは、手順が短いので、この節に書いてある。

| 節 | 最初の 1 回の流れ | 詳しい手順 |
| --- | --- | --- |
| [通知と監視](#通知と監視作業-m) | 3(secret)、9(アラート、見張り、試験) | [通知の手順](alerts-runbook.md) |
| [計測](#計測作業-a) | 3(トークン) | [計測の設定の手順](metrics-setup.md) |
| [バックアップ](#バックアップ作業-b) | 2(バケット)、9(行を足す、戻し方の試験) | [R2 をバックアップから戻す](#r2-をバックアップから戻す) |
| [メンテナンス](#メンテナンス作業-n) | 随時 | この節 |
| [登録を開く](#登録を開く作業-r) | 招待制を外すとき | [招待なしで登録できるようにする実装設計](f42-open-signup.md#手順) |
| [保存した版](#保存した版作業-o) | 9(実機の確認) | [通信が切れても読める実装設計](f37-offline-reading.md) |

### 通知と監視(作業 M)

設計は [通知の実装設計](alerts.md)、手順は [通知の手順](alerts-runbook.md) にある。依頼者が行うのは、次である。

1. **Discord の webhook を作り、secret に登録する**(最初の 1 回の流れ 3)。サービスの Worker と見張りの Worker の両方に入れる。翌日のメールの宛先を、お問い合わせの宛先と別にするときだけ `ALERT_MAIL_TO`。[Discord の webhook](alerts-runbook.md#discord-webhook)。
2. **見張りの Worker を deploy する**(同 9)。サービスの deploy とは別で、手で行う。commit と push の後、きれいな checkout の push 済みの commit から行う。[見張りの Worker の deploy](alerts-runbook.md#見張りの-worker-の-deploy)。
3. **Cloudflare のアラート 3 つと Budget alerts 9 段を設定する**(同 9)。[Monitors のアラート 3 つ](alerts-runbook.md#monitors-のアラート-3-つ)、[Budget alerts 9 段](alerts-runbook.md#budget-alerts-9-段)。
4. **通知を 1 つずつ、わざと失敗を起こして試す**(同 9)。[わざと失敗を起こして確かめる](alerts-runbook.md#わざと失敗を起こして確かめる)。
5. **Workers のログと Cloudflare の監査ログの保存期間を確かめる**。結果は、プライバシーポリシーの履歴情報を残す期間(初版で「最大 3 か月」と決まった)が、実際と合っているかを確かめる材料になる。[ログと監査ログの保存期間を確かめる](alerts-runbook.md#ログと監査ログの保存期間を確かめる)。

**無いときの動き(D-08)。** webhook が無い、または Discord の webhook の形でないあいだは、すぐの通知は送られず、記録とログ 1 行(`alert_not_sent`)が残る。運営の画面の「通知」の枠は「未設定」と出す。翌日のメールは、メールの送り口があれば送る。サービスは、今までどおり動く。

通知が届いたときの手順は、[通知ごとの手順](alerts-runbook.md#通知ごとの手順)にある。反映のスクリプトが失敗したときの通知は、[反映が止まったとき](#反映が止まったとき)。

### 計測(作業 A)

設計は [計測の実装設計](metrics.md)、手順は [計測の設定の手順](metrics-setup.md) にある。

1. **読み取り用のトークンを作り、`ANALYTICS_READ_TOKEN` と `ANALYTICS_ACCOUNT_ID` を secret に登録する**(最初の 1 回の流れ 3)。権限は Account Analytics の Read だけ。[読み取り用のトークン](metrics-setup.md#2-読み取り用のトークン)、[登録する](metrics-setup.md#3-登録する)。
2. dataset `slide_events` は、`wrangler.jsonc` の binding `ANALYTICS` があり、deploy の後の最初の書き込みで作られる。**このスコープを反映すると、記録が始まる。** 反映の前に、計測がプライバシーポリシーの範囲に収まることを、[突き合わせた結果](metrics.md#プライバシーポリシーとの突き合わせf40-の-7)で確かめる。
3. 反映の後に、実際の API で一度確かめる。[最初に 1 度、実際の API で確かめる](metrics-setup.md#4-最初に-1-度実際の-api-で確かめる)。

**無いときの動き(D-08)。** binding が無ければ記録は何もしない。トークンかアカウントの番号が無ければ、日ごとの集計は何もしない。どちらも、運営の画面の「計測」が「未設定」と出す。

### バックアップ(作業 B)

設計は [R2 のバックアップの実装設計](backup.md)。手順は、[R2 をバックアップから戻す](#r2-をバックアップから戻す) の節にまとめてある。

1. **バケット `slide-uploads-backup` を作り、公開していないことを確かめる**(最初の 1 回の流れ 2)。lifecycle の規則は置かない。[バケットを作る(依頼者)](#バケットを作る依頼者)の 1〜3。
2. **`wrangler.jsonc` に `UPLOADS_BACKUP` の行を足す PR を出して、反映する。** バケットを先に作る。順番が逆だと反映が止まる。[バケットを作る(依頼者)](#バケットを作る依頼者)の 4。
3. **戻し方を一度試す**(同 9)。[戻し方を一度試す(依頼者)](#戻し方を一度試す依頼者)。

**無いときの動き(D-08)。** `wrangler.jsonc` に行が無いあいだ、毎時の処理 `backup` は何も読まず何も書かずに終わり、運営の画面の「バックアップ」の枠は「未設定」と出す。

### メンテナンス(作業 N)

サービスを止める作業の手順である。値の形と設計は [メンテナンスの実装設計](maintenance.md) にある。止めるのは secret `MAINTENANCE` で、運営の画面の「予告」は止めない(知らせるだけ)。

#### 1. 予告を出す

止める 3 日前までに、運営の画面の「メンテナンスの予定」の枠で、開始の見込み、終了の見込み、理由の区分を入れて「予告を出す」を押す(日本時間)。3 日を切るときは、枠に注意が出るが入れられる。入れたら、トップページ(ログインしていない状態)を開き、ヘッダーの上に帯が出ることを確かめる。ほかの接続先(isolate)に届くまで最大 1 分かかる。予告は、終了の見込みを過ぎると帯が消える。取り消すときは「予告を消す」を押す。

#### 2. 切り替える

**`release` の反映の途中では切り替えない。** 反映のスクリプトは、Workers Builds の中で、記録、migration、deploy、確認の順に動く。secret を変えると、Worker の新しい version がすぐに deploy されるので、反映の deploy と同時に走って競合する、または migration が終わる前の食い違った版が出ることがある。反映の後の確認も、メンテナンスの `503` を障害と見分けられず失敗する。切り替えの前に、Cloudflare の画面で Workers Builds の最新のビルドが終わっていること、反映の後の確認が成功したことを確かめる。リリース PR を merge してから確認が通るまでの間は、切り替えを待つ。

```sh
pnpm exec wrangler secret put MAINTENANCE
# 値に入力する(終わる見込みは UTC、理由は database / update / other)
# on;until=2026-12-01T03:00:00Z;reason=database
```

- 値は、`on` だけでもよい。その場合、ページは時刻と理由を出さず、`Retry-After` は 300 秒になる。
- 終わる見込みは、UTC の `YYYY-MM-DDTHH:MM:SSZ` だけを読む。日本時間で書かない(12:00 JST は `03:00:00Z`)。
- 読めない値も、止める値として働く。打ち間違えても、止まる。直すには、もう一度 `secret put` する。
- 止めないのは、secret が無いとき、空のとき、`off` のときだけ。**終えるには、secret を消すか、値を `off` だけにする。**`false`、`0`、`no`、`none`、`disabled` を置くと、読めない値として止まる。`off;until=…` のように `off` に続きがある値も、止まる。
- secret を変えると、Worker の新しい version がすぐに deploy される。build は要らない。

#### 3. 止まったことを確かめる

- `curl -s -D - -o /dev/null https://slide.community/my/slides` が、`503`、`Retry-After`(見込みまでの秒数。見込みが無ければ 300)、`X-Slide-Intended: maintenance`、`X-Slide-Maintenance: on;until=…` を返す。
- ブラウザで開くと、「メンテナンス中です」、終わる見込み(日本時間と UTC)、理由が出る。
- 規約、プライバシーポリシー、「外部への送信」、お問い合わせ、ヘルプ、`/robots.txt` は、止まっているあいだも開く。
- 見張りの Worker から Discord に「メンテナンスが始まりました」が 1 回届く(最大 5 分かかる。「ページが開けません」は届かない)。
- cron が止まっている: `wrangler tail` で、毎時 17 分に `scheduled_skipped_maintenance` の行が出る。
- Cloudflare の 5xx のアラート(`slide-5xx`)が、メンテナンス中の `503` を数えて、終えた直後に 1 回届くことがある。想定どおりで、対処は要らない(メンテナンスの `503` と、障害の `503` を、Monitors は見分けられない。[Monitors のアラート 3 つ](alerts-runbook.md#monitors-のアラート-3-つ))。

#### 4. 運営が確かめる(運営の入口)

止まっているあいだも、運営は管理 origin の画面を開ける。Cloudflare Access を通れる状態で、運営の画面と同じ origin の `/maintenance/entrance`(たとえば `https://<運営 origin>/maintenance/entrance`)を開く。

1. Access を通っていれば、管理 origin の `/maintenance/enter?t=…` へ送られ、すぐトップページに移る。ブラウザに、1 時間だけ効く Cookie `__Host-slide_maintenance_pass` が付く。
2. その後、管理 origin のすべての画面が、止まっていないときと同じに開く。ログインは別で、作者の画面はログインが要る。
3. 開けないときは `503` のまま。Access を通っていない、`BETTER_AUTH_SECRET` が無い、Cookie の 1 時間が過ぎた、`MAINTENANCE` の値を書き換えた(Cookie を作ったときの値と違う)のどれかである。もう一度 `/maintenance/entrance` を開く。
4. 配信 origin(`slideusercontent.com`)は、入口を通っても開かない。スライドの中身は、メンテナンスが終わるまで見られない。

入口の仕組みと、残る危険は [メンテナンスの実装設計](maintenance.md#運営の入口) にある。

#### 5. 終える

```sh
pnpm exec wrangler secret delete MAINTENANCE
```

- 前のスキーマで動かすために、`wrangler rollback` で version を戻すときは、戻した時点で `MAINTENANCE` も外れる([D1 を復元する](#d1-を復元する) の手順 7)。
- 終えたら、トップページと `/my/slides` が開くこと、見張りの Worker から「メンテナンスが終わりました」が 1 回届くことを確かめる。
- 予告が残っていれば、終了の見込みまでは帯が出続ける。終えたのに帯が残るときは、運営の画面で「予告を消す」を押す。
- 終わる見込みを 30 分過ぎても `MAINTENANCE` が残っているときは、Discord に「メンテナンスが終わる見込みを過ぎています」が 1 回届く。長引くなら、secret の `until` を書き直す(入口の Cookie は作り直しになる)。

#### D1 を Time Travel で戻すときの順番

[D1 を復元する](#d1-を復元する) の手順と、この節の手順を、次の順に合わせる。

1. 予告を出す(急ぐときは省く)。
2. `MAINTENANCE` を、`on;until=…;reason=database` で切り替え、上の「止まったことを確かめる」を行う。**反映の途中ではないことを先に確かめる。**
3. [D1 を復元する](#d1-を復元する) の手順を、最後の手前まで行う。
4. 復元した D1 は、**復元した時点の予告の行に戻る**。止める前に予告を出していたなら、復元の後に、運営の画面(運営の入口を通る必要はない。運営 origin はメンテナンス中は `503` なので、メンテナンスを終えてから)の枠で、予告の有無を確かめる。復元した時点より後に入れた予告は消え、前に入れて消した予告は戻る。
5. 運営の入口を通って、管理 origin の画面で、復元した内容(deployment の件数、スライドの一覧)を確かめる。
6. 終える(上の「5. 終える」、または `wrangler rollback`)。

#### ヘルプの記事の材料

ヘルプの「メンテナンス中です、と出たとき」(安全と規約。`/help/safety/maintenance`)を書く作業 H2 に、利用者が知りたいこととして渡す。本文は、利用者向けの言葉で、実際の画面と同じ言葉にする。

| 知りたいこと | 答え |
| --- | --- |
| いまの画面は何か | 運営がサービスを止めている。メンテナンス中は、ページを開いても「メンテナンス中です」と出る |
| いつ終わるか | 画面に「(日時)ごろに終わる見込みです」と出る(日本時間と UTC)。出ていないときは、見込みを決めていない。見込みは延びることがある |
| なぜ止まっているか | 画面に理由が出る(データベースの保守、サービスの更新、その他) |
| 止まっているあいだに読めるもの | ヘルプ、利用規約、プライバシーポリシー、「外部への送信」、お問い合わせ |
| 置いたスライドは | 消えない。止まっているあいだは置けない。終わってからやり直す(アップロード中だったものも、終わってからもう一度) |
| 一度開いたスライドは | 通信が切れても保存した版で読めることがある(「保存した版を表示しています」。[通信が切れても読める](../features/f37-offline-reading.md))。保存していないスライドは読めない |
| 前もって知れるか | 予定が決まっているときは、全ページの上の帯に「(日時)から(日時)まで、メンテナンスのためサービスを止めます。」と出る |
| 帯が出ているが使えるか | 帯は予告で、開始まではふつうに使える。終了の見込みを過ぎると帯は消える |
| 困ったら | お問い合わせへ |

記事に書かないこと: 運営の入口、secret、Cookie、運営のログ。数字は、`Retry-After` や 1 時間などの内部の値を書かない。

### 登録を開く(作業 R)

設計と手順は [招待なしで登録できるようにする実装設計](f42-open-signup.md) にある。招待制を外すかどうかは、依頼者が決める。第四スコープの反映の順番には入っていない。本番では、2026-11-27 に外した。値は secret `OPEN_SIGNUP` で、依頼者が `wrangler secret put` で入れ、`wrangler secret delete` で戻す。外す前に済ませること(Turnstile、通知、停止の手順、規約、仮の数)は、[外す前に確かめること](f42-open-signup.md#外す前に確かめること)に、外し方と戻し方は [外し方と戻し方](f42-open-signup.md#外し方と戻し方)に、荒らしが来たときの手順は [荒らしが来たとき、最初にすること](f42-open-signup.md#荒らしが来たとき最初にすること)にある。

**無いときの動き(D-08)。** `OPEN_SIGNUP` が無い、または `on` 以外のときは、招待制のままである。`NEW_AUTHOR_LIMITS` が無いときは、設計の既定の値で動く。`LOGIN_CODE_LIMITS` の `total` が無いときは、ログインのメールの全体の上限は無効である(F42-AC29。同じアドレス・同じ接続元の上限は効く)。有効にする手順は[有効にする手順](f42-open-signup.md#有効にする手順)にある。

### 保存した版(作業 O)

設計は [通信が切れても読める実装設計](f37-offline-reading.md) にある。依頼者が行うのは、実機の iOS の Safari(と、Chrome、Firefox の実機)で、通信を切って、同じ URL が出て、帯が出ることの確認である([人の確認](f37-offline-reading.md#人の確認))。設定も、secret も、binding も要らない。

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
| `0060_community_notifications.sql` | 表 `notifications` の全行(種類 `community_published` と列 `community_id` を足すため、表を消して作り直す。依頼者の了承あり、2026-11-26) | なし(行は引き継がない)。お知らせは空になり、これからの出来事から届く。受信設定 `notification_opt_outs` は残る。前の version の Worker は、新しい列を使わないので、この表でも動く |

注意:

- `decks.owner_user_id`、`accounts.user_id`、`follows`、`mutes`、`suspensions` など、利用者の識別子を持つ列は、GitHub の利用者番号から利用者の id(Better Auth の `auth_user.id`)に意味が変わった。migration はその列の値を変換しない。だから、本番の D1 と R2 を空にしてから反映する(上の手順 1)。空にせずに反映すると、古い GitHub の番号が利用者の id として残り、だれのものでもない行になる。
- 0037・0038・0047 は、前のスコープの Worker が読む表や列を消す。適用してから新しい Worker を deploy するまでの間、前の Worker は 500 を返しうる。第二スコープの反映は、本番を空にして入れ直す手順(上の手順 1)の中で行い、反映の後に前のスコープの Worker へは戻さない(`wrangler rollback` で第二スコープより前の version に戻さない)。
- `src/db/destructive-migrations.test.ts` が、0036 以降で表・列・行を消す文を数え、この一覧と合っていることを確かめる。消す文を足したら、テストとこの表を同時に直す。
- 適用後のスキーマに、GitHub の利用者番号を前提にした列と、お知らせの種類 `github_followee_joined` の値が残らないことは、`src/db/email-login-migration.test.ts`(F28-AC32、F28-AC28)が確かめる。
- 本番を空にする操作は、D1 と R2 の両方が対象である。実行は依頼者が行う([メールのコードでログインする実装設計](f28-email-login.md#本番に反映する前に依頼者が行うこと))。

### Better Auth への切替で使った `0012`

Better Auth への切替で使う `0012` は、旧 `owner_sessions` の行を消し、表は残す。migration の適用後も、まだ稼働している旧 Worker は再ログイン・認証参照・ログアウトを実行できる。新 Worker は旧表を認証に使わない。切戻し期間が終わるまで旧表を保持し、削除は後続の migration に分ける。旧表の削除をこの手順に追加しない。

### 第二スコープより前の Worker への切戻し

`0012` 適用後に Better Auth 導入前の Worker へ切り戻す場合、切戻し前に新旧の認証 session と OAuth state を失効させる。以前の cookie や途中の認可要求を再び使わせないため。

```sh
pnpm exec wrangler d1 execute slide --remote --command "DELETE FROM auth_session; DELETE FROM auth_verification; DELETE FROM owner_sessions"
pnpm exec wrangler rollback <pre-Better-Auth-version-ID>
```

切戻し後は旧 Worker のログイン・ログアウトと既存資料の操作を確認する。cookie の形式が異なるため再ログインする(第二スコープより前の Worker に戻す場合は、GitHub でのログインになる)。`0012` の認証テーブルは残してよく、スライド・所有者 ID・固定 handle を戻す必要はない。
