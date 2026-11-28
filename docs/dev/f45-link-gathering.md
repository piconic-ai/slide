# リンクによる集約の実装設計

[同じリンクでスライドが集まる](../features/f45-link-gathering.md)の設計。同じ URL を関連リンクに持つスライドを、`/link/<URL>` の 1 つのページに並べる。実装は 10 本の PR に分ける(計画は [issue #737](https://github.com/piconic-ai/slide/issues/737))。この文書は PR ごとに書き足す。いま実装済みなのは、link1 の純粋な関数、link2 の経路(イベントの形のリンクだけがページになる)、link3 の `/events/:id` の転送とアプリの中のリンク先、link4 のページの見出しと頭、名前を直す経路の撤去、link5 の画面の言葉(コミュニティの「リンク」のタブ、1 本の管理の文と枠)である。イベントでないリンクのページと列は、まだ無い。節ごとに、実装済みか、どの PR で実装するかを書く。

## ファイルの分担

| ファイル | 層 | 役割 | 状態 |
| --- | --- | --- | --- |
| `src/links/url-rules.ts` | 純粋 | サイトごとの規則。集めるときだけ除くクエリ(`gatheredWithout`) | link1 で実装済み |
| `src/links/normalize.ts` | 純粋 | 比べる形(`normalizedUrlOf`)。中身は、除く名前を足せる `comparedUrlOf` | link1 で実装済み(出力は変えていない) |
| `src/links/gather.ts` | 純粋 | 集める鍵(`gatherKeyOf`)、書かれたホスト名(`linkHostOf`) | link1 で実装済み |
| `src/links/link-address.ts` | 純粋 | `/link/` の後ろの読み方(`parseLinkPath`)、引く鍵と正規の形(`linkTargetOf`)、ページの path(`linkPagePath`)、イベントを引く鍵の候補(`eventKeysOf`) | link1、link2 で実装済み |
| `src/links/link-page-routes.ts` | routes | `GET /link/*`、`GET /link` | link2 で実装済み(イベントだけ) |
| `src/links/link-page-store.ts` | store | 鍵からイベントを引く(`findEventIdsByKey`)、Luma の番号から名前への対応(`findAliasedKey`)、イベントのページの読み出し(`readEventPage`)、番号から転送先を引く(`findShownEventUrl`)、一覧の行に最初の題名を足す SQL(`firstPublicTitle`)、1 本のスライドの関連リンクのうちページの出ているもの(`listShownLinks`) | link2〜link5 で実装済み。イベントでないリンクは link7 |
| `src/links/link-missing-page.ts` | pages | 「まだありません」のページ(F45-AC12、F45-AC29) | link2 で実装済み |
| `public/share.js` | ブラウザー | フッターの言語の切り替えの行き先を、`/link/…` では `/link?to=…` にする | link2 で実装済み |
| `src/links/link-page.ts` | pages | ページ(`linkPageBody`、`linkPageTitle`) | link4 で実装済み(`src/events/event-page.ts` を移した) |
| `src/links/link-heading.ts` | 純粋 | 見出し(`headingOf`)、サイト名(`siteNameOf`)、元のページへのリンクの文と行き先(`sourceLinkTextOf`、`sourceOf`) | link4 で実装済み(`src/events/event-name.ts` を移した)。ページを出す条件(`pageShown`)は link7 |
| `src/events/routes.ts` | routes | `GET /events/:id` の 301 | link3 で実装済み |
| `src/events/store.ts` | store | 1 本のスライドの入っているイベント(`listDeckEvents`) | link3 で、ページの読み出しを `src/links/link-page-store.ts` へ移した。link4 で `renameEvent` を消した |

`src/links/link-address.ts` は、イベントの形の判定と鍵に `src/events/event-url.ts` の `isEventAddress`、`eventRefOf` を使う。どちらも純粋なファイルで、`src/links/kind.ts` がすでに同じ向きで読み込んでいる。

## 受け付ける書き方と正規の形

正規の形は、scheme を省いた `/link/<ホスト名><パス>[?クエリ]`(F45-AC31)。`parseLinkPath(rest)` は、`/link/` の後ろ(path とクエリ。復号していないもの)を、次の順で読む。

1. `https%3A`、`http%3A` で始まる(大文字小文字を問わない)なら、全体を `decodeURIComponent` で 1 度だけ復号する。復号できなければ断る。
2. 空白と制御文字を含むものは断る(関連リンクの入力の `parseHttpsUrl` と同じ)。
3. 先頭の `https://`、`http://`、`https:/`、`https:` を外す(大文字小文字を問わない)。
4. 残りが別の scheme の形(`javascript:`、`data:`、`mailto:`、`ftp:`)なら断る。`example.com:8443/a` のような、ホスト名とポートは通す。
5. `https://` を付けて `new URL` で読む。読めない、ユーザー名かパスワードがある、ホスト名に空の区間がある(`.`、`example.com..`)、2000 文字を超える、のどれかなら断る(F45-AC13)。2000 文字は、関連リンクの URL の上限と同じである。

断るときは理由を返さない。入れられた文字列を、画面にも転送先にも出さないためである。

`linkTargetOf(url)` は、読めた URL から次の 4 つを返す。

| 項目 | 内容 |
| --- | --- |
| `rest` | 正規の形の、`/link/` の後ろ。鍵から `https://` を除いたもの |
| `eventShaped` | connpass、Doorkeeper、Luma のイベントの形か |
| `eventKey` | 先にイベントを引く鍵。引かないときは `null` |
| `gatherKey` | イベントに当たらなかったときに引く、集める鍵 |

- 鍵は、イベントの形の URL ではイベントの鍵(`eventRefOf` の `key`)、ほかは集める鍵である。1 度そろえた結果が別の形になることがあるので、変わらなくなるまで繰り返す(最大 8 回)。たとえば `a.b.connpass.com/event/007` は、比べる形にすると `connpass.com/event/007` になり、これはイベントの形なので `connpass.com/event/7` になる。`www.` は、1 度に 1 つしか外れない。繰り返すので、正規の形をもう 1 度読んでも同じ形になり、転送は 1 回で終わる。
- `eventKey` は F45-AC35 のとおりに決める。イベントの形なら、クエリを除いたイベントの鍵。ほかのサイトは、クエリが無いときだけ、そのホスト名とパスのイベントの鍵(`https://example.com/conf`)。クエリがあれば `null` で、集める鍵だけで引く。追跡用のクエリは、鍵を作る前に除かれるので、クエリに数えない。
- `#` から後ろは、`new URL` が分け、鍵に入らない(F45-AC32)。ブラウザーは送らないが、全体をエンコードした書き方の中の `%23` は `#` として読まれ、同じく除かれる。path の中の `%23` は、path の一部のまま残る。
- `%41` と `A`、`%2F` と `/` は、別の URL として扱う(復号しない)。IDN は punycode、日本語の path とクエリは `%` の形になる(`new URL` の書き方)。
- `rest` は必ずホスト名で始まる。転送先の `/link/<rest>` が `//` で始まる外への転送にならない。

届き方を確かめるテストは `src/links/link-address.pure.test.ts` にある。

### 計画との違い

- 計画は「イベントの形ならイベントの鍵、ほかは集める鍵」の 1 度で正規の形を決めていた。上の 2 つの例で、正規の形を読み直すと別の形になるので、繰り返す形にした。
- Luma は、イベントの鍵がパスの大文字小文字を残し、比べる形は小文字にする(F27-AC71、F27-AC72)。`luma.com/AbC` の正規の形は `luma.com/AbC` のまま、`www.luma.com/AbC` は、比べる形を経るので `luma.com/abc` になる。
- ほかのサイトのイベント(道具で種類を「イベント」にした URL)の鍵は、`www.` を残す。正規の形は `www.` を除くので、イベントを引くときは、`www.` の無い鍵と有る鍵の両方を候補にする(`eventKeysOf`)。`https://www.example.com/conf` をイベントにしたものは、`/link/example.com/conf` で当たる。`www.` 有りと無しの両方がイベントになっているときは、無いほうを先に見て、一般公開中のスライドのあるほうのページが出る(2 つは 1 つのページにまとまらない)。この扱いは仕様に書かれていない(F45-AC35 は「ホスト名とパスが一致するとき」)ので、依頼者に確かめる。

## 集める鍵

`gatherKeyOf(href)` は、比べる形(`normalizedUrlOf`)から、サイトの規則の `gatheredWithout` のクエリを除いたものである。YouTube は `t`、ニコニコ動画は `from`(F45-AC5)。`si`、`feature`、`pp`、追跡用のクエリ、`www.`、末尾の `/` は、比べる形がすでに除いている(F45-AC23)。1 本のスライドの中の重複の判定(F27-AC44)は、これまでどおり比べる形で行い、開始時刻を除かない。

`linkHostOf(href)` は、URL に書かれたホスト名(小文字、末尾の `.` なし、ポートなし)。`www.` は残す。コミュニティの紐づけ用リンクと、書かれたとおりのホスト名で照らすためである(F30-AC65)。

規則(`src/links/url-rules.ts`)を変えると、すでに保存した鍵と合わなくなる。規則を変える PR は、`gather_key` を作り直す migration を足す。

## データ(link6 で実装する)

いまは列が無く、保存もしていない。link6 の migration(0071 の予定)で、`related_links` に NULL を許す列を 2 つ足す予定である。

| 列 | 内容 |
| --- | --- |
| `gather_key` | `gatherKeyOf` の結果。索引 `related_links_gather_key` |
| `link_host` | `linkHostOf` の結果。索引 `related_links_link_host` |

すでにある行は、migration の SQL で `normalized_url` と `url` から埋める。SQL は規則を写すので、`gatherKeyOf`、`linkHostOf` と比べるテストで守る。1 つ前の版のコードが足した行は NULL になり、読む側は「集まらない」と扱う。`normalized_url`、イベントの表(`events`、`related_link_events`)と鍵は変えない。

## 経路(link2 で実装済み)

`GET /link/*`(`src/links/link-page-routes.ts`)は、次の順で答える(F45-AC13 の順)。

1. `new URL(c.req.url)` の `pathname` と `search` から、`/link/` の後ろを取り、`parseLinkPath` で読む。断られたものは、共通の 404 のページ(`errorPage`)で答える。入れられた文字列は、本文にも href にも出さない。フッターの言語の切り替えは `/link?lang=…` を指す。
2. 届いた書き方が正規の形と違えば、`/link/<正規の形>` へ 301(F45-AC31)。
3. イベントの形の URL で、`luma_event_aliases` に対応があれば、名前の URL の `/link/…` へ 301(F45-AC26)。
4. `eventKeysOf` の鍵でイベントを引き、一般公開中のスライドがあれば、イベントのページを 200 で出す(`readEventPage`、`eventPageBody`)。`Link`(hreflang)は付けない。`?lang=` がページを指さないためである。
5. どれにも当たらなければ、「まだありません」のページを 404 で出す(F45-AC12)。URL は `<p>` の文字で出し、リンクにしない(F45-AC29)。イベントでないリンクは、link7 まで、すべてここになる。

- 404 は、どちらも `screen_error` として数える(F40-AC14。`screen` は `/link/*`、`/link`)。
- 検索: `isIndexablePath` は `/link/` で始まる path を載せてよいとする(F45-AC36)。`noindexPrivate` は 200 と 304 だけを通すので、404 と 301 には `X-Robots-Tag: noindex, nofollow` が付く。
- 予約語: `link` を `ROUTE_HANDLES` に足した(F30-AC74)。`events` は、経路が残るので、残している。

## `/events/:id` の転送と、ページを出す条件(link3 で実装済み)

`GET /events/:id`(`src/events/routes.ts`)は、番号からイベントを引き(`findShownEventUrl`)、一般公開中のスライドが 1 本でもあれば、`linkPagePath(events.url)` へ 301 で転送する(F45-AC9)。数字でない番号、無い番号、一般公開中のスライドの無いイベントは、共通の 404。見る人を当てないので、だれが開いても同じ応答になる。クエリ(`?lang=` を含む)は、転送先に持ち越さない。

- `events.url` は、`eventRefOf` が作る `https://` の URL である。`linkPagePath` が正規の形にそろえるので、転送は 1 回で終わる。Luma の番号のイベントで、名前との対応があるものだけ、`/link/…` の側でもう 1 回転送される(F45-AC26)。
- ほかのサイトのイベントで、`www.` 有りと無しの両方がイベントになっているとき、`www.` 有りのイベントの番号は、`www.` の無い path へ転送され、無いほうに一般公開中のスライドがあれば、そちらのページが出る(上の「計画との違い」と同じ扱い)。

`readEventPage`(`src/links/link-page-store.ts`)は、問い合わせを 2 つに分ける。

| 問い合わせ | 見る人のミュートとブロック | 決めるもの |
| --- | --- | --- |
| 一般公開中のスライドのリンク(保存の古い順) | 当てない | ページを出すかどうか、connpass の元のページへのリンクのグループ(最初のリンク)、「コミュニティはまだありません」に使うホスト名の集合 |
| 一般公開中のスライド(公開の新しい順、同じ時刻は URL の名前の順) | 当てる | 一覧と本数 |

- 1 つめが 0 行なら `null` で、経路は「まだありません」のページを出す。ページが出るかどうかは、見る人によらない(F45-AC15)。ブロックやミュートで一覧が 0 本になっても、ページは 200 で、本数は 0 になる。link2 までは、見る人を当てた一覧が 0 本だと 404 だった。
- 「一般公開中」は、どちらも `publicTalks` の条件である: 公開の版が `ready`、運営が非表示にしておらず、作者が停止中でない(`notHidden`)、作者の `accounts` の行がある(F45-AC14)。
- `listListedEvents`(イベントの一覧)は、テストだけが使っていたので消した。F45 に、イベントの一覧は無い。

アプリの中のイベントへのリンクは、`linkPagePath(event.url)` で作る。`DeckEvent`、`ViewerEvent`、`CommunityEvent` に `url`(`events.url`)を足した。

| 場所 | ファイル |
| --- | --- |
| viewer のイベントの行(F24-AC51)、「イベントを見る」(F24-AC52) | `src/share/viewer-events-frame.ts` の `eventHref`、`src/share/viewer-recommendations-frame.ts` |
| 1 本の管理の「このスライドが並ぶページ」(link5 で、「発表したイベント」から改めた) | `src/decks/placed-pages-frame.ts` |
| コミュニティのリンクのタブの見出しと「ほか n 本」 | `src/communities/community-page.ts` |

`add_related_link` の説明(`src/mcp/tools.ts`)は、イベントの URL を入れると、そのイベントのリンクのページ(`/link/` と、`https://` を除いた URL)にスライドが並ぶ、と書く(F23-AC53)。

## 見出しと頭(link4 で実装済み)

見出しは `headingOf`(`src/links/link-heading.ts`)が決める。順に、`events.name`、一般公開中のスライドのリンクのうち最初に保存された題名(`firstTitle`)、サイト名と URL(「connpass https://connpass.com/event/410635/」)である。言語によらない。サイト名は、connpass、Doorkeeper、Luma はサービス名、ほかはホスト名(`siteNameOf`)。URL は `events.url` である。

- `events.name` は、新しく書かない。`tieToEvent`(`src/links/store.ts`)から、最初の題名を `events.name` に書く文を外した。下書きのスライドの題名が見出しに出ないようにするためである(F45-AC10)。列とすでにある値は残し、最優先で見出しに出す(F45-AC11)。スキーマは変えていないので、1 つ前の版のコードは、そのまま動く(1 つ前の版が動いている間に足されたリンクは、`events.name` に題名を書く)。
- 最初の題名は、読む場所が 2 つある。ページは、`readEventPage` の 1 つめの問い合わせ(一般公開中のスライドのリンク、保存の古い順。`related_link_events.created_at`、同じ時刻は rowid の順)の行から、題名のある最初のものを取る。一覧(`listDeckEvents`、コミュニティのイベントのタブの `listTalkRows`)は、同じ条件を相関サブクエリにした `firstPublicTitle` を select に足す。2 つは同じ条件を別々に書いているので、`src/links/link-page.test.ts`、`src/share/viewer-events.test.ts` などの画面のテストで、両方の結果を確かめている。
- `headingOf` を使う場所: リンクのページ、viewer のイベントの行と「(見出し) のほかの発表」、1 本の管理の「このスライドが並ぶページ」、コミュニティのリンクのタブ。題名の無いイベントは、これまでの「connpass のイベント 410635」ではなく、サイト名と URL で出る。

元のページへのリンク先は `sourceOf` が決める(F45-AC25)。イベントは、connpass なら最初のリンクが書いたグループの URL(`sourceUrlOf`)、ほかは `events.url`。イベントでないリンク(`kind: 'link'`)は、最初のリンクの整えた URL で、link7 から使う。リンクには `rel="noopener nofollow ugc"` と `linkCheckTrigger()` を付け、本文の末尾に `linkCheckPrompt(lang)` を置く。確認の画面は、すべてのページが読み込む `/share.js` が開く(F45-AC30)。

ページの頭は、コミュニティに入っていれば、カバー画像、ロゴ、名前(コミュニティのページへのリンク)を出す。入っていなければ、どれも出さない(F45-AC17)。番号から色を選ぶ既定の模様(`defaultEventCover`、`colorOfNumber`)は消した。本数の見出しは「スライド n 本」である(F45-AC16)。「このグループのコミュニティはまだありません」と「作る」は、これまでどおり出す(F45-AC27)。

### 名前を直す経路の撤去(F45-AC20)

次のものを消した。どの経路も、いまは 404 になる。

| 消したもの | 場所 |
| --- | --- |
| 運営の `POST /events/rename` と、運営のページの「イベント名を直す」のフォーム | `src/operator/routes.ts`、`src/operator/pages.ts` |
| 管理者の `POST /communities/:id/events/:event/rename` と、コミュニティの編集のページの「イベント名」の枠 | `src/communities/edit-routes.ts`、`src/communities/edit-page.ts` |
| `renameEvent`、`listEventAdmins`、`listRenamableEvents`、`src/events/event-rename.ts` | `src/events/`、`src/communities/` |
| ヘルプの記事「イベント名を直す」(`community/event-names`)と、ほかの記事の中の「イベント名の修正」 | `src/help/articles/community/` |

`events.named_by`、`events.named_at` の列は残る(書く経路は無い)。

## 画面の言葉(link5 で実装済み)

括りの名前としての「イベント」を、画面から外した。この時点で並ぶのは、イベントの形のリンクだけである。イベントでないリンクは、link7、link9 で足す。関連リンクの種類名「イベント」と、viewer の「発表したイベント」「イベントを見る」は変えていない。

### コミュニティのタブ

タブは「リンク n」「スライド n」「フォロワー n」(英語は Links、Slides、Followers。F30-AC67)。リンクのタブが空のときは「まだリンクはありません。」(No links yet.)を出す。1 件ごとの見出し、「スライド n 本」、横に送る枠(6 本までと「ほか n 本」)は、link3、link4 のままである(F30-AC68)。

- タブの URL は変えていない。リンクのタブは `/@ハンドル`、ほかは `/@ハンドル/slides`、`/@ハンドル/followers` で、タブをクエリで選ぶ URL は無い。
- コードの中のタブの名前は `'events'` から `'links'` に替えた(`COMMUNITY_TABS`、`CommunityTabView`)。読み出し(`readCommunityTalks` の `events`)、型(`CommunityEvent`)、CSS のクラス(`community-event`)は、イベントの名前のまま残している。イベントでないリンクを足す link9 で替える。

### 1 本の管理の文と枠

`listShownLinks(db, deckId)`(`src/links/link-page-store.ts`)は、そのスライドの関連リンクのうち、リンクのページが出ているものを、リンクの id とイベントの番号で返す。いまの条件は、イベントのリンクで、そのイベントに一般公開中のスライドが 1 本以上あること(`readEventPage` と同じ `publicTalks`。見る人を当てない)。そのスライド自身が下書きでも、ほかのスライドでページが出ていれば、含まれる。link7 で、イベントでないリンクに広げる。

関連リンクの行の下の文は、`linkPlacesOf`(`src/decks/links-frame.ts`)が決める(F29-AC29)。

| 行 | 文 |
| --- | --- |
| イベントがコミュニティに入っている(`listDeckEvents` の `community`) | 「(コミュニティ名) のページに並びます。」 |
| コミュニティに入らず、`listShownLinks` に含まれる | 「リンクのページに並びます。」 |
| どちらでもない(イベントでないリンク、一般公開中のスライドの無いイベント) | 出さない |

- コミュニティは、これまでどおり `listEventCommunities` が決める。connpass などは、一般公開中のスライドのリンクのホスト名が紐づけ用リンクと合うこと、Luma は、カレンダーの配信にあることである。下書きだけが持つ connpass のリンクは、コミュニティに入らず、ページも出ないので、文が出ない。Luma のカレンダーにあるイベントは、一般公開中のスライドが無くても、コミュニティの文が出る。

「このスライドが並ぶページ」の枠(`src/decks/placed-pages-frame.ts`。`src/decks/events-frame.ts` を移した)は、`listDeckEvents` のイベントのうち、`listShownLinks` に含まれるものを、関連リンクの順に 1 度ずつ並べる(F29-AC30)。見出し(`headingOf`)はリンクのページへのリンクで、コミュニティに入っていれば、その名前を添える。並ぶページが無いときは「並ぶページは、関連リンクから決まります。いまは、並ぶページがありません。」を出す。枠の名前(`data-deck-frame`、`id`)は `events` から `placed-pages` に替えた。

幅 375px ではみ出さないこと(F29-AC31)は、`src/links/link-page.browser.test.ts` が、長い名前のリンクを持つスライドの管理のページで確かめる。

ヘルプは、画面の言葉の引用だけを直した(`community/list-event-talks`)。記事の書き直しは link10。

## 言語(link2 で実装済み)

`/link/…` のクエリは、`lang` を含めて、すべてリンク先の URL のものとして読む(F45-AC33)。`src/site/lang.ts` は、path が `/link/` で始まるとき、クエリを読まない検出(cookie、`Accept-Language` の順)を使い、cookie を書かない。[画面の言語](i18n.md)にも書いた。

フッターの切り替えは `/link?to=<正規の path>&lang=…` を経由して戻る(F45-AC34)。

- サーバーは、`pageShell` に渡すフッターの URL を `/link?to=…` にする。`langHref` と `siteFooter` は変えていない。
- `public/share.js` は、フッターの切り替えを押したとき、行き先を「いま開いているページに `lang` を付けたもの」に書き換える。`/link/…` では、これが `lang` をリンク先のクエリに足してしまう(別の URL のページになる)ので、`/link?to=<いまの path とクエリ>&lang=…` に書き換える。
- `GET /link` は、言語の middleware が `?lang=` を cookie に書いたあと、`to` を `/link/` の後ろとして `parseLinkPath` で読み、その正規の path へ 302 で戻す。`to` が `/link/` で始まらない、または読めなければ、共通の 404。転送先は必ず `/link/<ホスト名>` で始まるので、ほかのサイトへは転送されない(`//evil.example`、`/link/../…`、`\\` は 404 か、このサイトの `/link/evil.example/…` になる)。
- Hono では `/link/*` が `/link` にも当たるので、`/link` を先に登録している。

## Hono での届き方(確かめた結果)

2026-11-27 に、Hono 4 の `app.request()` で `/link/*` の経路を作り、`c.req.path` と、`new URL(c.req.url)` の `pathname`、`search` を見た(Node.js 22。workerd と本番の Cloudflare では、この PR では確かめていない)。

| 送った path | `pathname` | `search` | `c.req.path` |
| --- | --- | --- | --- |
| `/link/https://example.com/a?b=1&lang=en` | `/link/https://example.com/a` | `?b=1&lang=en` | `pathname` と同じ |
| `/link/example.com//a` | `/link/example.com//a` | 空 | `pathname` と同じ |
| `/link/https%3A%2F%2Fexample.com%2Fa%3Fb%3D1` | 送ったとおり | 空 | `pathname` と同じ |
| `/link/example.com/a%2Fb?x=%E3%81%82` | `/link/example.com/a%2Fb` | `?x=%E3%81%82` | `pathname` と同じ |
| `/link/example.com/%E3%81%82` | 送ったとおり | 空 | `/link/example.com/あ`(復号される) |
| `/link/EXAMPLE.com/A%41?` | `/link/EXAMPLE.com/A%41` | 空 | `/link/EXAMPLE.com/AA`(復号される) |
| `/link/example.com/a/../b` | `/link/example.com/b` | 空 | `pathname` と同じ |
| `/link/example.com/a#frag` | `/link/example.com/a` | 空 | `pathname` と同じ |

- `//`、`%2F`、`%3A`、クエリは、書かれたとおりに届く。`c.req.path` は `%E3%81%82` や `%41` を復号するので、経路は `pathname` と `search` から `rest` を作る。
- `..` と `#` は、リクエストを作る側(`Request` の URL の解析)が、送る前に畳む。サーバーには届かない。
- `/link/*` は、後ろの無い `/link` にも当たる(`/link/*` を先に登録すると、`/link` もそのハンドラーに届いた)。link2 では、`GET /link` を先に登録した。`/link/` は、空の `rest` として届く。

### ローカルの workerd とブラウザーでの届き方(link2 で確かめた結果)

2026-11-27 に、`wrangler dev --local`(workerd)へ `curl --path-as-is` で送り、`/link/https://connpass.com/event/410635/?utm_source=x`、`/link/https:/connpass.com/…`、`/link/https%3A%2F%2Fconnpass.com%2F…` の 3 通りが、どれも `Location: /link/connpass.com/event/410635` の 301 になることを確かめた。Chromium は、アドレスに書いた `//` を、そのまま送った(`src/links/link-page.browser.test.ts`)。本番の Cloudflare が `//` をまとめるかは、確かめていない。まとめられても、`https:/` の形として読める。

## PR の積み方

| PR | 中身 |
| --- | --- |
| link1 | この文書、`gatheredWithout`、純粋な `gather.ts`、`link-address.ts` |
| link2 | `/link/*` の経路(イベントだけ)、「まだありません」のページ、言語、検索に載せる条件 |
| link3 | `/events/:id` の 301、アプリの中のリンク先、見る人によらない判定、テストの移動(`src/links/link-page.test.ts`) |
| link4 | 見出しと頭、元のページへのリンクの確認の画面、名前を直す経路の撤去、幅 375px のテスト(`src/links/link-page.browser.test.ts`) |
| link5 | コミュニティのタブ「リンク」、1 本の管理の文と枠 |
| link6 | 列の追加と埋め戻し(migration) |
| link7 | イベントでないリンクのページ、viewer の行からのリンク |
| link8、link9 | コミュニティへの所属を種類を問わないリンクに広げる、お知らせ、タブとページの頭 |
| link10 | ヘルプの記事、ほかの設計の文書の書き直し |
