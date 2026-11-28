# リンクによる集約の実装設計

[同じリンクでスライドが集まる](../features/f45-link-gathering.md)の設計。同じ URL を関連リンクに持つスライドを、`/link/<URL>` の 1 つのページに並べる。実装は 10 本の PR に分ける(計画は [issue #737](https://github.com/piconic-ai/slide/issues/737))。この文書は PR ごとに書き足す。いま実装済みなのは、link1 の純粋な関数、link2 の経路(イベントの形のリンクだけがページになる)、link3 の `/events/:id` の転送とアプリの中のリンク先、link4 のページの見出しと頭、名前を直す経路の撤去、link5 の画面の言葉(コミュニティの「リンク」のタブ、1 本の管理の文と枠)、link6 の列(`gather_key`、`link_host`)、link7 のイベントでないリンクのページと viewer の行からのリンク、link8 の種類を問わないコミュニティへの所属と、そのお知らせ、フォローの新着である。コミュニティの「リンク」のタブは、まだイベントのリンクだけを並べる(link9)。節ごとに、実装済みか、どの PR で実装するかを書く。

## ファイルの分担

| ファイル | 層 | 役割 | 状態 |
| --- | --- | --- | --- |
| `src/links/url-rules.ts` | 純粋 | サイトごとの規則。集めるときだけ除くクエリ(`gatheredWithout`) | link1 で実装済み |
| `src/links/normalize.ts` | 純粋 | 比べる形(`normalizedUrlOf`)。中身は、除く名前を足せる `comparedUrlOf` | link1 で実装済み(出力は変えていない) |
| `src/links/gather.ts` | 純粋 | 集める鍵(`gatherKeyOf`)、書かれたホスト名(`linkHostOf`) | link1 で実装済み |
| `src/links/link-address.ts` | 純粋 | `/link/` の後ろの読み方(`parseLinkPath`)、引く鍵と正規の形(`linkTargetOf`)、ページの path(`linkPagePath`)、イベントを引く鍵の候補(`eventKeysOf`) | link1、link2 で実装済み |
| `src/links/link-page-routes.ts` | routes | `GET /link/*`、`GET /link` | link2 で実装済み(イベントだけ) |
| `src/links/link-page-store.ts` | store | 鍵からイベントを引く(`findEventIdsByKey`)、Luma の番号から名前への対応(`findAliasedKey`)、ページの読み出し(`readLinkPage`。イベントは `readEventPage`、イベントでないリンクは `readGatheredPage`)、番号から転送先を引く(`findShownEventUrl`)、一覧の行に最初の題名を足す SQL(`firstPublicTitle`)、1 本のスライドの関連リンクのうちページの出ているもの(`listShownLinks`) | link2〜link5、link7、link8 で実装済み |
| `src/links/link-missing-page.ts` | pages | 「まだありません」のページ(F45-AC12、F45-AC29) | link2 で実装済み |
| `public/share.js` | ブラウザー | フッターの言語の切り替えの行き先を、`/link/…` では `/link?to=…` にする | link2 で実装済み |
| `src/links/link-page.ts` | pages | ページ(`linkPageBody`、`linkPageTitle`) | link4 で実装済み(`src/events/event-page.ts` を移した) |
| `src/links/link-heading.ts` | 純粋 | 見出し(`headingOf`)、サイト名(`siteNameOf`)、元のページへのリンクの文と行き先(`sourceLinkTextOf`、`sourceOf`) | link4 で実装済み(`src/events/event-name.ts` を移した)。ページを出す条件(`pageShown`)は link7 で実装済み |
| `src/events/routes.ts` | routes | `GET /events/:id` の 301 | link3 で実装済み |
| `src/events/store.ts` | store | 1 本のスライドの入っているイベント(`listDeckEvents`) | link3 で、ページの読み出しを `src/links/link-page-store.ts` へ移した。link4 で `renameEvent` を消した |

| `src/communities/store.ts` | store | コミュニティに入るリンクとスライドの条件(`linkInCommunity`、`deckInCommunity`)。イベントだけの条件(`inCommunity`)も残る | link8 で実装済み |
| `src/communities/event-communities-store.ts` | store | イベントでないリンクのページに出すコミュニティ(`findHostCommunity`) | link8 で実装済み |

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

## データ(link6 で実装済み)

migration `0071_related_link_gather_key.sql` が、`related_links` に NULL を許す列を 2 つと、索引を 2 つ足す。`normalized_url`、1 本のスライドの中の重複の判定、イベントの表(`events`、`related_link_events`)と鍵は変えていない。

| 列 | 内容 | 索引 |
| --- | --- | --- |
| `gather_key` | `gatherKeyOf` の結果 | `related_links_gather_key` |
| `link_host` | `linkHostOf` の結果 | `related_links_link_host` |

- 新しい行は、`addLink`(`src/links/store.ts`)が、リンクを足す INSERT の中で 2 つの列を書く。行を作る経路は、ほかに無い。URL を書き換える経路も無いので、行ができたあとに鍵がずれることはない。
- すでにある行は、migration の SQL が埋める。`gather_key` は、`normalized_url` のホスト名(ポートを除く)が YouTube の規則のもの(`youtube.com`、`m.youtube.com`、`youtu.be`)なら `t` を、ニコニコ動画の規則のもの(`nicovideo.jp`、`sp.nicovideo.jp`、`nico.ms`)なら `from` を、クエリから除いたものである。除いて何も残らなければ `?` も落とす。ほかの行は `normalized_url` と同じ値になる。`link_host` は、`url` の `https://` から最初の `/` までのうち、ポートと末尾の `.` を除いたものである。
- 規則がホスト名を書き換えるとき、書き換えた先は同じ規則のホスト名である(`youtu.be` は `youtube.com` になる)。そのため、SQL は `normalized_url` のホスト名だけで規則を選べる。`gatherKeyOf` は規則を当てる前に `t`、`from` を除き、SQL は当てた後の形から除くが、どちらの規則もこの 2 つの名前を読まないので、結果は同じになる。
- migration は、列と索引を足し、足した列に値を書くだけである。`DROP`、`DELETE`、表の作り直しは無く、すでにある列の値は変えない。

### 規則を変えるとき

SQL は `src/links/url-rules.ts` の規則を写したものである。`gatheredWithout` か、比べる形の規則を変える PR は、すでにある行の `gather_key` を作り直す migration を足す(比べる形の規則を変えるときは、`normalized_url` を作り直したあとに)。`src/db/related-link-gather-migration.test.ts` が番人で、0070 までを当てた D1 に、いろいろな書き方の URL の行を入れ、残りの migration をすべて当てて、すべての行の `gather_key` が `gatherKeyOf(url)` と、`link_host` が `linkHostOf(url)` と同じことを確かめる。規則だけを変えて migration を足し忘れると、このテストが落ちる。

### NULL の行

2 つの列が NULL になる行は、次の 2 通りである。

| 行 | `gather_key` | `link_host` |
| --- | --- | --- |
| 0071 を適用してから新しい Worker が動くまでの間(と、Worker を 1 つ前の版に戻している間)に足された行 | NULL | NULL |
| `normalized_url` が NULL の行(0051 より前の Worker が足した行) | NULL | 値が入る |

読む側は、NULL を「集まらない」と扱う。`gather_key = ?` の条件に NULL の行は当たらないので、そのリンクは、ページにも、ページを出す条件の数にも入らない。NULL の行は、次に `gather_key` を作り直す migration で埋まる。それまでに埋めたいときは、`gather_key IS NULL` の行だけを埋める migration を足す。本番に NULL の行が何行あるかは、確かめていない。

## 経路(link2 で実装済み)

`GET /link/*`(`src/links/link-page-routes.ts`)は、次の順で答える(F45-AC13 の順)。

1. `new URL(c.req.url)` の `pathname` と `search` から、`/link/` の後ろを取り、`parseLinkPath` で読む。断られたものは、共通の 404 のページ(`errorPage`)で答える。入れられた文字列は、本文にも href にも出さない。フッターの言語の切り替えは `/link?lang=…` を指す。
2. 届いた書き方が正規の形と違えば、`/link/<正規の形>` へ 301(F45-AC31)。
3. イベントの形の URL で、`luma_event_aliases` に対応があれば、名前の URL の `/link/…` へ 301(F45-AC26)。
4. `readLinkPage` でページを読む。`eventKeysOf` の鍵でイベントを引き、一般公開中のスライドがあれば、イベントのページを 200 で出す。無ければ、集める鍵で、イベントでないリンクを引く(下の「イベントでないリンクのページ」)。`Link`(hreflang)は付けない。`?lang=` がページを指さないためである。
5. どれにも当たらなければ、「まだありません」のページを 404 で出す(F45-AC12)。URL は `<p>` の文字で出し、リンクにしない(F45-AC29)。

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

アプリの中のイベントへのリンクは、`linkPagePath(event.url)` で作る。`DeckEvent`、`ViewerEvent`、`CommunityEvent`(link9 から `CommunityLink`)に `url`(`events.url`)を足した。

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
- コードの中のタブの名前は `'events'` から `'links'` に替えた(`COMMUNITY_TABS`、`CommunityTabView`)。読み出し(`readCommunityTalks` の `links`)と型(`CommunityLink`)は、link9 で替えた。CSS のクラス(`community-event`)は、イベントの名前のまま残している。

### 1 本の管理の文と枠

`listShownLinks(db, deckId)`(`src/links/link-page-store.ts`)は、そのスライドの関連リンクのうち、リンクのページが出ているものを、リンクの id とイベントの番号で返す。いまの条件は、イベントのリンクで、そのイベントに一般公開中のスライドが 1 本以上あること(`readEventPage` と同じ `publicTalks`。見る人を当てない)。そのスライド自身が下書きでも、ほかのスライドでページが出ていれば、含まれる。link7 で、イベントでないリンクに広げた(下の「イベントでないリンクのページ」)。

関連リンクの行の下の文は、`linkPlacesOf`(`src/decks/links-frame.ts`)が決める(F29-AC29)。

| 行 | 文 |
| --- | --- |
| イベントがコミュニティに入っている(`listDeckEvents` の `community`) | 「(コミュニティ名) のページに並びます。」 |
| コミュニティに入らず、`listShownLinks` に含まれる | 「リンクのページに並びます。」 |
| どちらでもない(ページの出ていないリンク、一般公開中のスライドの無いイベント) | 出さない |

- コミュニティは、これまでどおり `listEventCommunities` が決める。connpass などは、一般公開中のスライドのリンクのホスト名が紐づけ用リンクと合うこと、Luma は、カレンダーの配信にあることである。下書きだけが持つ connpass のリンクは、コミュニティに入らず、ページも出ないので、文が出ない。Luma のカレンダーにあるイベントは、一般公開中のスライドが無くても、コミュニティの文が出る。

「このスライドが並ぶページ」の枠(`src/decks/placed-pages-frame.ts`。`src/decks/events-frame.ts` を移した)は、`listDeckEvents` のイベントのうち、`listShownLinks` に含まれるものを、関連リンクの順に 1 度ずつ並べる(F29-AC30)。link7 で、イベントでないリンクのページも並べるようにした(`placedPagesOf`)。見出し(`headingOf`)はリンクのページへのリンクで、コミュニティに入っていれば、その名前を添える。並ぶページが無いときは「並ぶページは、関連リンクから決まります。いまは、並ぶページがありません。」を出す。枠の名前(`data-deck-frame`、`id`)は `events` から `placed-pages` に替えた。

幅 375px ではみ出さないこと(F29-AC31)は、`src/links/link-page.browser.test.ts` が、長い名前のリンクを持つスライドの管理のページで確かめる。

ヘルプは、画面の言葉の引用だけを直した(`community/list-event-talks`)。記事の書き直しは link10。

## イベントでないリンクのページ(link7 で実装済み)

`readLinkPage(db, target, viewer)`(`src/links/link-page-store.ts`)は、F45-AC35 の順で読む。

1. `eventKeysOf(target)` の鍵のイベントを順に見て、一般公開中のスライドのあるものがあれば、そのイベントのページ(`readEventPage`)。
2. 無ければ、`related_links.gather_key = target.gatherKey` で、`related_link_events` に行の無いリンクを引く(`readGatheredPage`)。

ページを出すかは、純粋な `pageShown`(`src/links/link-heading.ts`)が決める。一般公開中のスライドが 1 本以上あり、かつ、イベントとして保存されている、URL がイベントの形である、コミュニティに入っている、作者が 2 人以上、のどれかである。

- `inCommunity` は、link7 では常に false だった。link8 から、そのリンクのどれかがコミュニティに入っているかを渡す(下の「コミュニティへの所属」)。
- 本数と作者の数は、見る人を当てない問い合わせの行から数える(スライドの id と `decks.owner_user_id` の種類の数)。同じスライドが同じ鍵のリンクを 2 つ持っても(`t=30` と `t=60`)、1 本である。
- `pageShown` が false なら `null` で、経路は「まだありません」のページを出す。1 人だけの URL と、だれも入れていない URL は、本文も同じになる(F45-AC2)。
- 一覧だけに、見る人のミュートとブロックを当てる。0 本になっても、ページは 200 である(F45-AC15)。
- 「一般公開中」の条件は、イベントと同じ結合(`openDeck`、`readyVersion`)を使う(F45-AC14)。
- connpass などの URL でも、`related_link_events` に行の無いリンク(種類をイベント以外に変えたもの)は、この枝で集まる。URL がイベントの形なので、1 人でもページが出る(F45-AC3)。

ページの中身は、イベントと同じ `linkPageBody` で作る。

| 項目 | イベントでないリンク |
| --- | --- |
| 見出し | 一般公開中のスライドのリンクのうち、最初に保存された題名。無ければ、ホスト名と集める鍵(「example.com https://example.com/post」) |
| 元のページへのリンク | 一般公開中のスライドのリンクのうち、最初に保存されたものの `sanitized_url`(`sourceOf` の `kind: 'link'`)。`sanitized_url` が NULL の行なら、集める鍵 |
| コミュニティの頭 | link7 では出さない。link8 から、コミュニティに入っていれば出す(F45-AC17) |
| 「コミュニティはまだありません」と「作る」 | 出さない(ホスト名の集合を空で返す。F45-AC27 は、イベントの形のリンクだけ) |

### ページの出ているリンク(`listShownLinks`)

`listShownLinks(db, deckId)` は、イベントのリンクに加えて、イベントでないリンクのうち、その `gather_key` で `pageShown` が true になるものを返す(`eventId` は `null`)。問い合わせは、そのスライドのリンクの読み出しのほかに、イベントの分が 1 回、イベントでないリンクの分が 1 回(`gather_key IN (…)` を `GROUP BY` し、`count(DISTINCT …)` で本数と作者の数を取る)で、リンクの数によらない。

- 保存された鍵のうち、`linkTargetOf(鍵).gatherKey` が鍵と同じでないものは、数えない。`/link/…` の path から、その鍵に戻れないからである(下の「connpass の番号の先頭の 0」)。ページへ進むリンクが 404 を指さないようにしている。
- viewer(`readViewerParts`、`src/share/viewer-parts-store.ts`)は、この結果に含まれるリンクに `pagePath`(`linkPagePath(link.href)`)を付ける。`viewerLinksFrame` は、その行に、外へのリンクとは別の `<a class="related-link-page">`「このリンクを添えたスライド」(Slides with this link)を添える(F45-AC18)。イベントのリンクにも付く。正規の形が HTML に出るのは、この href だけである(F27-AC89)。
- 1 本の管理の行の下の文(`linkPlacesOf`)は、イベントでないリンクにも「リンクのページに並びます。」を出す。「このスライドが並ぶページ」の枠は、`placedPagesOf`(`src/decks/placed-pages-frame.ts`)が、関連リンクの順に、ページごとに 1 度ずつ並べる。イベントでないリンクの見出しは、そのスライド自身のリンクの題名、無ければホスト名と鍵である。ページの見出し(最初に保存された題名)とは、ほかの人の題名が先にあるとき、違う。

### connpass の番号の先頭の 0

種類をイベント以外にした connpass の URL `https://connpass.com/event/007/` は、保存される集める鍵が `https://connpass.com/event/007` で、`/link/` の側は、イベントの鍵にそろえた `connpass.com/event/7` になる。2 つは合わないので、このリンクは集まらない。直すには、保存する鍵の規則(`gatherKeyOf`)を変え、すでにある行を作り直す migration が要る。link7 は migration を足さないので、直していない。`listShownLinks` は、このリンクを「ページが出ている」としない。

### 仕様との関係で確かめること

- ほかのサイトの URL を、1 人が種類「イベント」で、別の 2 人がほかの種類で入れているとき、`/link/…` はイベントのページになり、ほかの種類の 2 人のスライドは並ばない(F45-AC35 の「まずイベントの鍵で引く」のとおり)。イベントのリンクが無くなると、2 人のページになる。このとき、2 人のスライドの viewer の行には、ページへ進むリンクが付く(行き先は、イベントのページ)。

## コミュニティへの所属(link8 で実装済み)

コミュニティに入るリンクを、イベントの関連リンクから、種類を問わない関連リンクに広げた(F30-AC65)。保存はせず、読むときに照らすので、紐づけ用リンクを足す、外すと、すぐに変わる(F30-AC66)。

| リンク | コミュニティに入る条件 |
| --- | --- |
| イベントのリンク(`related_link_events` に行がある) | これまでどおり、そのイベントが入っていること(`inCommunity`)。一般公開中のスライドのリンクのどれかの `related_link_events.host` が `community_links.host` と同じか、Luma のカレンダーの配信(`community_feed_events`)にある |
| ほかのリンク | そのリンクの `related_links.link_host` が `community_links.host` と同じ |

- 条件は `src/communities/store.ts` の 1 つの SQL(`linksIn`)にあり、リンクの id の条件 `linkInCommunity(communityId, linkId)` と、スライドの id の条件 `deckInCommunity(communityId, deckId)` が、それを使う。スライドは、入っているリンクを 1 つでも持てば入る。
- `link_host` は書かれたとおりのホスト名なので、`www.example.com` は `example.com` のコミュニティに入らない。サブドメインも入らない。大文字のホスト名、ポート、末尾の `.` は、`linkHostOf` が保存のときにそろえているので、入る(`https://EXAMPLE.com:8443/a` は `example.com`)。`link_host` が NULL の行は、どのコミュニティにも入らない。
- グループ名の無い `https://connpass.com/event/<番号>/` は、種類がイベントでもほかでも、入らない(F30-AC16)。`connpass.com` を紐づけ用リンクにできないためである(F30-AC12)。
- イベントでないリンクは、リンクごとに照らす。イベントは、イベントごとである(グループ名の無い URL のリンクも、ほかのスライドがグループ名つきで同じイベントを入れていれば入る)。そのため、`https://example.com/post` と `https://www.example.com/post` を別々のスライドが持つとき、2 本は同じリンクのページに並ぶが、コミュニティの「スライド」のタブに出るのは、前者だけである。
- 一般公開中かどうかは、この条件に入れていない。使う側の一覧が、それぞれ絞る。

`deckInCommunity` を使う場所は次のとおり。どれも、`related_link_events` と `related_links` の結合を、`decks` へのこの条件に替えた。

| 場所 | ファイル |
| --- | --- |
| コミュニティの「スライド」のタブとその数 | `src/communities/page-store.ts` の `listTalkRows` |
| トップの「フォローコミュニティ」の新着(F31-AC3) | `src/communities/feed-store.ts` |
| トップの「フォロー中」の一覧(F44-AC5) | `src/site/home-timeline-store.ts` |
| プロフィールのコミュニティのタブの最近のスライド(F31-AC8) | `src/profile/communities-store.ts` |
| お知らせ | `src/notifications/store.ts` |

コミュニティのページは、D1 の問い合わせの数を増やさないように(`src/cost/per-use.test.ts`、[規模と費用](scale-cost.md))、「リンク」のタブと「スライド」のタブを 1 つの問い合わせ(`listTalkRows`)で読む。link8 では、`deckInCommunity` でスライドを選び、イベントのリンクだけを LEFT JOIN で添えていた。link9 で、スライドと、コミュニティに入ったそのスライドのリンクの組を読む形に替えた(下の「コミュニティの「リンク」のタブ」)。

`inCommunity`(イベントの条件)を使い続けるのは、viewer の「(コミュニティ名) のほかのイベントの発表」(`src/share/viewer-talks-store.ts`)である。イベントの形のリンクだけを対象にしたままである(F24-AC41)。

### リンクのページ

`readGatheredPage` は、一般公開中のスライドのリンク(見る人を当てない)の `link_host` の集合を `findHostCommunity` に渡す。そのホスト名のどれかを持つコミュニティのうち、紐づけ用リンクを最初に足したものが返り、あれば `pageShown` の `inCommunity` が true になる。1 人のスライドだけでも、ページが出る(F45-AC4)。ページの頭には、そのコミュニティが出る(F45-AC17)。`LinkPage` に `community` を足し、イベントのページも、`readEventPage` が `listEventCommunities` で引いたものを同じ項目で返す。

`listShownLinks` は、イベントでないリンクの問い合わせ(`gather_key` ごとの集計)に、「その鍵の一般公開中のスライドのリンクのどれかの `link_host` を、コミュニティが持つか」を足した。問い合わせの数は変わらない。1 本の管理の文にコミュニティの名前を出すのは、link9 である(下の「1 本の管理の文と枠のコミュニティ名」)。

### お知らせ

`notifyCommunityPublished` の引数を、イベントの鍵(`eventKey`)から、関連リンクの id(`linkId`)に替えた。`linkId` を渡すと、そのリンクでスライドが入るコミュニティ(`linkInCommunity`)だけを対象にし、初めて一般公開してから `COMMUNITY_NOTICE_WINDOW_SECONDS` 以内のスライドに限る(F20-AC21)。渡さないとき(初めての一般公開。F20-AC20)は、スライドが入っているコミュニティすべてである。届かない相手、重複の防ぎ方、添えるコミュニティの名前は変えていない。

- リンクの追加(`POST /my/slides/:deck/links`、MCP の `add_related_link`)は、種類を問わず呼ぶ。id は、呼ぶ側が作って `addLink` に渡す(`linkId`)。
- 種類の変更(`POST /my/slides/:deck/links/kinds`)は、これまでどおり、イベントに変えたときだけ呼ぶ。イベントでない種類への変更で、スライドが新しくコミュニティに入ることは無いからである(イベントでないリンクは、種類によらずホスト名で照らす。イベントからほかの種類に変えたリンクのホスト名が合うなら、一般公開中のスライドでは、そのイベントがすでに入っている)。呼ぶと、あとからフォローした人に、何も変わっていないのに届く。
- Luma の配信の前倒し(`readCalendarsForEventSoon`)は、イベントのリンクだけである。

### 計画、依頼との違い

- 計画は、イベントでないリンクの条件を「`gather_key` の同じリンクのどれかが一般公開中のスライドにあり、`link_host` が合うこと」としていた。実装は、スライドの所属をリンクごとの `link_host` だけで決め、「どれか」で決めるのは、リンクのページの所属だけにした(`www.` を同じとみなさない、という決定に合わせた)。
- 種類の変更でお知らせを呼ぶのは、イベントに変えたときだけのままにした(上の理由)。

## コミュニティの「リンク」のタブ(link9 で実装済み)

「リンク」のタブに、イベントでないリンクも並べた(F30-AC68)。1 件は、リンクのページの単位である。

`listTalkRows`(`src/communities/page-store.ts`)は、1 つの問い合わせで、一般公開中のスライドと、そのスライド自身のリンクのうちコミュニティに入ったもの(`linkInCommunity`)の組を読む。イベントのリンクには `related_link_events`、`events` を LEFT JOIN で添え、ほかのリンクは `related_links.gather_key` を読む。コミュニティのページを開くときの D1 の問い合わせは 5 回のままである(`src/cost/per-use.test.ts`)。

`readCommunityTalks` は、その行から 2 つの一覧を作る。

| 一覧 | 作り方 |
| --- | --- |
| `links`(「リンク」のタブ) | イベントのリンクはイベントの番号で、ほかのリンクは `gather_key` でまとめる。まとまりの中で、スライドは 1 度だけ数える |
| `slides`(「スライド」のタブ) | すべての行から、重ならないスライド |

- 並びは、最初に一般公開されたスライドの公開日時の新しい順。同じ時刻は、イベントが先で、番号の大きい順、次にイベントでないリンクが、鍵の文字の順である。行の届く順によらない。
- イベントでないリンクの見出しは、リンクのページと同じ決め方である。その鍵の、一般公開中のスライドのリンク(コミュニティの外のものも含む。見る人を当てない)のうち、最初に保存された題名(`firstGatheredTitle`、`src/links/link-page-store.ts`)。無ければ、ホスト名と鍵。リンク先は `linkPagePath(鍵)`。
- 並ぶのは、コミュニティに入ったリンクを持つスライドだけである。`https://example.com/post` と `https://www.example.com/post` を別々のスライドが持つとき、リンクのページには 2 本が並ぶが、`example.com` のコミュニティのタブの「スライド n 本」と枠には、前者だけが出る。
- 作者が 1 人でも並ぶ(F45-AC4)。見る人のミュート、ブロックで 0 本になったリンクは、一覧と数から外れる(F30-AC38、F32-AC22)。
- `gather_key` が NULL のリンクと、鍵から `/link/…` の path に戻れないリンク(上の「connpass の番号の先頭の 0」)は、タブに出さない。スライドのタブには出る。
- 種類をイベント以外にした connpass などの URL のリンクは、同じ URL のイベントとは別の 1 件になる(リンク先は同じ `/link/…`)。
- 横に送る枠の `id` は、`community-event-<イベントの番号>` から、並びの順の `community-link-<n>` に替えた。

### 1 本の管理の文と枠のコミュニティ名

`listShownLinks` は、ページの出ているリンクごとに、`community`(コミュニティの名前)を返す。イベントでないリンクは、そのリンク自身の `link_host` を持つコミュニティのうち、紐づけ用リンクを最初に足したものである(そのスライドのリンクの読み出しに、列を 1 つ足した。問い合わせの数は変わらない)。イベントのリンクは `null` で、これまでどおり `listDeckEvents` の `community` を使う。

| 行 | 文 |
| --- | --- |
| イベントがコミュニティに入っている | 「(コミュニティ名) のページに並びます。」 |
| イベントでないリンクで、ページが出ていて、`link_host` をコミュニティが持つ | 「(コミュニティ名) のページに並びます。」 |
| ほかの、ページの出ているリンク | 「リンクのページに並びます。」 |
| ページの出ていないリンク | 出さない |

- `linkPlacesOf` と `placedPagesOf` が、この `community` を使う。「このスライドが並ぶページ」の枠も、イベントでないリンクにコミュニティの名前を添える(F29-AC30)。
- 下書きだけが持つリンクは、ホスト名が合っても、ページが出ていないので、文が出ない。ほかの一般公開中のスライドでページが出ていれば、下書きにも出る(イベントと同じ)。
- `www.example.com` で書いたリンクは、`example.com` のコミュニティに入らないので、ページの頭にそのコミュニティが出ていても、文は「リンクのページに並びます。」である。

### コミュニティの削除(F30-AC71)

コミュニティを削除すると、紐づけ用リンクが無くなるので、コミュニティに入ったことだけでページが出ていたリンク(1 人のスライドだけの、イベントでないリンク)は、「まだありません」のページになる。イベントの形のリンクは、1 本でもページが出続ける(F45-AC3)。`src/communities/admins.test.ts` の F30-AC71 のテストが確かめる。

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
| link6 | 列の追加と埋め戻し(migration 0071)、`addLink` が 2 つの列を書く |
| link7 | イベントでないリンクのページ、viewer の行からのリンク |
| link8 | コミュニティへの所属を種類を問わないリンクに広げる、お知らせ、フォローの新着、イベントでないリンクのページの頭 |
| link9 | コミュニティの「リンク」のタブにイベントでないリンクを並べる、1 本の管理の文と枠にコミュニティ名を出す |
| link10 | ヘルプの記事、ほかの設計の文書の書き直し |
