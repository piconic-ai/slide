# イベントの発表の実装設計

[イベントの発表として並ぶ](../features/f29-event-talks.md)の設計。作者がスライドの関連リンクに、connpass などのイベントの URL を入れると、そのスライドが、その URL のリンクのページ(`/link/…`)に並ぶ。この文書は、イベントの URL の判定、鍵、表を書く。ページ、見出し、1 本の管理の文と枠は、[リンクによる集約の実装設計](f45-link-gathering.md)に書いた(2026-11-27 に、イベントのページ `/events/:id` という見せ方をやめた)。サービスは、イベントの元のページを取りに行かない。照らすのは関連リンクだけで、スライドの本文と記事の中のリンクは見ない(F29-AC13)。

## ファイルの分担

| ファイル | 層 | 役割 |
| --- | --- | --- |
| `src/events/event-url.ts` | 純粋 | URL の形の判定(`isEventAddress`)、鍵へのそろえ方(`eventRefOf`)、ホスト名からグループを読む `groupOf`(コミュニティの紐づけ用リンクの判定も使う)、グループのページ(`groupPageOf`、`groupPageOfHosts`)、元のページへ案内する URL(`sourceUrlOf`) |
| `src/events/deck-event.ts` | 純粋 | 1 本のスライドの入っているイベントの型(`DeckEvent`) |
| `src/links/kind.ts` | 純粋 | 種類の既定。イベントの形なら「イベント」、その後に動画と記事のホスト名 |
| `src/links/store.ts` | store | 関連リンクの追加、外す、種類の変更。イベントとの対応も同じ batch で作り直す |
| `src/events/store.ts` | store | 1 本のスライドの入っているイベント(`listDeckEvents`) |
| `src/links/link-page-store.ts`、`src/links/link-page.ts`、`src/links/link-heading.ts` | store、pages、純粋 | イベントのリンクのページの読み出し(`readEventPage`)、描画、見出し(`headingOf`) |
| `src/events/routes.ts` | routes | `GET /events/:id`。リンクのページへの 301 だけ(F45-AC9) |

## URL の形の判定

リンクの種類は、URL の形で決める(F29-AC1〜F29-AC3、F27-AC86)。判定は、`new URL` で解析したホスト名(小文字、末尾の `.` を除く)とパスで行い、文字列の前方一致では見ない。パスや問い合わせの文字列に `connpass.com` が入っていても、イベントにならない。

| サービス | ホスト名 | パス |
| --- | --- | --- |
| connpass | `connpass.com`、`<グループ>.connpass.com` | `/event/<番号>`(末尾の `/` は任意) |
| Doorkeeper | `<グループ>.doorkeeper.jp` | `/events/<番号>` |
| Luma | `luma.com`、`lu.ma` | `/<文字列>`(1 段だけ。英数字、`-`、`_`) |

- グループは、ホスト名の 1 段(英小文字、数字、`-`)。`a.b.connpass.com` は当たらない。読むのは `groupOf` の 1 か所で、コミュニティの紐づけ用リンク(`src/communities/link-rules.ts`)も同じ関数でグループを読む。
- Luma の、サイトの経路の語(`discover`、`calendar`、`user`、`signin` など)は除く。一覧は `LUMA_SITE_PATHS` の 1 か所に置き、大文字小文字を区別せずに比べる。
- 判定は、種類の既定を決めることと、`/link/…` の URL がイベントの形かを見ること(`src/links/link-address.ts`)に使う。種類を保存する経路(`POST /my/slides/:deck/links/kinds`)を通せば、種類を変えられる。画面からは通さない(F29-AC28、F27-AC90)。

## 鍵へのそろえ方

種類が「イベント」のリンクは、`eventRefOf` でイベントの鍵を持つ。URL の形に関わらず鍵を作る(F29-AC28)。

