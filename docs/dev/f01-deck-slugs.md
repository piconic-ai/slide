# slug を作者ごとの名前にする実装設計

[スライドを、ドロップして置く](../features/f22-browser-drop.md) の F22-AC25(2 人の作者が、同じ slug を使える。もとは F01-AC9)を実装するための契約。誰が作者かの判定は [招いた作者の実装設計](f01-invited-authors.md) にある。

状態: 設計。2026-11-17 に、コードを読んで調べた結果をもとに書いた(commit `68dac12`)。実装は、下の「PR の分け方」の順に進める。PR 2(`slug` の列と、`DeckId`・`DeckSlug` の分離)と PR 3(入口で `(持ち主, slug)` から鍵を引く)、PR 4(trigger を消す migration `0023`)まで、すべて実装済みである。

> 2026-11-20: GitHub のリポジトリからスライドを送る仕組み(リポジトリの連携、GitHub Actions からのアップロード)は、取り除いた([GitHub からスライドを更新する](../features/f01-github-deploy.md))。受け取りは、ログイン中の作者の session で始める([ドロップして置くための実装設計](f22-browser-drop.md))。下の「いまの状態」や PR の記録のうち、連携と CI に触れる記述は、当時のものである。受け入れ条件は、F22 が引き継いだ(F01-AC5〜F01-AC10 は F22-AC21〜F22-AC26)。

## いまの状態

`decks.id` は、スライドの主キーであり、同時に、作者が決める slug(共有 URL `/@handle/slug` の後ろ)でもある。主キーなので、全作者で 1 つしか使えない。

- 作者 B が、作者 A の使っている slug で連携しようとすると、「ほかの作者のスライドです」(409)と断られる。A の下書きの slug が存在することも、B にわかる。
- `decks.id` を指している表は 4 つある: `repository_bindings.deck_id`(主キーでもある)、`deployments.deck_id`、`reaction_posts.deck_id`、`event_talks.deck_id`。`decks` と `deployments` は、互いを指している。
- slug を文字として持っている表は `citations`(`target_handle`、`target_slug`)だけで、すでに handle ごとである。
- R2 の object key、配信の origin、cookie、token、cache の key は、どれも deployment の ID で作っていて、スライドの ID を含まない。

## 設計

### 鍵と名前を分ける

`decks.id` は主キーのまま残し、作者が決める名前を、新しい列 `decks.slug` に持つ。

- `slug` は、作者ごとに一意にする(`UNIQUE(owner_user_id, slug)`)。
- `id` は、作者が決められない値にする。新しく作るスライドには、乱数の ID を振る。**いまあるスライドの `id` は変えない**(`slug` と同じ値のまま残る)。`id` を指している 4 つの表を作り直さずに済み、行を消す操作がない。
- 型も分ける。`DeckId`(鍵)と `DeckSlug`(名前)を別の型にし、取り違えを型の誤りにする。いまは、次の 4 か所が、名前を鍵として(または、その逆に)渡している。値が同じなので動いているだけである。
  - 読者のページが、URL の slug を、そのまま反応とイベントの検索に渡している(`src/share/routes.ts`)。
  - 作者の反応のページが、鍵を、handle と slug で引く検索に渡している(`src/reactions/routes.ts` の 3 か所)。

### migration

行を消さない、足すだけの migration にする。

1. `ALTER TABLE decks ADD COLUMN slug TEXT`
2. `UPDATE decks SET slug = id`
3. `CREATE UNIQUE INDEX decks_owner_slug ON decks(owner_user_id, slug)`
4. `slug` を渡さずに足された行に、`id` と同じ値を入れる trigger を作る。

   ```sql
   CREATE TRIGGER decks_slug_from_id AFTER INSERT ON decks
   WHEN NEW.slug IS NULL
   BEGIN
     UPDATE decks SET slug = NEW.id WHERE id = NEW.id;
   END;
   ```

4 は、古い Worker のためにある。[本番に反映する](deploy.md) の順は、migration を適用してから Worker を切り替える。そのあいだと、Worker を 1 つ前の版に戻しているあいだは、`slug` を知らない古いコードが、スライドを作れる。その行の `slug` が `NULL` のままだと、`slug` で引く新しいコードから見えなくなる。古いコードは `id` に slug を入れるので、trigger が同じ値を `slug` に入れれば、どちらのコードからも同じ名前で引ける。新しいコードは、必ず `slug` を渡すので、trigger は働かない。

trigger は、`slug` を知らない版に戻すことがなくなってから(下の PR 3 を反映し、その次の反映が済んだあと)、別の migration で消す。PR 3 からは、新しいスライドの `id` が乱数になるので、PR 3 より前の版に戻すと、その版からは乱数の `id` のスライドを slug で引けない。PR 3 の反映で確認が失敗したときは、戻す前に、反映のあとに作られたスライドがないかを確かめる。

SQLite は、あとから足す列に、既定値のない `NOT NULL` を付けられない。表を作り直すと、`decks` を指す 4 つの表も作り直すことになるので、列は `NULL` を許したままにし、行を読む境界(`deckRowSchema`)で、文字列であることを確かめる。書き込みは、必ず `slug` を渡す。

