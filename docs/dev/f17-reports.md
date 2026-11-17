# 通報の実装設計

[知らない人のスライドも、安心して開ける](../features/f17-safe-viewing.md) のうち、読者がスライドを通報する部分(F17-AC16、F17-AC18、F17-AC25、F17-AC26)を実装するための契約。運営の画面は [運営による非表示の実装設計](f17-takedown.md)、共有 URL は [共有 URL と配信の実装設計](f03-sharing.md) を使い、ここでは通報の保存、通報のページ、ログインのあとの戻り先を扱う。

状態: 通報を送るところと、スライドの削除で通報を消すところまで実装した。運営の画面の一覧(F17-AC17)は、次の PR で作る。

## 保存

表 `reports`(migration `0024_reports.sql`)に、1 人につき、1 つのスライドに 1 行を持つ。

| 列 | 中身 |
| --- | --- |
| `id` | 乱数の ID |
| `deck_id` | スライドの鍵(`decks.id`) |
| `deployment_id` | 通報を受け付けたときに、一般公開されていた版 |
| `share_path` | 読者が開いていた共有 URL の path(`/@handle/slug`、ページ番号つきなら `/@handle/slug/3`) |
| `reason` | `nuisance`(迷惑行為)、`rights`(権利侵害)、`other`(その他) |
| `note` | 説明。ないときは空文字 |
| `reporter_user_id` | 通報した人の GitHub の user ID。`NULL` を許す(あとでログインなしの通報を足せるように) |
| `created_at`、`updated_at` | 最初に通報した時刻と、最後に通報した時刻(Unix 秒) |

`(deck_id, reporter_user_id)` は一意である。同じ人が同じスライドをもう一度通報すると、`saveReport`(`src/reports/store.ts`)が、理由・説明・版・共有 URL・`updated_at` を置き換える。`id` と `created_at` は変えない。

理由と説明の検証は、純粋な関数 `parseReport`(`src/reports/report.ts`)が行う。説明は、前後の空白を落として 500 文字まで。「その他」のときは、説明が要る。

## スライドの削除

`reports.deck_id` は `decks.id` を指す外部キーなので、通報の行が残っていると、スライドの行を消せない。そのため、通報を送れるようにする変更と、消す変更は、同じ PR に入れた。

- 作者がスライドを削除すると(`markDeckDeleted`)、同じ transaction で、そのスライドの通報を消す。退会で、その人のスライドがすべて削除されるときも同じである。
- 掃除がスライドの行を消すとき(`purgeDeletedDecks`)にも、その直前に通報を消す。削除のあとは通報を受け付けないので、ふつうは残っていない。削除と同時に届いた通報が残っていても、掃除が外部キーの違反で止まらないようにするためである。

## 通報のページ

viewer(`src/share/pages.ts`)に、「通報する」のリンクを置く。作者の HTML の中ではなく、サービス側の画面にある。リンク先は `/reports/new?slide=<共有 URL の path>` である。

| 経路 | 動作 |
| --- | --- |
| `GET /reports/new?slide=…` | ログインしていなければ、401 とログインの案内を返す。ログインしていれば、form を返す。`result=received` が付いていれば、受け付けたことを表示する |
| `POST /reports` | CSRF を確かめ、ログインした人の ID で保存し、`/reports/new?slide=…&result=received` へ 303 で移す。1 回目も 2 回目も、同じ表示になる |

どちらも、`slide` が共有 URL の形でないとき、またはスライドがいま一般公開されていないとき(下書き、停止中、運営が非表示にしたもの、存在しないもの)は、404 を返し、何も保存しない。公開されているかは、viewer と同じ `readSharedDeployment` で確かめる。保存する版は、その関数が返した、いま公開中の版である。form から版の ID を受け取らないので、読者は、ほかのスライドの版を通報に付けられない。

viewer の中でめくったページは、通報に載らない。`share_path` は、ページを開いたときの URL から作る。

## ログインのあとの戻り先

ログインの入口 `/auth/github?to=…` の戻り先は、`landingOf`(`src/auth/landing.ts`)が決める。`settings` は `/settings`、スライドの共有 URL の path は、その path、それ以外はすべて `/slides` になる。共有 URL の path は、`parseSharePath` で解析した部品から組み立て直す。受け取った文字列をそのまま戻り先にしないので、外部の URL や `//host` を入れても、`/slides` になる。

当面、ログインできるのは、運営が登録した人だけである([招いた作者の実装設計](f01-invited-authors.md))。登録していない人が「通報する」からログインに進むと、招待制のページが出る。