- `https` にする。ホスト名を小文字にし、末尾の `.` を除く。クエリとフラグメントを捨てる。パスの末尾の `/` を除く。`lu.ma` を `luma.com` にする(F29-AC6)。パスの大文字小文字は変えない。
- サービスの判定の前に、パスの末尾の `/` の連なりを 1 つにそろえる。`https://connpass.com/event/123//` も connpass のイベントになる(そろえないと `web` と判定され、鍵だけが connpass と同じ文字列になる)。
- 番号の先頭の `0` を落とす(`0410635` は `410635`。`0` だけなら `0`)。
- connpass は、グループに関わらず、`https://connpass.com/event/<番号>` を鍵にする(F29-AC7)。Doorkeeper は、グループを含めた URL を鍵にする(番号はグループごとに振られていると扱う)。
- 鍵のほかに、サービス(`connpass`、`doorkeeper`、`luma`、`web`)、サービスの中の番号(Luma は文字列、その他はホスト名とパス)、イベントのホスト名(connpass は `connpass.com`)、元のページへ案内する URL、そのリンクに書かれたホスト名(`linkHost`)を返す。
- イベントの URL(`url`)は、鍵と同じく正規化した形にする。connpass はグループを含まない `https://connpass.com/event/<番号>/` にする。リンクのページが案内する先は、これとは別に、開くたびにリンクから決める(`sourceOf`、`src/links/link-heading.ts`)。
- 書かれたホスト名は、イベントではなく、リンクの側(`related_link_events.host`)に持つ。同じ connpass のイベントに、別のグループの URL を書いたリンクが結びつきうるからである。コミュニティの紐づけ用リンクとの照らし合わせ(作業 C)は、イベントに結びついたリンクのホスト名の集合(`listEventLinkHosts`)で行う。
- 関連リンクの入力は `https:` だけなので、`http` は保存されない。それでも、鍵は `http` と `https` を同じにする。

解析は境界で 1 度だけ行う。`parseLinkInput` が、種類が「イベント」のとき、`eventRefOf` の結果を入力に含める。store は解析済みの値だけを受け取る。

## 表

migration 0054 で、2 つの表を足す。既存の表は作り直さない(第三スコープの指示書の D-04)。

### `events`

| 列 | 内容 |
| --- | --- |
| `id` | サービスが振る番号(`INTEGER PRIMARY KEY AUTOINCREMENT`)。`/events/:id` の転送に使う |
| `key` | 鍵。一意 |
| `service` | `connpass`、`doorkeeper`、`luma`、`web`(CHECK) |
| `ref` | サービスの中の番号(または文字列) |
| `host` | イベントのホスト名。鍵から決まる(connpass は `connpass.com`) |
| `url` | イベントの URL。鍵から決まる(connpass はグループを含まない)。リンクのページの URL は、ここから作る(`linkPagePath`)。connpass の元のページへ案内する先は、ここではなくリンクから決める |
| `name` | イベント名。新しくは書かない(2026-11-27 まで、最初に保存された題名か、直した名前を書いていた)。値のある行は、リンクのページの見出しに最優先で出る(F45-AC11) |
| `named_by`、`named_at` | 名前を直した人と時刻。直していなければ両方 NULL(CHECK で、片方だけを許さない)。書く経路は、いまは無い(F45-AC20) |
| `created_at` | 最初のリンクが入った時刻 |

イベントは消さない。リンクがすべて外れたイベントは、一般公開中のスライドが無いので、`/link/…` は「まだありません」のページになる(F45-AC40)。同じ URL がまた入れば、同じイベントに戻る。

### `related_link_events`

| 列 | 内容 |
| --- | --- |
| `link_id` | 関連リンク。主キー。1 つのリンクは 1 つのイベントにだけ入る |
| `event_id` | イベント |
| `host` | そのリンクの URL に書かれたホスト名(connpass ならグループ)。`listEventLinkHosts` が集合で返す |
| `created_at` | 対応を作った時刻 |

`event_id` に索引を張る。1 本のスライドは、リンクごとに別のイベントに入れる(F29-AC23)。

