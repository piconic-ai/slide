# slide

A [BarefootJS](https://barefootjs.dev) app scaffolded with the **Hono (Cloudflare Workers, JSX SSR + hydration)** adapter.

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
