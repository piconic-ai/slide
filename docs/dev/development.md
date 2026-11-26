# 開発する

[BarefootJS](https://barefootjs.dev) と Hono を使い、Cloudflare Workers で動かす。HTML は JSX でサーバーレンダリングし、クライアント側を hydration する。

## ローカルで起動する

CI と同じ Node.js 24・pnpm 12.16.1 を使用する。

```sh
pnpm install
pnpm dev
```

アップロードの D1・R2 を含む確認手順は、[アップロードを試す](f01-local-slice.md#ローカルで確認する)を参照する。

## ビルド・デプロイする

```sh
pnpm build
pnpm run deploy
```

`pnpm run deploy` は Cloudflare Workers へデプロイする(`pnpm deploy` は pnpm 自身の別のコマンドなので、`run` を付ける)。migration を含む変更の順序、反映後の確認、分担は [本番に反映する](deploy.md) を参照する。

## コンポーネントを調べる

コンポーネントの API とフレームワークの仕様は `bf` CLI で調べる。コマンド一覧は `pnpm exec bf --help` で確認する。

| コマンド | 用途 |
| --- | --- |
| `pnpm exec bf search <term>` | コンポーネントを検索する |
| `pnpm exec bf add <component>` | コンポーネントを追加する |
| `pnpm exec bf docs <component>` | コンポーネントの API を読む |
| `pnpm exec bf debug graph <component>` | `"use client"` コンポーネントの signal の依存関係を調べる |
| `pnpm exec bf guide` | フレームワークのガイドを読む |

`vite build` が生成する `dist/`、`public/components/`(ページ間を移る router の入口 `public/components/assets/router.js` を含む。元は `src/site/router-entry.ts`)、`public/index.html`、`public/_home/` と、`vite build -c vite.drop.config.ts` が生成する `public/drop-core.js`(ドロップ枠の判断の処理。元は `src/drops/`)は直接編集せず、ソースを変更して再生成する。`pnpm build` は両方を実行する。ドロップ枠のブラウザのテスト(`src/drops/drop.browser.test.ts`)も、生成済みのファイルを読むので、`pnpm build` の後に実行する。トップページのテスト（`src/site/home-routes.test.ts` と `src/site/home.browser.test.ts`）は生成済みのトップページ(日本語は `public/index.html`、英語は `public/_home/en/index.html`)を読むので、`pnpm build` の後に実行する。トップページは生成時のスクリプト名(ハッシュ付き)を参照するので、`vite build` のたびにトップページも書き直す。`pnpm dev` の起動中にトップページの説明を変えたときは、`pnpm build` で生成し直す。

## D1 のクエリとスキーマを変更する

D1 へのアクセスには [Drizzle ORM の D1 driver](https://orm.drizzle.team/docs/connect-cloudflare-d1) を使う。テーブル定義は `src/db/schema.ts` に置き、行の型は `$inferSelect` から導出する。保存データは `drizzle-zod` の `createSelectSchema` で同じ定義から検証スキーマを導出し、読み取り時に解析する。API ではリクエストの `env.DB` を `drizzle()` に渡す。

スキーマを変更するときは、テーブル定義を更新し、`pnpm exec wrangler d1 migrations create slide <name>` で追加した SQL に同じ変更を書く。migration は引き続き `migrations/` で管理し、Wrangler で適用する。適用済みの migration と適用履歴は変更しない。SQLite の CHECK 制約を変えるときは、`0002_session_states.sql` のように `PRAGMA defer_foreign_keys` の中でテーブルを作り直す。`decks` と `deployments` は互いを外部キーで参照するので、どちらかを作り直すときも同じ PRAGMA の中で行う。

容量制限を伴う作成、受信 lease の取得、ファイル確定、finalize は、条件を SQL 内に含めて更新する。条件の確認を事前の SELECT に分けると、同時リクエストによって制限を超える可能性がある。

`src/db/test-migrations.ts` が `migrations/` を順に適用する。`src/db/deployment-source-migration.test.ts` は、空の D1 に最初から最後まで適用できることも確かめる。`src/db/github-removal-migration.test.ts` は、適用後のスキーマに、リポジトリの連携の表と、リポジトリに従う公開のための列がないことを確かめる。`src/db/migrations.test.ts` は旧スキーマのデータが移行後も残ることを確認する。`src/db/destructive-migrations.test.ts` は、0036 以降でデータを消す migration を数え、[本番に反映する](deploy.md#データを消す-migration00360043)の一覧と合わせる。`src/site/no-email-leak.test.ts` は、設定と運営の招待の一覧のほかのどのページ・API・MCP の応答にも、メールアドレスとその MD5・SHA-256 が出ないことを確かめる。`src/site/integration-lang.test.ts` は、第二スコープの画面が日本語と英語の両方で出ることを確かめる。`src/uploads/api.test.ts` は全 migration を隔離したローカル D1 に適用して、新規作成、再送による credential 更新とファイル一覧の修復、容量・同時セッション・開始回数の制限、不正な保存データの拒否を検証する。作者の session は、メールのコードでの実際のログイン(コードは送信箱から読む)で作り、D1 のクエリは実行する。ファイル受信から配信までは、[ローカルのアップロード確認](f01-local-slice.md#ローカルで確認する)も実行する。

テストの通常の fixture・更新・件数確認も、`src/db/schema.ts` を参照する Drizzle の query builder を使う。旧スキーマへの投入、PRAGMA・SQLite のメタ情報、型では表せない不正データの投入には `sql` と `run/get/all` を使う。D1 の Proxy に残る `prepare`・`batch` は、競合や故障を注入するための driver の観測箇所である。

Drizzle 0.45.4 の D1 driver は、パラメーター付きの `SQLiteRaw` を `batch` に入れると `stmt.bind` の参照で失敗する。通常のクエリは型付き builder で batch にし、旧スキーマのパラメーター付き fixture は `run` で投入する。migration ヘルパーはパラメーターのないチェックイン済み SQL を `sql.raw` で渡し、ファイル単位の batch と原子性を維持する。ヘルパーは `;` で文を分けるので、migration のコメントに `;` を書かない(`CREATE TRIGGER ... END` の本体の `;` は、1 つの文として扱う)。値を文字列に埋め込んでこの制約を回避しない。`src/db/test-migrations.test.ts` が実 D1 で migration の範囲・順序・失敗時のロールバックと raw batch の制約を確認する。

## データベースを変えたら

[データベースの ER 図](er-diagram.md)は、`migrations/` から生成する。手で編集しない。

1. `pnpm exec wrangler d1 migrations create slide <name>` で migration を足す。
2. 新しい表は、`scripts/er-domains.mjs` の `DOMAINS` で、どの図に入れるかを決める。どの図にも入らない表があると、生成もテストも失敗する。
3. `pnpm db:er` で図を生成し直す。
4. 変わった `docs/dev/er-diagram.md` を、migration と同じ commit に入れる。

`pnpm db:er:check` は、commit 済みの図が migration から生成した結果と同じかを確かめる。違えば終了コード 1 で、直し方を示す。同じ確認を `scripts/er-generate.test.mjs` が行うので、図を生成し直し忘れると、CI の `pnpm test:coverage` が失敗する。図は、migration を空の SQLite(Node の `node:sqlite`)に順に適用して読むので、`src/db/schema.ts` の宣言とは独立している。

## 変更を確認する

作業中は、変更した動作を確かめるテストファイルを指定する。純粋関数のテストは依存をインストールした直後から実行できる。生成物を使うテストは先に `pnpm build` を実行し、ブラウザーテストには Chromium を用意する。

| 変更・確認したい動作 | ローカルでの実行例 |
| --- | --- |
| タイトルの取り出し | `pnpm test:pure src/uploads/title.pure.test.ts` |
| 保存ファイルの R2 配信 | `pnpm test src/preview/stored-file-store.test.ts` |
| トップページの一覧コンポーネントの構造 | `pnpm test src/site/home-list-components.test.ts` |
| トップページのブラウザー操作 | `pnpm test src/site/home.browser.test.ts` |
| ドキュメントの構成とリンク | `python3 scripts/check-docs.py` |

BarefootJS の IR テストは、コンポーネントの TSX をコンパイルし、読み込み中と取得後の各分岐にどの要素や属性があるかを確かめる。実際の API 応答で表示が切り替わること、ボタン操作、レイアウトはブラウザーで確かめる。

複数の worktree で同時に作業できるように、ローカルの既定の並列数は Vitest の起動1回につき、`pnpm test:pure` は最大2ワーカー、`pnpm test`・`test:non-pure`・`test:coverage` は最大1ワーカーとする。上限設定が入っていない worktree でも、たとえば `VITEST_MAX_WORKERS=1 pnpm test src/preview/stored-file-store.test.ts` でその実行を1ワーカーにできる。GitHub Actions はランナーごとに Vitest の既定の並列数を使う。

通常の Chromium 実行でブラウザーテストを複数指定すると、最初にブラウザーを必要とするファイルが Chromium を起動し、同じ Vitest 実行中のファイルがそれを共有する。テスト名の列挙だけなら Chromium は起動しない。テストファイルは個別に接続し、Cookie やストレージはブラウザーコンテキストごとに分離する。1ファイルだけを実行する場合と、Firefox・WebKit を指定した場合は各ファイルが直接ブラウザーを起動する。

PR の最新コミットの CI で全テストとカバレッジを確認する。全件実行時だけ起きる不具合やカバレッジ低下をローカルで調べるときは、次の手順で CI 相当の検査を再現できる。

```sh
pnpm format:check
pnpm build
pnpm exec tsc --noEmit
pnpm exec playwright install chromium
pnpm test:coverage
python3 scripts/check-docs.py
cccc .
```

`pnpm format` で oxfmt による整形を行う。生成物とドキュメントは整形対象から除外している。ブラウザ回帰テストには Chromium が必要で、CI は `pnpm exec playwright install --with-deps chromium` で実行環境を用意する。共有 URL の viewer のテストは、`pnpm exec playwright install webkit firefox` の後に `BROWSER=webkit pnpm exec vitest run src/share/viewer.browser.test.ts`（`firefox` も同様）で他の engine でも動かせる。プロフィール画像をブラウザで縮めるテスト(`src/profile/picture-auto.browser.test.ts`)も同じ方法で動かせる。CI は別の job で、両方の engine で、これらを動かす。

`pnpm test:coverage` は全テストを実行し、カバレッジを測る(`pnpm test` は測らずに実行する)。対象はリポジトリの TypeScript(`src/`、`components/` など)と `scripts/` の `.mjs` で、テストから読み込まれないファイルも 0% として数える。テスト、テスト用の補助、設定ファイル、生成物、子プロセスや手で動かす script(`upload.mjs`・`verify-upload.mjs`・`demo-citations.mjs`)を除く。ブラウザで動く `public/` の script は測らない。`vitest.config.ts` の `thresholds` は目標ではなく下限で、計測値のすぐ下に置く。変更によってこの値を下回ると CI が失敗する。

CI は純粋関数のテストを専用ジョブで実行する。残りのテストは Vitest の `--shard` で 6 組に分け、別々の runner で並列実行する。純粋テストのジョブではビルドと Chromium のインストールを省き、カバレッジ計測時の JSX 変換には他のジョブと同じ設定を使う。`Build, types and tests` は全 7 件の blob レポートがそろったことを確かめ、`--merge-reports` で統合して全体のカバレッジ下限を検査する。

- 下回ったときは、足した処理のテストを書く。変更を通すために下限を下げない。
- 処理を消した結果として割合が下がり、テストで補えないときは、下げる理由を PR に書いて下限を直す。
- カバレッジが 1 ポイント以上上がったら、下限も上げる。

下限は CI(Linux)の計測値から決める。2026-11-16 の CI の計測値は、statements 93.47%、branches 89.98%、functions 87.69%、lines 94.13%。macOS では分岐がいくつか違って数えられ、statements 93.51%、branches 90.1%、lines 94.17% になる。ファイルごとの値は `coverage/coverage-summary.json` に出る。

`cccc` は [moznion/cccc](https://github.com/moznion/cccc) の v1.8.6 を使用する。設定は `cccc.toml` にまとめ、TypeScript・JavaScript・Python の関数単位で Cognitive Complexity が15を超えると CI を失敗させる。テストも計測対象とし、依存・生成物は Git の除外設定と明示設定で対象外にする。ファイル全体の合計や関数外の処理には、この閾値を適用しない。

PR の変更がドキュメントだけ(`docs/`、ルート直下の `*.md`、`.agents/` の `*.md`)なら、テスト、ビルド、Firefox・WebKit の確認、Cognitive Complexity の検査を省く(`ci.yml` の `changes`)。`Build, types and tests` は、省いたことを示して成功する。テストが読む `docs/dev/er-diagram.md` と `docs/dev/deploy.md` を変えたときは、省かない。main への push では、いつもすべてを実行する。

PR に新しいコミットを push すると、同じ PR で前のコミットの CI が実行中なら、それを止めて新しいコミットで実行し直す(`ci.yml` の `concurrency`)。main の CI は止めない。本番に反映する前に、main の最新の CI の結果を確かめるためである。

## GitHub Actions の依存を変更する

action のタグは workflow に記載し、実行するコミットと推移依存は `.github/workflows/actions.lock` で固定する。workflow の追加や `uses:` の変更後は、認証済みの GitHub CLI で lockfile を生成し直す。

```sh
gh extension install github/gh-actions-lock --pin v0.4.1
gh actions-lock
gh actions-lock --verify
```

lockfile は手で編集せず、workflow と一緒にコミットする。CI の `Workflow lockfile` ジョブが全 workflow の依存と固定したコミットの出所を検証する。ネットワークなしで依存の記載漏れだけを確認する場合は `gh actions-lock --verify-local` を使う。

Dependabot が GitHub Actions の更新を毎週確認し、action のバージョンと対応する lockfile を同じ PR で更新する。lockfile の `commit` の変更をレビューし、`owner_id` や `repo_id` が変わる場合はリポジトリの移転などの理由を確認する。外部の reusable workflow を追加する場合、呼び出し先自体は lockfile の対象外なので `jobs.<job_id>.uses` を引き続き完全な SHA で固定する。

仕様と更新方法は [GitHub の workflow lockfile 導入手順](https://docs.github.com/en/actions/how-tos/secure-your-work/lock-workflow-dependencies)を参照する。
