# リンクによる集約の実装設計

[同じリンクでスライドが集まる](../features/f45-link-gathering.md)の設計。同じ URL を関連リンクに持つスライドを、`/link/<URL>` の 1 つのページに並べる。実装は 10 本の PR に分ける(計画は [issue #737](https://github.com/piconic-ai/slide/issues/737))。この文書は PR ごとに書き足す。いま実装済みなのは、最初の PR(link1)の純粋な関数だけで、経路、ページ、列は、まだ無い。節ごとに、実装済みか、どの PR で実装するかを書く。

## ファイルの分担

| ファイル | 層 | 役割 | 状態 |
| --- | --- | --- | --- |
| `src/links/url-rules.ts` | 純粋 | サイトごとの規則。集めるときだけ除くクエリ(`gatheredWithout`) | link1 で実装済み |
| `src/links/normalize.ts` | 純粋 | 比べる形(`normalizedUrlOf`)。中身は、除く名前を足せる `comparedUrlOf` | link1 で実装済み(出力は変えていない) |
| `src/links/gather.ts` | 純粋 | 集める鍵(`gatherKeyOf`)、書かれたホスト名(`linkHostOf`) | link1 で実装済み |
| `src/links/link-address.ts` | 純粋 | `/link/` の後ろの読み方(`parseLinkPath`)、引く鍵と正規の形(`linkTargetOf`)、ページの path(`linkPagePath`) | link1 で実装済み |
| `src/links/link-page-routes.ts` | routes | `GET /link/*`、`GET /link` | link2 で実装する |
| `src/links/link-page-store.ts` | store | ページの読み出し、Luma の番号から名前への対応 | link2、link3、link7 で実装する |
| `src/links/link-page.ts`、`src/links/link-heading.ts` | pages、純粋 | ページ、見出し、ページを出す条件 | link3、link4 で実装する |
| `src/events/routes.ts` | routes | `GET /events/:id` の 301 | link3 で実装する |

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
- ほかのサイトのイベント(道具で種類を「イベント」にした URL)の鍵は、`www.` を残す。正規の形は `www.` を除くので、`www.` 付きで保存されたイベントは、`eventKey` に当たらない。扱いは決めていない(link7 までに相談する)。

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

## 言語(link2 で実装する)

`/link/…` のクエリは、`lang` を含めて、すべてリンク先の URL のものとして読む(F45-AC33)。言語は cookie と `Accept-Language` で決め、フッターの切り替えは `/link?to=<正規の path>&lang=…` を経由して戻る(F45-AC34)。[画面の言語](i18n.md)にも書いた。

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
- `/link/*` は、後ろの無い `/link` にも当たる(`/link/*` を先に登録すると、`/link` もそのハンドラーに届いた)。link2 では、`GET /link` を先に登録するか、ハンドラーの中で分ける。`/link/` は、空の `rest` として届く。

## PR の積み方

| PR | 中身 |
| --- | --- |
| link1 | この文書、`gatheredWithout`、純粋な `gather.ts`、`link-address.ts` |
| link2 | `/link/*` の経路(イベントだけ)、「まだありません」のページ、言語、検索に載せる条件 |
| link3、link4 | `/events/:id` の 301、アプリの中のリンク先、見出しと頭、名前を直す経路の撤去 |
| link5 | コミュニティのタブ「リンク」、1 本の管理の文と枠 |
| link6 | 列の追加と埋め戻し(migration) |
| link7 | イベントでないリンクのページ、viewer の行からのリンク |
| link8、link9 | コミュニティへの所属を種類を問わないリンクに広げる、お知らせ、タブとページの頭 |
| link10 | ヘルプの記事、ほかの設計の文書の書き直し |
