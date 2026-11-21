# 設計の決まり

[開発方針](../../AGENTS.md)の「純粋関数を優先する」「純粋な処理と副作用を、ファイルで見分けられるようにする」を、層とテストの決まりとして具体化する。ここには、変わりにくい決まりだけを書く。機能ごとの設計は `docs/dev/fNN-*.md`、作業の計画と進み具合は issue に置く。

## 層

機能ごとのディレクトリ(`src/decks/`、`src/share/` など)の中で、ファイル名が層を表す。層は、そのファイルが外の世界の何に触れてよいかを決める。

アプリ全体の入口は `src/app/` にある。`routes.tsx` が経路を組み立て(Hono の app)、`worker-routes.ts` が Worker の入口(`wrangler.jsonc` の `main`。名前付き entrypoint もここ)、`renderer-page.tsx` が共通のレイアウトを持つ。どれも、ファイル名が表す層(routes・pages)の決まりに従う。

| 層 | ファイル名 | 役割 | 使ってはいけないもの | 主なテスト |
| --- | --- | --- | --- | --- |
| 純粋 | 下のどれにも当たらない `.ts` | 検証、変換、方針の判断、状態の遷移、HTML の部品 | hono(`hono/html` を除く)、drizzle-orm、better-auth、`env`、D1・R2 の handle、`fetch`、現在時刻、乱数、store・client・routes の読み込み | Vitest の単体テスト |
| schema | `schema.ts`、`*-schema.ts` | D1 のテーブル定義と、そこから導く型・検証 | hono、better-auth、`env`、D1・R2 の handle、`fetch`、現在時刻、乱数、store・client・routes | migration のテスト |
| store | `store.ts`、`*-store.ts` | D1・R2 の読み書き。条件は SQL に含める | hono、`fetch`、client・pages・routes | ローカルの D1・R2 を通すテスト |
| client | `*-client.ts` | 外部サービスとの通信と、応答の解析 | hono、drizzle-orm、`env`、D1・R2 の handle、store・pages・routes | 通信だけを置き換えたテスト |
| pages | `pages.ts`、`*-pages.ts`、`*-page.ts(x)` | HTML を組み立てる。値はエスケープする | drizzle-orm、better-auth、`env`、D1・R2 の handle、現在時刻、乱数、store・client・routes | 出力の HTML を確かめるテスト |
| routes | `routes.ts`、`*-routes.ts`、`api.ts`、`*-api.ts`、`middleware.ts`、`*-middleware.ts` | HTTP の入口。入力を解析し、純粋な処理・store・client・pages をつなぐ | (制限なし) | ローカルの HTTP・D1・R2 を通すテスト、Playwright |

依存の向きは、routes → {pages, store, client} → 純粋 の一方向にする。pages・store・client は互いを読み込まず、routes を読み込まない(同じ層どうしは読み込んでよい)。純粋な処理と schema は、store・client・routes を読み込まない。HTML の部品は、名前が純粋でも pages でも、互いに読み込んでよい。型だけの読み込み(`import type`、`import { type A }`)は、依存に数えない。

純粋な処理と pages は、時刻と乱数を自分で取得しない。境界(routes、store、client)が取得して、引数で渡す。純粋な処理が「いま」を必要とするなら、`now` を引数に取る。`new Date(value)` のように、渡された値から日付を作ることは構わない。

### 検査

`scripts/layers.mjs` が、ファイル名から層を決め、その層が使ってはいけないものを探す。読み込みは TypeScript の parser で `import` と `export ... from` の宣言を読み取る。それ以外(`env`、`fetch`、時刻、乱数、D1・R2 の handle)は、宣言とコメントを除いた本文から、文字列の照合で探す。`scripts/layers.test.mjs` が `src/` の全ファイルを調べ、決まりに反するファイルがあると失敗する。`pnpm test` と、CI の `pnpm test:coverage` の中で動く。

本文の検査は文字列の照合で、網の目は粗い。検査が通ることは、決まりを守っていることの証明にはならない。次のことは、レビューで確かめる。

- 見つけられないもの: 別名で読み込んだ関数、動的な `import()`、`globalThis.fetch`、ライブラリの中で起きる通信。
- 誤って見つけるもの: 文字列や HTML のテンプレートの中に書いた `fetch(` や `env.NAME`。
- 名前による抜け道: `*-routes.ts` と名付けたファイルは、何も検査されない。routes は「つなぐだけ」に保ち、判断や変換を書き込んでいないかを見る。
- 対象は `src/` だけである。`components/` は調べない。

