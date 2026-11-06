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

`pnpm deploy` は Cloudflare Workers へデプロイする。初期設定と migration は、[アップロードの配置先と残りの作業](f01-local-slice.md#配置先と残りの作業)を参照する。

## コンポーネントを調べる

コンポーネントの API とフレームワークの仕様は `bf` CLI で調べる。コマンド一覧は `pnpm exec bf --help` で確認する。

| コマンド | 用途 |
| --- | --- |
| `pnpm exec bf search <term>` | コンポーネントを検索する |
| `pnpm exec bf add <component>` | コンポーネントを追加する |
| `pnpm exec bf docs <component>` | コンポーネントの API を読む |
| `pnpm exec bf debug graph <component>` | `"use client"` コンポーネントの signal の依存関係を調べる |
| `pnpm exec bf guide` | フレームワークのガイドを読む |

`vite build` が生成する `dist/` と `public/components/` は直接編集せず、ソースを変更して再生成する。

## D1 のクエリとスキーマを変更する

D1 へのアクセスには [Drizzle ORM の D1 driver](https://orm.drizzle.team/docs/connect-cloudflare-d1) を使う。テーブル定義は `src/db/schema.ts` に置き、行の型は `$inferSelect` から導出する。保存データは `drizzle-zod` の `createSelectSchema` で同じ定義から検証スキーマを導出し、読み取り時に解析する。API ではリクエストの `env.DB` を `drizzle()` に渡す。

スキーマを変更するときは、テーブル定義を更新し、`pnpm exec wrangler d1 migrations create slide <name>` で追加した SQL に同じ変更を書く。migration は引き続き `migrations/` で管理し、Wrangler で適用する。既存の `0001_uploads.sql` と適用履歴は変更しない。今回の ORM 移行ではテーブル構造の変更や追加 migration は不要。

容量制限を伴う作成、受信 lease の取得、ファイル確定、finalize は、条件を SQL 内に含めて更新する。条件の確認を事前の SELECT に分けると、同時リクエストによって制限を超える可能性がある。

`src/uploads/api.test.ts` は既存 migration を隔離したローカル D1 に適用して、新規作成、再送による credential 更新とファイル一覧の修復、容量・同時セッション・開始回数の制限、不正な保存データの拒否を検証する。OIDC 検証だけを置き換え、D1 のクエリは実行する。ファイル受信から配信までは、[ローカルのアップロード確認](f01-local-slice.md#ローカルで確認する)も実行する。

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

`pnpm format` で oxfmt による整形を行う。生成物とドキュメントは整形対象から除外している。ブラウザ回帰テストには Chromium が必要で、CI は `pnpm exec playwright install --with-deps chromium` で実行環境を用意する。

`cccc` は [moznion/cccc](https://github.com/moznion/cccc) の v1.8.6 を使用する。設定は `cccc.toml` にまとめ、TypeScript・JavaScript・Python の関数単位で Cognitive Complexity が15を超えると CI を失敗させる。テストも計測対象とし、依存・生成物は Git の除外設定と明示設定で対象外にする。ファイル全体の合計や関数外の処理には、この閾値を適用しない。
