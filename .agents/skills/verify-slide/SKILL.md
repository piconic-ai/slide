---
name: verify-slide
description: slide をローカルで起動し、読者または作者としてブラウザで操作して、変更が実際に動く根拠(スクリーンショット、応答、D1 の行)を残す。UI・配信・公開管理・アップロードを変えた PR を出す前、「動作確認して」「画面で確かめて」と言われたときに使う。本番は操作しない。
---

# slide を動かして確かめる

テストが通ることと、利用者の操作が通ることは別である。この skill は、ローカルの Worker・D1・R2 で実際の経路を通し、根拠を残す。コマンドはすべてリポジトリの root(自分の worktree)で実行する。

以下の `$STATE`(ローカルの D1・R2 の置き場)、`$EVIDENCE`(根拠の置き場)、`$COOKIE`(作者の cookie)は、自分で決めた値を指す。shell の変数はコマンドの実行をまたいで残らないので、コマンドごとに実際の値を書くか、同じコマンドの先頭で代入する。port の 8811 も例であり、空いている番号に読み替える。

## 起動する

依存とビルドを用意する(生成済みのトップページを読むため、ビルドが要る)。

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm exec playwright install chromium   # firefox・webkit で確かめるときは、その名前も並べる
```

ブラウザが入っていないと、`shot.mjs` と操作の script は `browserType.launch: Executable doesn't exist` で止まる。

port と状態の置き場を、自分専用に決めて起動する。ほかの worktree やセッションと同じ port・同じ置き場を使わない。置き場は、リポジトリの外の一時ディレクトリにする。

```sh
.agents/skills/verify-slide/launch.sh 8811 "$STATE"
```

この script は migration を適用してから `wrangler dev` を前面で動かすので、バックグラウンドで実行する。ログに `Ready on http://localhost:8811` が出たら使える。

データを入れる。作者の session で受け取りを始め、実際の経路(開始、ファイルごとの送信、確定)を通して、公開済みのスライドを 2 つ作り、作者の cookie を表示する。

```sh
SLIDE_DEMO_DECK=try-static SLIDE_PERSIST_TO="$STATE" \
  node scripts/demo-reactions.mjs examples/static http://localhost:8811
```

出力の `Owner cookie: __Host-slide_owner=...` の値を控える。作者は `kfly8`(`wrangler.jsonc` の `AUTHOR_GITHUB_IDS` に ID がある人)、スライドは `http://localhost:8811/@kfly8/try-static`、管理画面は `http://localhost:8811/slides/try-static` である。ローカルの D1 に直接作るのは、作者の session、スライドの行、公開の状態だけである。版(`deployments`、`upload_files`)は、受け取りの経路が作る。Worker に、認証を迂回する route は足さない。

自分のスライドに新しい版を足すときは、送り手を直接使う。`SLIDE_ID` は、作者が既に持っているスライドの URL の名前(slug)である。

```sh
SLIDE_ID=try-static SLIDE_OWNER_COOKIE="$COOKIE" \
  node scripts/upload.mjs examples/static http://localhost:8811
```

作者の session は 1 人に 1 つである。データを入れるコマンドや `scripts/verify-upload.mjs` をもう一度実行すると、前に表示した cookie は使えなくなる。新しく表示された値を使う。

## 状態を確かめる

何かおかしいときは、操作の前にまず確かめる。

```sh
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:8811/api/slides          # 401 なら起動している
curl -s -H "Cookie: $COOKIE" http://localhost:8811/auth/owner                       # {"userId":"722500",...} なら cookie が有効
```

401 以外が返る、または接続できないときは、port をほかのプロセスが使っていないか、起動のログを確かめる。cookie は 12 時間で切れる。切れたら、データを入れるコマンドをもう一度実行する。

## 操作する

1 ページを開いて撮るだけなら、同梱の script を使う。状態、題名、console のエラー、失敗した request を JSON で出す。

```sh
node .agents/skills/verify-slide/shot.mjs http://localhost:8811/@kfly8/try-static "$EVIDENCE/viewer.png"
node .agents/skills/verify-slide/shot.mjs http://localhost:8811/slides/try-static "$EVIDENCE/deck.png" "$COOKIE"
BROWSER=webkit node .agents/skills/verify-slide/shot.mjs ...    # firefox も同じ
```