削除中のスライド(`deleted_at` がある行)も、一意の対象に含める。同じ作者が、削除の終わっていない slug をもう一度使おうとすると、いまと同じく「削除中です」と断る。ほかの作者の削除中のスライドは、もう妨げにならない。

### どこで、名前から鍵を引くか

外から届くのは、いつも slug である。それぞれの入口で、持ち主を決めてから、`(owner_user_id, slug)` で鍵を引く。

| 入口 | 持ち主を決めるもの |
| --- | --- |
| 管理画面と、その API(`/slides/:slug…`、`/api/slides/:slug…`) | ログインした本人 |
| 受け取りの開始(`/api/slides/:slug/uploads`) | ログインした本人(session) |
| 共有 URL(`/@handle/slug`)、運営の非表示の指定、引用のリンク | URL の handle |
| 運営の解除(`/takedowns/:id/release`) | 持ち主は問わない。運営の画面が、鍵をそのまま渡す |
| アップロードの続き(`/api/uploads/:id/…`) | 保存してある deployment の行。鍵を持っているので、変わらない |

管理画面の URL は、slug のままにする(`/slides/intro`)。鍵を URL に出さないので、ほかの作者の slug を入れても、自分のスライドがなければ「存在しない」になるだけである。

鍵を引く関数は 1 つにまとめ(`src/decks/store.ts` の `resolveDeck(database, ownerUserId, slug)`)、見つからないときと、ほかの作者のものであるときを区別しない。返すのは `{ id, slug, deleted }` で、削除中の行も返す(`deleted` で見分ける)。反応のページは、削除中を「存在しない」にする。ほかの入口は、これまでどおり、後ろの検索が削除中の行を除く。

実装したときに、設計から決めた細部:

- 新しいスライドの行は、乱数の鍵(`crypto.randomUUID()`)で作る。同じ人の同じ slug は、一意の index が 1 つに絞る。スライドを作る入口は、[ドロップして置くための実装設計](f22-browser-drop.md#スライドを作る) にある。
- 受け取りの開始は、session の作者を持ち主として鍵を引く(`resolveDeck`)。見つからないときと、ほかの作者のものであるときは、どちらも 404 で、区別しない。
- 再送の key は、鍵と、送り手が作る `attempt` から作る([同じ内容を二重に受け取らない](f22-browser-drop.md#同じ内容を二重に受け取らない))。

### 一緒に直す所

- アップロードの再送を見分ける key(`deployments.idempotency_key`)は、slug でなく鍵から作る。
- `decks.id` を slug として返している検索(公開の一覧、引用した・された一覧、イベント、運営の一覧)は、`decks.slug` を返す。並び順に `decks.id` を使っている所も、`slug` に変える。
- 「ほかの作者のスライドです」(409)は、なくなる。作者ごとに一意なので、ぶつかるのは自分のスライドだけである。
- slug の決まり(`deckIdSchema` の正規表現)は、そのまま slug の決まりにする。写しが `scripts/upload.mjs` と `public/share.js` にある。
- 手で動かす script(`scripts/verify-upload.mjs`、`scripts/demo-citations.mjs`)と、テストの `seedDeck` は、`slug` も入れる。

### テスト

- 2 人の作者が、同じ slug のスライドを持て、それぞれの共有 URL が、それぞれのスライドを開く(F22-AC25)。
- 同じ slug の 2 つのスライドで、管理画面、公開、削除、作者限定の表示、反応、イベント、引用、アップロードが、もう一方に届かない(F22-AC23)。
- 乱数の `id` を持つスライドで、読者のページの反応とイベントが出る(名前と鍵を取り違えると、出ない)。
- migration のあと、いまあるスライドの `slug` が `id` と同じで、共有 URL が変わらない。
- migration のあとに、`slug` を渡さない古い形の `INSERT` で作った行が、新しいコードから、もとの slug で引ける(migration → 古いコードで作成 → 新しいコードで検索)。

## PR の分け方

| 順 | 内容 | 動作の変化 |
| --- | --- | --- |
| 1 | この文書と、仕様の F01-AC9 | なし |
| 2 | migration で `slug` の列、一意の index、trigger を足す。書き込みは `slug` も入れる。`DeckId` と `DeckSlug` を分け、取り違えている 4 か所を直す。handle と slug で引く検索と、slug を返す検索を、`decks.slug` に変える | なし(どの行も、`slug` と `id` が同じ) |
| 3(実装済み) | 入口で `(持ち主, slug)` から鍵を引く。新しいスライドに乱数の `id` を振る。連携の 409 をなくす。再送の key を鍵から作る。2 人の作者のテスト | 2 人の作者が、同じ slug を使える |
| 4(実装済み) | trigger を消す migration(`0023_drop_deck_slug_trigger.sql`) | なし |

2 は migration を含むので、[本番に反映する](deploy.md) の手順どおり、D1 のバックアップを取ってから適用する。行を消す操作はない。

## 決めていないこと

- 作者が、あとから slug を変えられるようにするか。この設計では、変えても鍵は変わらないので、作れる。古い共有 URL の扱いを決める必要があり、いまは作らない。
