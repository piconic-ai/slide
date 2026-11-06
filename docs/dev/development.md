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
