---
name: dev-loop
description: slide の機能開発を、issue を 1 件選ぶところから、実装、検証、PR、レビュー対応、merge、deploy、記録まで 1 周させる。「ループを回して」「次の issue を進めて」「#NNN を実装して」と言われたときに使う。仕様に未決事項があるところは作らず、相談に回す。
---

# 開発を 1 周させる

1 周は、issue 1 件を、根拠の付いた PR にして、本番に反映し、記録するまでである。下の順に進める。各段の「次へ進む条件」を満たすまで、次の段に進まない。

読むもの(最初に 1 度): [開発方針](../../../AGENTS.md)、[設計の決まり](../../../docs/dev/architecture.md)、[仕様と issue の決まり](../../../docs/dev/planning.md)、[開発手順](../../../docs/dev/development.md)。

## 止まる条件

次のどれかに当たったら、その issue の作業を止め、依頼者に知らせて、次の独立した issue に進む。推測で先へ進めない。

- 仕様の「未決事項」に関わる。または、仕様に書かれていない判断が要る。→ `discuss-feature` skill で相談する。
- 受け入れ条件を満たすには、仕様の「作らないこと」に反する必要がある。
- secret、GitHub App の設定、DNS、課金など、依頼者しか行えない操作が要る。
- 同じ判断への指摘が 3 回続いた。→ 個別に直すのをやめ、やり方を変える。変えたことを PR に書く。それでも続くなら止める。
- データが消える migration(表や列の削除、行の削除)を、本番に適用する直前。

## 1. 選ぶ

```sh
gh issue list --state open --limit 50
```

- 依頼者が番号を指定したら、それを選ぶ。
- 指定がなければ、[ストーリーマップ](../../../docs/story-mapping.canvas)の scope が小さい機能の issue から選ぶ。「未決事項」が空で、ほかの開いている PR と同じファイルを触らないものにする。
- 選んだ issue の本文とコメントを、すべて読む(`gh issue view <番号> --comments`)。リンクされた仕様(`docs/features/fNN-*.md`)も、すべて読む。

**次へ進む条件**: 対象の受け入れ条件の ID(`F17-AC6` など)を列挙できる。それぞれについて、何を観測すれば満たしたと言えるかを 1 文で言える。言えない条件があれば、止まる条件に当たる。

## 2. 準備する

自分用の worktree を、最新の `origin/main` から作る。メインの checkout では git を操作しない。

```sh
git fetch origin
git worktree add -b <種別>/<短い名前> ../slide-<短い名前> origin/main
cd ../slide-<短い名前>
pnpm install --frozen-lockfile
pnpm build
```

- 1 つの PR は、1 つの要求を満たす大きさ(変更 400 行ほどまで)にする。大きいときは、受け入れ条件ごとに PR を分けて積む。
- `git stash` は使わない(worktree の間で共有される)。

## 3. 作る

受け入れ条件ごとに、次の順で進める。

