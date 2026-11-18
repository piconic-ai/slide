# アカウントの停止の実装設計

[知らない人のスライドも、安心して開ける](../features/f17-safe-viewing.md) のうち、運営がアカウントを停止する部分を実装するための契約。スライドごとの非表示は [運営による非表示の実装設計](f17-takedown.md) を使い、ここでは停止の状態と、それが何を止めるかを扱う。

運営の画面からの停止と解除、停止中の本人の画面は、まだない(#158)。いまは、停止の行があるときの動作だけがある。

## 停止の状態

停止は、表 `suspensions` の行で持つ。行があれば停止中、なければ通常である。

| 列 | 内容 |
| --- | --- |
| `user_id` | GitHub の user ID。主キー。`decks.owner_user_id` と同じ値 |
| `reason` | 運営が書いた理由 |
| `suspended_at` | 停止した日時 |
| `suspended_by` | 操作者(Cloudflare Access で確かめた本人) |

`accounts` を参照しない。退会すると `accounts` の行は消えるが、停止の行は残す。同じ GitHub アカウントで入り直しても、停止中のままにするためである。

スライドの公開状態と、スライドごとの非表示(`decks.hidden_at` など)は、停止しても変えない。停止の行を消すと、スライドは停止の前の状態に戻る。運営が個別に非表示にしたスライドは、非表示のままである。

## 止めるもの

読者向けの query は、すべて `src/publication/takedown-store.ts` の条件 `notHidden` を付けている。この条件に、「持ち主が停止中でない」(`src/publication/suspension-store.ts` の `notSuspended`)を含めた。読者向けの経路は、1 か所で止まる。

| 経路 | 停止中の結果 |
| --- | --- |
| 共有 URL、配信、表紙、公開スライドの一覧、引用の一覧 | スライドごとの非表示と同じ。内部の cache が温まっていても、直後の request から拒否する |
| プロフィール(`/@handle`) | 存在しない handle と同じ応答 |
| CI のアップロード(開始、受信、finalize) | 拒否する。登録から外した人と同じ扱い |
| 作者の公開・再開の操作 | 公開状態は変わらない。応答は `not_publishable` になる |

運営の画面の検索(非表示の一覧、通報の一覧)は、`notHidden` を使わないので、停止中の人のスライドも出る。

読者向けの query を足すときは、`notHidden` を付ける。付けていない source は、`src/share/takedown-readers.test.ts` が見つける。
