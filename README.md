# slide

A [BarefootJS](https://barefootjs.dev) app scaffolded with the **Hono (Cloudflare Workers, JSX SSR + hydration)** adapter.

[日本語の設計ドキュメント](docs/index.md)に、機能ごとの利用場面、実装範囲と順序を示すストーリーマップ、技術設計をまとめています。

## Getting started

```sh
pnpm install
pnpm dev
```

## Build & deploy

```sh
pnpm build
pnpm deploy   # deploy to Cloudflare Workers
```

## `bf` CLI cheat sheet

The `bf` CLI is the first reference for component APIs and framework docs — run `bf --help` for the full command list.

| Command | What it does |
| --- | --- |
| `bf search <term>` | Search the component registry |
| `bf add <component>` | Add a component from the registry |
| `bf docs <component>` | Show a component's API surface |
| `bf debug graph <component>` | Inspect a `"use client"` component's reactive signal graph |
| `bf guide` | Open the framework guide |

## Generated output

The compiled output directory (produced by `vite build`) is regenerated on every build — don't edit it by hand.

## 開発チェック

```sh
python3 scripts/check-docs.py
cccc .
```

`cccc` は [moznion/cccc](https://github.com/moznion/cccc) の v1.8.6 を使用します。設定は `cccc.toml` にまとめ、TypeScript・JavaScript・Python の関数単位で Cognitive Complexity が15を超えると CI を失敗させます。テストも計測対象です。依存・生成物は Git の除外設定と明示設定で対象外にします。ファイル全体の合計や関数外の処理には、この関数単位の閾値を適用しません。