### 既知の例外

名前は純粋を表すのに、外の世界に触れているファイルが 10 ある(`src/auth/config.ts`、`src/preview/content.ts` など)。一覧は `scripts/layers.test.mjs` の `KNOWN` にあり、ファイルごとに、何に触れているかを記録している。

- 一覧は減らすだけにする。新しいファイルを足さない。新しいファイルには、層を表す名前を付ける。
- 例外のファイルを変えるときは、純粋な部分を別のファイルに取り出すか、層を表す名前に変えて、一覧から消す。
- 例外のファイルが触れるものを増やしても、減らしても、テストは失敗する。記録を実際に合わせる。

## 状態は型で表す

持つデータが違う状態は、判別可能な union で表す。独立したフラグや省略可能なフィールドを並べると、実際にはありえない組み合わせを型が許してしまう。

```ts
// 悪い例: 4 つのフィールドの組み合わせの多くは、ありえない
interface Publication {
  published: boolean
  paused: boolean
  deploymentId?: string
  resumeDeploymentId?: string
}

// 良い例: ありうる状態だけを並べる
type Publication =
  | { kind: 'draft' }
  | { kind: 'public'; deploymentId: string }
  | { kind: 'paused'; resumeTo: string | null }
```

公開の状態は、実際にこの形で持っている(`src/publication/state.ts`)。遷移は、状態と操作を受け取って次の状態を返す純粋な関数にする(`src/publication/transitions.ts`)。`switch` には `default` を書かず、関数の戻り値の型を明示する。状態や操作を足すと、未対応の分岐で値を返さない経路ができ、コンパイルエラーになる。

状態や操作を足すときの手順は、union に 1 つ足す → コンパイルエラーが未対応の箇所を示す → 例を 1 件テストに足す、の 3 つで済むようにする。

## 境界で解析する

リクエスト、外部からの応答、設定(`env`)、保存済みのデータは、信頼できない入力として扱う。routes・client・store が zod のスキーマでドメインの型に解析し、純粋な処理には解析済みの値だけを渡す。純粋な処理の中で、同じ検証を繰り返さない。行の型と検証スキーマは、テーブル定義から導く([D1 のクエリとスキーマを変更する](development.md#d1-のクエリとスキーマを変更する))。

## テストの書き方

自動テストに最大限投資する。人の手による確認は、AI が自分で進められる範囲を狭めるので、最小限にする。

- **Given-When-Then**: テスト名に、前提・操作・期待する結果を書く。実装の詳細ではなく、外から観測できる結果を検証する。
- **意地悪な入力**: 純粋な処理を足す、または変えるときは、典型的な入力に加えて、空の値、境界値、不正な形式、HTML や script を含む文字列、絵文字やサロゲートペア、矛盾した状態を確かめる。1 つずつ差し替えて、落ちないことと、不変条件を満たすことを見る。
- **組み合わせ**: 独立した軸が 3 つ以上からむ判断(公開の状態 × 操作 × 操作する人など)は、`it.each` で表にする。状態と操作の組み合わせが数十に収まるなら、すべてを並べ、必ず有効な結果を返すことを確かめる。
- **実物を通す**: store と routes は、モックではなく、ローカルの D1・R2 と実際の HTTP で確かめる。置き換えるのは、外部サービスとの通信だけにする。モックで成功させた結果を、連携が動く根拠にしない。
- **ブラウザが決めること**: CSP、sandbox、別 origin、cookie の扱いは、Playwright で確かめる。JS の戻り値ではなく、外に出た request、開いたページの数、ダウンロードの有無で判定する。viewer は Chromium・Firefox・WebKit で確かめる。
- **不具合の回帰**: 報告された不具合は、直す前に失敗するテストで再現する。同じ判断を共有する近くの入力も確かめる。

カバレッジと複雑度の基準は [変更を確認する](development.md#変更を確認する) にある。

## 人の確認が要るもの

次のものは、ローカルでは確かめられない。PR に「人の確認」として残し、確かめたように書かない。

- GitHub の実際の認可画面。
- 本番の domain、wildcard の配信、Cloudflare の cache。
- 実機のスマートフォンでの操作。
- 文言とデザインの良し悪し。
