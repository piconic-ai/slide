# 人とコミュニティが分け合うハンドルの実装設計

[コミュニティをつくる](../features/f30-communities.md) の F30-AC1〜F30-AC8、F30-AC43 と、[メールのコードでログインする](../features/f28-email-login.md) の F28-AC102 を作るための設計。人とコミュニティは、同じ `slide.community/@ハンドル` の並びを分け合う(D-03)。ハンドルの決まり(文字、長さ、予約語)は [メールのコードでログインする実装設計](f28-email-login.md#ハンドルの決まりと予約語d-26) のまま、人とコミュニティで同じにする(D-14)。

## 表

migration は 0049(`migrations/0049_shared_handles.sql`)。足すだけで、`accounts.handle` は残す(D-04)。

| 表 | 列 | 役割 |
| --- | --- | --- |
| `handles` | `handle`(主キー)、`owner_kind`(`person` か `community`)、`owner_id`、`created_at` | 使われているハンドルと、その持ち主。主キーが、人とコミュニティをまたいで、1 つのハンドルを 1 つの持ち主に限る。`(owner_kind, owner_id)` の一意の索引が、1 つの持ち主に 1 つのハンドルを限る |
| `released_handles` | `handle`(主キー)、`released_at`、`moved_to_kind`、`moved_to_id` | 手放されたハンドルと、その日時(D-16)。運営がハンドルを変えたときだけ、`moved_to_*` に、前のハンドルの持ち主を入れる(D-36)。2 つは、両方が NULL か、両方が入っているかのどちらか(CHECK) |

- `owner_id` は、人なら `accounts.user_id`、コミュニティならコミュニティの id(作業 C の表)。コミュニティの表には、ハンドルを持たせない。コミュニティのハンドルは、いつも `handles` から引く。人のハンドルは、第二スコープの問い合わせがそのまま読めるよう、`accounts.handle` にも同じ値を持つ(写し)。2 つは、取る処理と変える処理が、同じ batch で書く。
- 同じハンドルが 2 度手放されたとき(90 日の後にだれかが取り、また手放したとき)は、`released_handles` の行を新しい日時で上書きする。
- 転送の行き先は、新しいハンドルではなく持ち主で持つ。運営が同じ持ち主のハンドルを 2 度変えても(`a` → `b` → `c`)、`/@a` は 1 回の 301 で `/@c` へ移る。持ち主がいなくなれば(退会、削除)、転送も止まる。

### 既存のハンドルの写し方

0049 が、`accounts` のすべての行を `handles` へ写す(`owner_kind = 'person'`、`created_at` は `accounts.created_at`)。第二スコープの人の URL は、同じ持ち主を指したまま開く(F30-AC6)。確かめるテストは `src/db/handles-migration.test.ts`。

反映のあいだと、反映を戻したときには、`handles` を知らない前の Worker が動く。前の Worker が `accounts` に行を足したときは、trigger `accounts_handle_shared` が `handles` に同じ行を足す。コミュニティが持つハンドルなら、trigger の挿入が主キーで失敗し、アカウントも作られない。いまの Worker は、`handles` の行を先に書くので、trigger は何もしない。前の Worker が、90 日以内に手放されたハンドルでアカウントを作ろうとしたときは、trigger `accounts_handle_held` が挿入を止める(いまの Worker は、`handles` の行を先に書くので、この trigger の対象にならない。保留の判定は、渡した `now` で取る処理が行う)。前の Worker が退会を処理したときは、`handles` の行が残る(そのハンドルは、だれも取れないままになる)。一意が壊れる向きではないので、受け入れる。前の Worker を戻せなくなったら、trigger を消す migration を足す(第二スコープの 0022 と 0023 と同じ形)。

## 取る処理

ハンドルを取る処理は、`src/handles/store.ts` の `takeHandle` 1 つにする。人の登録(`/welcome` の `createAccount`)と、コミュニティの作成(作業 C)が、どちらもこれを呼ぶ。

```ts
takeHandle(database, {
  handle,           // checkHandle を通った Handle
  owner,            // { kind: 'person', id: userId } | { kind: 'community', id }
  now,              // 秒
  precondition,     // 省略可。?1 を持ち主の id として読む SQL の条件
  rest,             // (owned: OwnedCondition) => D1PreparedStatement[]
})
// => 'taken_by_owner' | 'taken' | 'held'
```

1. 呼ぶ前に、`checkHandle`(`src/auth/handle-rules.ts`)で、文字と予約語を確かめる。
2. 1 つの batch(D1 の transaction)で、まず `handles` に行を足す。足すのは、`released_handles` に 90 日以内の行がないとき(`released_at > now - 90 日` の行がないとき)と、`precondition` を満たすときだけ。
3. 同じ batch で、持ち主の行(人の `accounts` と `profiles`、コミュニティの表)を足す。持ち主の行には、`handles` にこの持ち主の行があるときだけ入る条件(`rest` に渡す `owned`)を付ける。保留中で 2 が何も足さなかったときは、持ち主の行も入らない。
4. 同時に同じハンドルを取ろうとしたときは、`handles` の主キーで、後の batch が失敗し、まるごと戻る(F30-AC5)。
5. batch の後に、`handles` の行がこの持ち主のものなら取れた。そうでなければ、`handleAvailability` で理由を読む: ほかの持ち主がいれば `taken`、保留中なら `held`。

`handleAvailability(database, handle, now)` は、取る前の確かめ(画面に理由を出す)にも使える。結果は `available`、`taken`、`held`。ただし、確かめてから取るまでの間に変わるので、取れたかどうかは `takeHandle` の結果だけで決める。

画面に出す理由の文は、`src/handles/refusals.ts` の `handleRefusalText(lang, reason)` にまとめる。`checkHandle` の理由(`empty`、`too_long`、`invalid_characters`、`leading_hyphen`、`reserved`)と、`taken`、`held` を、日本語と英語で返す。`/welcome` と、コミュニティを作る画面(作業 C)が、同じ文を出す。

- `taken`: 「このハンドルは、すでに使われています。」人が使っていても、コミュニティが使っていても、同じ文にする(F30-AC1、F30-AC2)。
- `held`: 「このハンドルは、手放されてから 90 日の間は選べません。」(F30-AC43)

## 予約語

D-15 の語を足す(F30-AC3)。

- `communities`、`events`、`blocks` は、経路の先頭の語(`ROUTE_HANDLES`)。`events` は第二スコープから予約してある。`communities` と `blocks` の経路は、作業 C と作業 K が足す。`handle-rules.test.ts` は、経路のない予約語を、テストに名前で書いて許す(経路ができたら、その名前を消す)。
- `edit` は、コミュニティの `/@ハンドル/edit` の語。ハンドルのあとに来る語なので、`AFTER_HANDLE_WORDS` とは別の一覧 `COMMUNITY_PAGE_WORDS` に置く。人のスライドの名前としては、使える。

## `/@ハンドル` の振り分け

`src/share/routes.ts` の `/@` の入口は、経路を読んだあと(綴りの転送と、読めない経路の 404 のあと)、`resolveHandle(database, handle)` で表を引く。

| 結果 | 出すもの |
| --- | --- |
| `{ kind: 'person', userId }` | 第二スコープのまま、プロフィールと、その下の一覧と viewer |
| `{ kind: 'community', communityId }` | `src/communities/handle-routes.ts` の `showCommunity`。中身は作業 C が作る。それまでは 404 |
| `{ kind: 'moved', handle }` | 前のハンドルの部分だけを新しいハンドルに替えた URL へ 301(クエリも残す) |
| `{ kind: 'none' }` | 第二スコープのまま(404) |

`moved` になるのは、`handles` にそのハンドルの行がなく、`released_handles` の行に持ち主があって、その持ち主がいまハンドルを持っているときだけ。90 日の保留が明けて、だれかが前のハンドルを取ったら、その人のページを出す(転送は止まる)。

## 手放されたハンドルの保留

手放すのは、`releaseHandleStatements(database, { owner, now })` が返す 2 つの文(`released_handles` への上書きと、`handles` の行の削除)。呼ぶ側の batch に入れる。

- 退会: `markAccountDeleted`(`src/decks/deletion-store.ts`)の batch に入れる(F30-AC4)。
- コミュニティの削除: 作業 C が、削除の batch に入れる(F30-AC8)。

保留の長さは `src/handles/hold.ts` の `HANDLE_HOLD_SECONDS`(90 日)。90 日ちょうどが過ぎた時刻から取れる。

## 運営によるハンドルの変更と転送

`renameHandle(database, { owner, to, now })`(`src/handles/store.ts`)が、1 つの batch で次を行う(F30-AC7)。

1. `handles` の行のハンドルを `to` に替える。`to` が保留中なら、何も替えない。ほかの持ち主がいれば、主キーで失敗する。
2. 人なら、`accounts.handle` も替える。
3. 第二スコープの引用(`citations` と `article_citations` の `target_handle`)のうち、前のハンドルを指すものを `to` に替える。引用は、スライドと記事の中の `/@前のハンドル/…` へのリンクで、そのリンクは 301 で新しいページへ移るので、同じ人を指し続ける。同じ版から新しいハンドルへの引用がすでにある行は、替えずに残す(`UPDATE OR IGNORE`。主キーが重なるため)。
4. `released_handles` に、前のハンドルと日時と持ち主を入れる。前のハンドルは、90 日の間、だれも取れない。

結果は `renamed`、`taken`、`held`、`no_owner`(持ち主がハンドルを持っていない)。`to` の文字と予約語は、呼ぶ側が `checkHandle` で確かめる。運営の画面の操作は作業 C が作る。

本人は、ハンドルを変えられない(F28-AC102)。ハンドルを変える経路は、運営の画面だけに置く。`/welcome` は、アカウントのある人には何もせず戻り先へ送り、`createAccount` も、アカウントのある人には `has_account` を返して何も書かない。

## 確かめ方

- 表と写し: `src/db/handles-migration.test.ts`(第二スコープの最後の状態にデータを入れた D1 に、0049 を足す)。
- 取る処理、保留、同時の取得、変更: `src/handles/store.test.ts`(ローカルの D1)。
- `/welcome` の理由の表示: `src/auth/login-routes.test.ts`。
- 振り分けと転送: `src/share/handle-dispatch.test.ts`(ローカルの HTTP と D1)。
