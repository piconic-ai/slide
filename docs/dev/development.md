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
pnpm deploy
```

`pnpm deploy` は Cloudflare Workers へデプロイする。migration を含む変更の順序、反映後の確認、分担は [本番に反映する](deploy.md) を参照する。

## コンポーネントを調べる

コンポーネントの API とフレームワークの仕様は `bf` CLI で調べる。コマンド一覧は `pnpm exec bf --help` で確認する。

| コマンド | 用途 |
| --- | --- |
| `pnpm exec bf search <term>` | コンポーネントを検索する |
| `pnpm exec bf add <component>` | コンポーネントを追加する |
| `pnpm exec bf docs <component>` | コンポーネントの API を読む |
| `pnpm exec bf debug graph <component>` | `"use client"` コンポーネントの signal の依存関係を調べる |
| `pnpm exec bf guide` | フレームワークのガイドを読む |

`vite build` が生成する `dist/` と `public/components/`、`scripts/build-home.mjs` が生成する `public/index.html` は直接編集せず、ソースを変更して再生成する。トップページのテスト（`src/site/home-routes.test.ts` と `src/site/home.browser.test.ts`）は生成済みの `public/index.html` を読むので、`pnpm build` の後に実行する。`pnpm dev` の起動中にトップページの説明を変えたときは、`node scripts/build-home.mjs` で生成し直す。

## D1 のクエリとスキーマを変更する

D1 へのアクセスには [Drizzle ORM の D1 driver](https://orm.drizzle.team/docs/connect-cloudflare-d1) を使う。テーブル定義は `src/db/schema.ts` に置き、行の型は `$inferSelect` から導出する。保存データは `drizzle-zod` の `createSelectSchema` で同じ定義から検証スキーマを導出し、読み取り時に解析する。API ではリクエストの `env.DB` を `drizzle()` に渡す。

スキーマを変更するときは、テーブル定義を更新し、`pnpm exec wrangler d1 migrations create slide <name>` で追加した SQL に同じ変更を書く。migration は引き続き `migrations/` で管理し、Wrangler で適用する。適用済みの migration と適用履歴は変更しない。SQLite の CHECK 制約を変えるときは、`0002_session_states.sql` のように `PRAGMA defer_foreign_keys` の中でテーブルを作り直す。`decks` と `deployments` は互いを外部キーで参照するので、どちらかを作り直すときも同じ PRAGMA の中で行う。

容量制限を伴う作成、受信 lease の取得、ファイル確定、finalize は、条件を SQL 内に含めて更新する。条件の確認を事前の SELECT に分けると、同時リクエストによって制限を超える可能性がある。

`src/db/test-migrations.ts` が `migrations/` を順に適用する。`src/db/migrations.test.ts` は旧スキーマのデータが移行後も残ることを確認する。`src/uploads/api.test.ts` は全 migration を隔離したローカル D1 に適用して、新規作成、再送による credential 更新とファイル一覧の修復、容量・同時セッション・開始回数の制限、不正な保存データの拒否を検証する。OIDC 検証だけを置き換え、D1 のクエリは実行する。ファイル受信から配信までは、[ローカルのアップロード確認](f01-local-slice.md#ローカルで確認する)も実行する。

テストの通常の fixture・更新・件数確認も、`src/db/schema.ts` を参照する Drizzle の query builder を使う。旧スキーマへの投入、PRAGMA・SQLite のメタ情報、型では表せない不正データの投入には `sql` と `run/get/all` を使う。D1 の Proxy に残る `prepare`・`batch` は、競合や故障を注入するための driver の観測箇所である。

Drizzle 0.45.4 の D1 driver は、パラメーター付きの `SQLiteRaw` を `batch` に入れると `stmt.bind` の参照で失敗する。通常のクエリは型付き builder で batch にし、旧スキーマのパラメーター付き fixture は `run` で投入する。migration ヘルパーはパラメーターのないチェックイン済み SQL を `sql.raw` で渡し、ファイル単位の batch と原子性を維持する。値を文字列に埋め込んでこの制約を回避しない。`src/db/test-migrations.test.ts` が実 D1 で migration の範囲・順序・失敗時のロールバックと raw batch の制約を確認する。

## 変更を確認する

```sh
pnpm format:check
pnpm build
pnpm exec tsc --noEmit
pnpm exec playwright install chromium
pnpm test
python3 scripts/check-docs.py
cccc .
```

`pnpm format` で oxfmt による整形を行う。生成物とドキュメントは整形対象から除外している。ブラウザ回帰テストには Chromium が必要で、CI は `pnpm exec playwright install --with-deps chromium` で実行環境を用意する。共有 URL の viewer のテストは、`pnpm exec playwright install webkit firefox` の後に `BROWSER=webkit pnpm exec vitest run src/share/viewer.browser.test.ts`（`firefox` も同様）で他の engine でも動かせる。CI は別の job で両方を動かす。

`cccc` は [moznion/cccc](https://github.com/moznion/cccc) の v1.8.6 を使用する。設定は `cccc.toml` にまとめ、TypeScript・JavaScript・Python の関数単位で Cognitive Complexity が15を超えると CI を失敗させる。テストも計測対象とし、依存・生成物は Git の除外設定と明示設定で対象外にする。ファイル全体の合計や関数外の処理には、この閾値を適用しない。

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