クリックや入力を伴う操作は、Playwright の script を書く。作者として操作するときは `owner.mjs` の `signInAsOwner` で cookie を渡す。要素は、role と表示名で選ぶ。座標や要素の順番に頼らない。script は自分の worktree の中の一時ファイルに置き(`playwright` を解決するため)、commit しない。

```js
import { chromium } from 'playwright'
import { signInAsOwner } from './.agents/skills/verify-slide/owner.mjs'

const origin = 'http://localhost:8811'
const browser = await chromium.launch()
const context = await browser.newContext({ locale: 'ja-JP' })
await signInAsOwner(context, origin, process.env.COOKIE)
const page = await context.newPage()
await page.goto(`${origin}/slides/try-static`)
await page.getByRole('button', { name: '公開を停止する' }).click()
await page.waitForLoadState('networkidle')
await page.screenshot({ path: `${process.env.EVIDENCE}/stopped.png`, fullPage: true })
await browser.close()
```

フォームの送信を伴う作者の操作は、Chromium か Firefox で行う。WebKit は `http://localhost` の `__Host-` cookie を保存しないので、`signInAsOwner` は request ごとにヘッダーで送る方法に切り替える。この方法ではページを読めるが、フォームの送信には cookie が付かず、ログインの画面が返る。

画面の言語はブラウザの言語で決まり、engine によって既定が違う。表示名で要素を選ぶときは、context に `locale: 'ja-JP'`(英語を確かめるなら `en-US`)を指定する。`shot.mjs` は `ja-JP` で開く(`SLIDE_LOCALE` で変えられる)。

スライドの中身は `#deck` の iframe で、別の origin として扱われる。中を操作するときは `page.frameLocator('#deck')` を使う。

機能ごとの入口と、動いたと言える結果は [機能の対応表](features/README.md) にある。変えた機能の行を読み、そこにある入口をすべて通す。

## 根拠を残す

- 利用者と同じ経路を通す。内部の関数やテスト用の入口を呼んで済ませない。
- 操作と、その結果の状態の両方を残す。画面だけでなく、応答の状態、配信されたヘッダー、D1 の行も確かめる。

  ```sh
  pnpm exec wrangler d1 execute slide --local --persist-to "$STATE" --command "SELECT id, public_deployment_id, paused_at FROM decks"
  ```

- ブラウザが止める動作(CSP、sandbox、別 origin)は、JS の戻り値ではなく、外に出た request、開いたページの数、ダウンロードの有無で確かめる。
- 根拠は、状態の置き場とは別のディレクトリ(`$EVIDENCE`)に置く。片付けで消さない。
- PR の本文に、実行したコマンド、結果、確かめられなかったことを書く。確かめられなかったことを、確かめたように書かない。
- ローカルで確かめられないもの: GitHub の実際の認可画面、本番の domain と wildcard の配信、Cloudflare の cache。これらは「人の確認」として PR に残す。

## 片付ける

自分が起動したプロセスだけを止める(バックグラウンドの task を止める、または `launch.sh` の PID を kill する)。プロセス名で kill しない。そのあと `$STATE` を消す。`$EVIDENCE` は残す。

## 同梱の script

| script | 使い方 |
| --- | --- |
| `launch.sh <port> <state>` | migration を適用し、その port と置き場で Worker を起動する |
| `owner.mjs` | `signInAsOwner(context, origin, cookie)`。Playwright の context を作者としてログインさせる |
| `shot.mjs <url> <png> [cookie]` | 1 ページを開いて撮り、状態・題名・エラーを出す。`BROWSER` で engine を選ぶ |

リポジトリの `scripts/` にあるもの。

| script | 使い方 |
| --- | --- |
| `demo-reactions.mjs <built deck> [origin]` | 公開済みのスライドを 2 つ作り、作者の cookie を表示する。`SLIDE_PERSIST_TO` に状態の置き場、`SLIDE_DEMO_DECK` に 1 つ目の slug を渡す |
| `upload.mjs <directory> [origin]` | 作者の cookie(`SLIDE_OWNER_COOKIE`)で、自分のスライド(`SLIDE_ID`)に新しい版を送る |
| `verify-upload.mjs [origin]` | 受け取りの経路を、実際の HTTP・D1・R2 で確かめる。`SLIDE_PERSIST_TO` に状態の置き場を渡す |
