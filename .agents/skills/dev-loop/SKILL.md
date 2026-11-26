---
name: dev-loop
description: slide の機能開発を、issue を 1 件選ぶところから、実装、検証、PR、レビュー対応、`main` への merge、記録まで 1 周させる(本番への反映は依頼者のリリース PR の merge)。「ループを回して」「次の issue を進めて」「#NNN を実装して」と言われたときに使う。仕様に未決事項があるところは作らず、相談に回す。
---

# 開発を 1 周させる

1 周は、issue 1 件を、根拠の付いた PR にして、`main` に merge し、記録するまでである。本番への反映は、このループの外にある。依頼者が tagpr のリリース PR を merge したときだけ、本番が変わる([本番に反映する](../../../docs/dev/deploy.md))。下の順に進める。各段の「次へ進む条件」を満たすまで、次の段に進まない。

> **この skill の「merge まで」の形が効く条件。** `scope4` が `main` に入り、依頼者が [本番に反映する](../../../docs/dev/deploy.md#依頼者が最初に行う設定) の設定を済ませた後から効く。それまでは、`main` への merge の後に、[移行前の手順](../../../docs/dev/deploy.md#移行前の手順)(手で反映する。鍵、確認、戻し方がそこにある)を行う。下に「移行前のみ」と書いた条件と手順は、それまでの間だけ使う。

読むもの(最初に 1 度): [開発方針](../../../AGENTS.md)、[設計の決まり](../../../docs/dev/architecture.md)、[仕様と issue の決まり](../../../docs/dev/planning.md)、[開発手順](../../../docs/dev/development.md)、[本番に反映する](../../../docs/dev/deploy.md)。

## 止まる条件

次のどれかに当たったら、その issue の作業をそこで止める。推測で先へ進めない。止めたら、issue にコメントで「どこで、なぜ止まったか、依頼者に何を決めてほしいか」を書き、依頼者への返答でも同じことを伝える。そのあと、止まった issue に依存しない別の issue があれば、そちらへ進む。

1. 対象の受け入れ条件が、仕様の「未決事項」に挙がっている。または、仕様に書かれていない判断が要る。→ 相談が要る。`.agents/skills/discuss-feature/SKILL.md` があればそれに従い、なければ依頼者に質問する。
2. 受け入れ条件を満たすには、仕様の「作らないこと」に反する必要がある。
3. secret、GitHub App の設定、DNS、課金など、依頼者しか行えない操作が要る。
4. 1 つの PR の中で、同じ判断(同じ関数や同じ決まり)への指摘が 3 回目になった。→ 個別に直すのをやめ、やり方を変え、変えたことを PR に書く。やり方を変えたあとに、同じ判断への指摘がもう 1 回来たら止まる。
5. 次の反映で本番に適用される migration のどれかが、データを消す(表や列の削除、行の削除、表の作り直し、型の変更で値が失われるもの)。移行前のみ: **merge の前に**止まり、依頼者の確認を得る(merge が deploy になるため)。バックアップを取ることは、確認の代わりにならない。新しい流れでは、merge しても本番は変わらないので止まらない。代わりに、PR の本文に書き、merge の後にリリース PR へコメントする(6 の 3)。
6. 移行前のみ: 本番への反映後の確認が失敗した。→ [手で戻す](../../../docs/dev/deploy.md#手で戻す)を行ってから止まる。次の issue には進まない。
7. 移行前のみ: ほかの人や別のループが、本番への反映を進めている(手で反映する手順の 1 で、鍵を取れない)。
8. PR が、誰に権限を与えるかを決める設定を変える(`wrangler.jsonc` の `ACCESS_TEAM_DOMAIN`、`ACCESS_AUD`、`OPERATOR_ORIGIN`)。→ merge の前に止まり、依頼者の確認を得る。
9. 本番を変える操作が要る(リリース PR の merge、deploy、タグと `release` ブランチの操作、本番の D1・R2・Worker・secret・DNS・Cloudflare と GitHub の設定)。→ 行わず、依頼者に伝える。

## 1. 選ぶ

```sh
gh issue list --state open --limit 50
gh issue view <番号> --comments
```

- 依頼者が番号を指定したら、それを選ぶ。
- 指定がなければ、[ストーリーマップ](../../../docs/story-mapping.canvas)の `scope` の番号が小さい機能(scope1、scope2、…の順)に属する issue を、番号の若い順に見る。
- 選んだ issue の本文とコメントを、すべて読む。リンクされた仕様(`docs/features/fNN-*.md`)も、すべて読む。
- 「対象の受け入れ条件」に ID が書かれていない issue は、作業票になっていない。選ばずに、次の issue を見る。

**次へ進む条件**: 次の 3 つを、issue へのコメントとして書ける。(a) 対象の受け入れ条件の ID の一覧。(b) ID ごとに、何を観測すれば満たしたと言えるかを 1 文ずつ。(c) それらの ID が、仕様の「未決事項」に挙がっていないこと。書けないものがあれば、止まる条件 1 に当たる。

## 2. 準備する

自分用の worktree を、最新の `origin/main` から作る。メインの checkout では、下の 2 つのコマンド以外の git の操作(checkout、commit、stash、reset)をしない。そこでは、ほかの人や別の agent が作業している。

```sh
git fetch origin
git worktree add -b <種別>/<短い名前> ../slide-<短い名前> origin/main
cd ../slide-<短い名前>
pnpm install --frozen-lockfile
```

生成物を使うテストを動かす前に `pnpm build` を実行する。ブラウザーテストを選んだら `pnpm exec playwright install chromium` で Chromium を用意する。

- `<種別>` は、`feat`(機能)、`fix`(不具合)、`docs`(文書)、`chore`(それ以外)、`ci` のどれかにする。
- 1 つの PR は、1 つの要求を満たす大きさ(変更 400 行ほどまで)にする。大きいときは、受け入れ条件ごとに PR を分けて積む。
- `git stash` は使わない(worktree の間で共有される)。

## 3. 作る

受け入れ条件ごとに、次の順で進める。

1. 条件を確かめるテストを先に書き、失敗することを見る。先に書けなかったときは、実装のあとで、守っている条件を一時的に外してテストが失敗することを確かめ、元に戻す(戻すときに `git stash` は使わない。`git diff <file> > <scratchpad>/x.patch`、`git checkout <file>`、確認、`git apply` の順で行う)。テスト名に ID を入れる(`F17-AC7: Given ... When ... Then ...`)。
2. 層の決まりに従って実装する。判断と変換は純粋なファイルに、D1・R2 は `*store.ts` に、HTTP は `*routes.ts` に置く。新しいファイルには、層を表す名前を付ける。`scripts/layers.test.mjs` の `KNOWN` に行を足さない。
3. 典型的な入力に加えて、空の値、境界値、不正な形式、矛盾した状態のテストを書く。
4. D1 のスキーマを変えるときは、[D1 のクエリとスキーマを変更する](../../../docs/dev/development.md#d1-のクエリとスキーマを変更する)に従い、テーブル定義と migration の両方を書く。適用済みの migration は変えない。1 つ前の版のコードが、新しいスキーマでも動くようにする(deploy を戻せるようにするため)。
5. 1 つの動作ごとに、テストと一緒に commit する。commit の文は英語で書く。

仕様の文と実装が食い違うことに気づいたら、実装を仕様に合わせる。仕様のほうが誤りだと考えるなら、止まる条件 1 に当たる。

## 4. 確かめる

変更した動作ごとに、[開発手順](../../../docs/dev/development.md#変更を確認する)に従い、対象ファイルを指定してテストする。ローカルでは通常カバレッジを計測しない。整形は `pnpm format:check`、TypeScript の変更は `pnpm exec tsc --noEmit`、文書の変更は `python3 scripts/check-docs.py` で確かめる。

- 失敗が今回の変更と無関係に見えるときは、`origin/main` の別の worktree で失敗した検査を同じ条件で実行し、再現してからそう書く。テストはまず失敗したファイルに絞り、全件のときだけ起きる失敗やカバレッジ下限の問題は全件で確かめる。
- カバレッジが下限を下回ったら、テストを書く。下限を下げない。
- 画面、配信、公開の状態、アップロードを変えたときは、`verify-slide` skill でローカルの実物を動かし、スクリーンショットや応答を残す。[機能の対応表](../verify-slide/features/README.md)に入口が増えたら、同じ PR で表を直す。
- 仕様、設計、手順が変わったら、同じ PR で文書を直す。

**次へ進む条件**: ローカルで変更に関係する検査が通っている。受け入れ条件の ID ごとに、確かめたテスト名、またはコマンドと結果を書ける。

## 5. PR を出して、仕上げる

1. push して、[テンプレート](../../../.github/pull_request_template.md)で draft の PR を作る(`gh pr create --draft`)。本文は日本語で書く。「満たした受け入れ条件」に ID と確かめた方法を、「確かめていないこと」「人の確認」に残りを書く。本文に `Refs #<issue>` を入れる。
2. 自分の差分を、先入観のない目で読み直す。別の agent を起動できるなら、会話の文脈を渡さずに、差分(`git diff origin/main...HEAD`)、`AGENTS.md`、PR の本文だけを渡してレビューさせる。起動できないなら、差分を最初から最後まで読み、変えた関数ごとに「空の入力、境界値、権限のない人、同時の実行で壊れないか」を自分に問う。壊れる入力や状態を具体的に示せる指摘だけを直す。
3. PR の最新コミットで CI のビルド・型検査・全件テスト・カバレッジを含む検査の成功を確かめてから ready にする。失敗したらログを読む(`gh run view <run> --log-failed`)。

   ```sh
   gh pr checks <PR> --watch
   ```

4. `gh pr ready <PR>` で ready にする。Pullfrog がレビューする。
5. Pullfrog のレビューを読む。`pullfrog` の check が緑でも、指摘が残っていることがあるので、必ず本文を読む。

   ```sh
   gh pr view <PR> --json headRefOid --jq .headRefOid
   gh api --paginate repos/piconic-ai/slide/pulls/<PR>/reviews --jq '.[] | select(.user.login=="pullfrog[bot]") | {commit_id, body}'
   gh api --paginate repos/piconic-ai/slide/pulls/<PR>/comments --jq '.[] | select(.user.login=="pullfrog[bot]") | {id, in_reply_to_id, path, line, body}'
   ```

6. 指摘ごとに、いまの head に当てはまるかを確かめ、再現してから直す。同じ種類の見落としがほかにないかも見る。直したら、スレッドに日本語で、直した commit と確かめた方法を返信する(`gh api repos/piconic-ai/slide/pulls/<PR>/comments/<id>/replies -f body=...`)。直さないと決めた指摘には、理由を返信する。**スレッドは resolve しない。**
7. push のたびに、3 と 5 をやり直す。
8. ファイルの名前を変えた、または分けたときは、古い名前が文書に残っていないかを探す。`scripts/check-docs.py` はリンクしか調べないので、文中に書いたファイル名は CI では見つからない。

   ```sh
   git grep -n "<古いファイル名>" -- docs .agents AGENTS.md README.md
   ```

テストを弱めて通さない。失敗を理由なく再実行しない。Pullfrog のレビューが 30 分たっても付かないときは、`gh pr ready <PR> --undo` のあと `gh pr ready <PR>` で 1 度だけ起動し直す。それでも付かなければ、止まって依頼者に知らせる。

**次へ進む条件**(すべて満たすこと):

- `gh pr checks <PR>` のすべての行が `pass`、または意図した `skipping` である。
- Pullfrog の最新のレビューの `commit_id` が、PR の `headRefOid` と同じである。
  - head が、レビュー済みの commit に `origin/main` を取り込んだだけの merge commit のときは、Pullfrog はレビューをやり直さない(`pullfrog` の check は通る)。このときは、下の 3 つを確かめれば、この条件を満たしたとみなす。1 つ目が、レビュー済みの commit と、main の commit の 2 つを、この順に返す。2 つ目が、終了コード 0 で tree の ID を 1 行だけ返す(衝突のない、自動の取り込みである)。3 つ目が、2 つ目と同じ ID を返す(head が、その自動の取り込みと同じ中身である)。衝突を手で直した取り込みや、取り込みのついでに変更を足した commit は、ID が合わないので、レビューを待つ。

    ```sh
    git log -1 --format=%P HEAD                               # <レビュー済みの commit_id> <main の SHA>
    git merge-tree --write-tree <レビュー済みの commit_id> <main の SHA>
    git rev-parse 'HEAD^{tree}'
    ```
- そのレビューの本文と、行へのコメントのうち、自分が返信していないものが 1 つもない。直すと答えたものは、直してある。
- `gh pr view <PR> --json mergeable,mergeStateStatus` が `MERGEABLE` と `CLEAN` を返す。`UNSTABLE` は、check がまだ実行中か、失敗していることを表す。Pullfrog のレビュー本文が付いていても、`pullfrog` の check が終わるまで待つ。
- 差分を読み直し、issue の範囲に収まっている。
- branch に、最新の `origin/main` を取り込んである。下のコマンドで `Already up to date.` と出ること。取り込みが起きたら、push して、手順 3 と 5 をやり直す。

  ```sh
  git fetch origin && git merge origin/main
  ```

- 今回の PR の `migrations/` の差分を、すべて読んだ。どの SQL にも `DROP`、`DELETE`、表の作り直し(`CREATE TABLE ... _new` と `DROP TABLE` の組)、値が失われる変更がない。1 つでもあれば、PR の本文の先頭に、ファイルの名前と消えるものを書く。移行前のみ: 本番にある未適用の migration も読み、1 つでも消すものがあれば止まる条件 5 に当たる(`pnpm exec wrangler d1 migrations list slide --remote` は、依頼者が見る。本番の D1 には触れない)。

- いま本番で動いている版のコードが、migration を適用したあとのスキーマでも動く(適用から deploy までの間と、Worker を戻したときのため)。列の追加と表の追加は動く。列名の変更や制約の追加は、動くことをテストで示してある。

## 6. `main` に merge する

開発中のあいだ、依頼者は `main` への merge をこのループに任せている(2026-11-16)。任されているのは、5 の「次へ進む条件」をすべて満たし、止まる条件のどれにも当たらない PR だけである。PR の「人の確認」が残っていても merge してよいが、残っていることを 7 で issue に書く。**`main` に merge しても、本番は変わらない。** 本番に出すのは、依頼者がリリース PR を merge したときだけである。

1. merge する。

   ```sh
   gh pr merge <PR> --merge --delete-branch
   gh pr view <PR> --json state,mergeCommit --jq '[.state, .mergeCommit.oid] | join(" ")'
   ```

   - 1 つ目のコマンドが、手元の branch の削除でエラーを出すことがある(worktree が branch を使っているため)。merge できたかどうかは、2 つ目のコマンドが `MERGED` を返すかで判断する。`MERGED` なら、やり直さない。
   - 積んだ PR があるときは、下の PR を merge する前に、上の PR の base を `main` に変える(`gh pr edit <上の PR> --base main`)。
   - `--delete-branch` は、merge した branch を checkout している worktree を、ディレクトリごと消す。積んだ PR の作業を続けるときは、merge の前に、その worktree で上の branch に切り替えておく(`git checkout <上の branch>`)。消えてしまったら、2 の手順で作り直す(トップページのテストには `pnpm build` が必要)。push していない commit は失われるので、merge の前に、積んだ branch をすべて push しておく。

2. merge の後、`main` の CI が通ることを見る。失敗したら、原因を調べて直す PR を出す。リリース PR は、`main` が壊れたままでは merge されないよう、依頼者が見る。

   ```sh
   gh run list --branch main --workflow ci.yml --limit 1 --json conclusion,headSha
   ```

3. 今回の PR がデータを消す migration を含むときは、リリース PR(tagpr が開く。`gh pr list --search "tagpr in:title" --state open`)に、コメントで書く。ファイルの名前と、消えるものを書く。リリース PR がまだ無ければ、開くのを待ってから書く(workflow が数分で開く)。本文は tagpr が書き直すので、コメントに書く。

   ```sh
   gh pr comment <リリース PR の番号> --body "..."
   ```

4. リリース PR を merge しない。タグと `release` ブランチを作らず、動かさない。deploy もしない。本番の D1・R2・Worker に触れない。反映が済んだかは、依頼者が確かめる。(移行前は、下の「移行前のみ」の段落に従い、手で反映する。)

移行前のみ: 次のどちらかなら、deploy はせず、7 へ進む: 変えたファイルが、すべて `docs/`、`.agents/`、`.github/`、`*.md`、`*.test.*`、`scripts/` の検査用 script、`vitest.config.ts`、`vitest.*.config.ts` のいずれかである。それ以外(`src/`、`components/`、`public/`、`migrations/`、`wrangler.jsonc` など)を 1 つでも含むなら、[手で反映する](../../../docs/dev/deploy.md#手で反映する)手順で反映し、止まる条件 6 の「戻す」に従う。

## 7. 記録する

- issue に、満たした受け入れ条件の ID、PR、`main` に merge したこと(本番へはリリース PR で出ること)、残っている「人の確認」をコメントする。移行前のみ: 本番で確かめたことも書く。
- すべての受け入れ条件を満たし、「人の確認」が残っていなければ、issue を閉じる。残っていれば、開けたままにする。本番に出ていないことを、人の確認として残してよい(リリース PR の merge は依頼者が行う)。
- 機能のすべての受け入れ条件を満たし、人の確認も終わったら、仕様の冒頭の状態を「実装済み」に変える PR を出す。
- 使い終えた worktree を片付ける(メインの checkout で `git worktree remove ../slide-<短い名前>`)。
- 依頼者への報告は短くする。決めてほしいことが複数あるときは、1 つずつ、選択肢とおすすめを添えて書く。アーティファクトを作れるなら、そこにまとめ、リンクを先に示す。

そのあと、止まる条件に当たっていなければ、1 に戻る。