1 本のスライドは、正規化した形が同じ URL を 2 つ持てない([関連リンクを紐付ける](../features/f27-related-links.md) の F27-AC44。`main` から取り込んだ重複の判定)。connpass のグループ違いや Luma のホスト違いは正規化した形が同じなので、同じスライドに同じイベントの 2 つ目のリンクを足すと「すでに足してあります」で断られ、イベントにも結びつかない(足す文と結びつける文は 1 つの batch で、結びつける文はリンクが入ったときだけ働く)。グループ違いのリンクがイベントに集まるのは、別のスライドのリンクとしてである(F29-AC7、F45-AC42)。

### 種類「イベント」の持ち方

`related_links.kind` は CHECK で `video`、`article`、`other` に縛られている。CHECK を変えるには表の作り直しが要り、第三スコープでは表を作り直さない。そこで、**`related_link_events` に行のあるリンクを、種類「イベント」とする**。そのリンクの `kind` の列には `other` を入れ、読むときは対応の行を優先する。

- 種類を読むのは `listLinks` の 1 か所で、対応の表を結合して `event` を返す。画面、viewer、AI エージェントの道具は、この関数だけを通す。
- 対応の行が無いリンクは、`kind` の列のとおり。

## 対応を作り直す

関連リンクを足す、外す、種類を変えるときに、対応を同じ D1 の batch で作り直す。batch は 1 つのトランザクションなので、リンクと対応がずれた状態は残らない。リンクの URL は変えられない(変えるときは、外して足し直す)。

- **足す**: リンクの `INSERT` が入ったときだけ(`WHERE EXISTS` で確かめる)、イベントを `INSERT ... ON CONFLICT DO NOTHING` で作り、対応を足す(`tieToEvent`)。`events.name` は書かない。上限や持ち主で断られた追加は、イベントを作らない。
- **外す**: 持ち主の確認と同じ条件で、対応を消してからリンクを消す。
- **種類を変える**: 持ち主の確認と同じ条件で、`kind` を書き換え、対応を消す。「イベント」にしたときは、足すときと同じ手順で対応を作る。
- **スライドの削除と退会**: `deletionSteps` が、リンクを消す前に、そのリンクの対応を消す。

## 見出し、ページ、並び

どれも [リンクによる集約の実装設計](f45-link-gathering.md)にある。ここには、イベントに関わる要点だけを書く。

- 見出しは `headingOf` が決める。`events.name`、一般公開中のスライドのリンクのうち最初に保存された題名、サイト名と URL の順である(F45-AC10、F45-AC11)。イベント名を直す画面と経路は、運営にも管理者にも無い(F45-AC20)。`src/events/event-name.ts`、`src/events/event-page.ts`、名前を直す処理は消した。
- `/events/:id` は、一般公開中のスライドが 1 本でもあるイベントを、`linkPagePath(events.url)` へ 301 で転送する。ほかは 404(F45-AC9)。
- イベントの形のリンクは、一般公開中のスライドが 1 本でもあれば、ページが出る(F45-AC3)。ページの発表は、公開日時(`decks.first_published_at`。無い古い行は、公開中の版の `ready_at`)の新しい順で、同じ時刻は URL の名前の順である。作者のみ限定公開、非公開、運営が隠したスライドは出ない(F45-AC14)。
- connpass の元のページへのリンクの先は、そのイベントに結びついた、一般公開中のスライドの関連リンクのうち、最も古いものが書いたグループの URL である(`sourceUrlOf`。F45-AC42)。見る人のミュートやブロックは当てない。

## 1 本の管理

「関連リンク」の枠に、種類の選択は無い(F27-AC87)。関連リンクの行の下に、どこに並ぶかを 1 文で出し(F29-AC29。`linkPlacesOf`、`src/decks/links-frame.ts`)、「このスライドが並ぶページ」の枠に、ページの出ているリンクを並べる(F29-AC30。`src/decks/placed-pages-frame.ts`)。条件と文は、[リンクによる集約の実装設計](f45-link-gathering.md)の「画面の言葉」にある。

## 外へ取りに行かない

リンクを足すときも、リンクのページを出すときも、外へ通信しない(F45-AC19、F27-AC42)。テストで `fetch` を差し替え、呼ばれないことを確かめる。