1. 条件を確かめるテストを先に書き、失敗することを見る。テスト名に ID を入れる(`F17-AC6: Given ... When ... Then ...`)。
2. 層の決まりに従って実装する。判断と変換は純粋なファイルに、D1・R2 は `*store.ts` に、HTTP は `*routes.ts` に置く。新しいファイルには、層を表す名前を付ける。`scripts/layers.test.mjs` の `KNOWN` に行を足さない。
3. 典型的な入力に加えて、空の値、境界値、不正な形式、矛盾した状態のテストを書く。
4. D1 のスキーマを変えるときは、[D1 のクエリとスキーマを変更する](../../../docs/dev/development.md#d1-のクエリとスキーマを変更する)に従い、テーブル定義と migration の両方を書く。適用済みの migration は変えない。
5. 1 つの動作ごとに、テストと一緒に commit する。commit の文は英語で書く。

仕様の文と実装が食い違うことに気づいたら、実装を仕様に合わせる。仕様のほうが誤りだと考えるなら、止まる条件に当たる。

## 4. 確かめる

すべて通るまで、PR を ready にしない。

```sh
pnpm format:check
pnpm build
pnpm exec tsc --noEmit
pnpm test:coverage
python3 scripts/check-docs.py
```

- 失敗が今回の変更と無関係に見えるときは、`origin/main` で同じ失敗が起きることを確かめてから、そう書く。
- カバレッジが下限を下回ったら、テストを書く。下限を下げない。
- 画面、配信、公開の状態、アップロードを変えたときは、`verify-slide` skill で実際に動かし、スクリーンショットや応答を残す。[機能の対応表](../verify-slide/features/README.md)に入口が増えたら、同じ PR で表を直す。
- 仕様、設計、手順が変わったら、同じ PR で文書を直す。

**次へ進む条件**: 上のコマンドがすべて通り、受け入れ条件ごとに「何で確かめたか」を書ける。

## 5. PR を出して、仕上げる

1. push して、[テンプレート](../../../.github/pull_request_template.md)で draft の PR を作る。本文は日本語で書く。「満たした受け入れ条件」に ID と確かめた方法を、「確かめていないこと」「人の確認」に残りを書く。本文に `Refs #<issue>` を入れる。
2. 会話の文脈を持たない別の agent に、差分(`git diff origin/main...HEAD`)、`AGENTS.md`、PR の本文だけを渡してレビューさせる。壊れる入力や状態を具体的に挙げられた指摘だけを直す。
3. CI が通るのを待つ(`gh pr checks <PR> --watch`)。失敗したら、要約ではなくログを読む。
4. `gh pr ready <PR>` で ready にする。Pullfrog がレビューする。
5. Pullfrog のレビュー本文と、行へのコメントを読む(`gh api repos/piconic-ai/slide/pulls/<PR>/reviews`、`.../comments`)。`pullfrog` の check が緑でも、指摘が残っていることがある。
6. 指摘ごとに、いまの head に当てはまるかを確かめ、再現してから直す。同じ種類の見落としがほかにないかも見る。直したら、スレッドに日本語で、直した commit と確かめた方法を返信する。**スレッドは resolve しない。**
7. push のたびに、CI と Pullfrog の両方が新しい head を見るまで待つ。

テストを弱めて通さない。失敗を理由なく再実行しない。

**次へ進む条件**(すべて、いまの head について): CI がすべて通っている。Pullfrog がこの head をレビューし、直すべき指摘が残っていない。conflict がない(`gh pr view <PR> --json mergeable,mergeStateStatus`)。差分を読み直し、issue の範囲に収まっている。

## 6. merge して、本番に反映する

開発中のあいだ、依頼者は merge と deploy をこのループに任せている(2026-11-16)。条件は、5 の「次へ進む条件」を満たし、仕様の未決事項に触れていないことである。

```sh
gh pr merge <PR> --merge --delete-branch
```

積んだ PR があるときは、下の PR を merge する前に、上の PR の base を `main` に変える(`gh pr edit <上の PR> --base main`)。

文書・テスト・CI の設定だけの変更は、deploy しない。それ以外は、[本番に反映する](../../../docs/dev/deploy.md)に従う。

1. deploy 用の checkout(`../slide-deploy`)を、push 済みの `origin/main` に合わせる。未 commit の変更がないことを確かめる。commit していない変更や、push していない commit を deploy しない。
2. migration があるときは、先に本番の D1 をバックアップし、未適用の一覧を確かめてから適用する。データが消える migration は、適用の前に依頼者に確かめる(止まる条件)。
3. `pnpm run deploy` を実行する。
4. 反映後の確認を、同じ文書の手順で行う。変えた機能は、本番で、読者と同じ経路で 1 度通す。
5. commit の SHA、push 済みであること、deploy の結果(Worker の version)、作業ツリーが clean であることを報告する。

本番で確認が失敗したら、原因を調べる前に、直前の version へ戻すことを先に考える。戻したら、そのことを報告する。

## 7. 記録する

- issue に、満たした受け入れ条件の ID、PR、本番で確かめたこと、残っている人の確認をコメントする。
- すべての受け入れ条件と人の確認が終わっていれば、issue を閉じる。残っていれば、開けたままにする。
- 機能の受け入れ条件がすべて満たされたら、仕様の冒頭の状態を「実装済み」に変える PR を出す。
- 依頼者への報告は短くする。長く作業したあとに判断が要るなら、アーティファクトにまとめ、リンクを先に示す。

そのあと、1 に戻る。
