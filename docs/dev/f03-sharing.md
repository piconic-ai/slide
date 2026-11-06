# 共有 URL と配信の実装設計

[URL を渡して読んでもらう](../features/f03-sharing.md) を scope1 で実装するための契約。公開状態・作者限定の閲覧・版ごとの origin は [公開管理の実装設計](f02-publication.md) を使い、ここでは共有 URL と読者向けの配信を扱う。全体の方針は [URL と HTML の隔離](design.md#url-と-html-の隔離) と [キャッシュの位置](design.md#キャッシュの位置) を参照する。

## handle

共有 URL の `@handle` は `accounts` の `handle` で、所有者の GitHub login を小文字にした値を最初のログイン時に記録する。GitHub の login は大文字小文字を区別しないので、小文字の表記を一つに決める。0010 の時点でログイン中の所有者は、`owner_sessions` の login から作る。ログアウト済みなら次のログインで作る。handle にできない login や、別の利用者がすでに持つ handle は記録せず、ログインは止めない。その所有者の共有 URL は開けない。

GitHub 側で改名しても handle は変えない。渡した URL が切れないことを優先する。handle は URL で deck を指すだけで、認可には使わない。退会すると handle も消え、再びログインするとその時点の login から作り直す。改名への追随と旧名の予約（他人に渡さない）は複数の作者を受け入れる段階で扱う。

## 共有 URL

`GET /@handle/slug` は管理 origin で、信頼する viewer を返す。`slug` は deck の ID。

| 状態 | 応答 |
| --- | --- |
| deck の `public_deployment_id` が同じ deck の `ready` な deployment | 200 の viewer。その deployment の origin の `/` を iframe で開く |
| 下書き・停止中・存在しない handle や deck・不正な表記 | 404 の「この資料は公開されていません」。どれも区別しない |
| `CONTENT_ORIGIN` が未設定・不正 | 同じ 404 |
| 大文字・`%40` などのエンコード・末尾の `/` を含む表記 | 正しい表記の URL へ 301 |
| `/@` 以下のそれ以外の path（`/@handle` だけ、余分な segment など） | 同じ 404 |

解決は `src/share/store.ts` の `readSharedDeployment` が、閲覧のたびに handle・deck・deployment を一つの join で D1 から読む。削除した deck は公開 pointer を持たないので、同じ 404 になる。版を置き換えると同じ URL が新しい deployment を開き、旧版の origin は F02 の認可で 404 になる。次の下書きは公開 pointer に載らないので、deployment ID を推測しても匿名では読めない。

応答は `Cache-Control: no-cache` で、停止や置き換えは次の閲覧から反映する。公開中の viewer（200）だけを検索対象にしてよく、`X-Robots-Tag` を付けない。404 やエラーは `noindex` にする。path の判定は request の生の path で行い、エンコードされた別表記を 200 で返さない。

共有 URL は接続元 IP ごとに `VIEWER_RATE_LIMITER`（毎分 600 回）で、版の origin への request は `CONTENT_RATE_LIMITER`（毎分 3000 回）で数える。勉強会では参加者が会場の同じ IP を共有するので、管理画面より大きい上限にしている。

## viewer

viewer は `src/share/pages.ts` のサービス自身の markup と `/share.js` だけを実行する。

- iframe は `sandbox="allow-scripts allow-same-origin"`、`referrerpolicy="no-referrer"`、`allow="fullscreen"`。top navigation・popup・download・form を許さない。作者の JS はその deployment の origin で動き、管理 origin の cookie や DOM には届かない。
- CSP は `default-src 'none'; frame-src <deployment の origin>; script-src 'self'; style-src 'unsafe-inline'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`。viewer 自体は他のサイトに埋め込ませない。
- 「リンクをコピー」は共有 URL を clipboard に書く。clipboard が使えない環境では URL を選択状態にする。「資料だけを開く」は deployment の origin をトップレベルで開く。
- viewer と iframe の間で `postMessage` は使わない。作者の JS から viewer へ要求を送る経路はない。

作者の管理画面（`/decks/:deck`）は、一般公開中で配信が設定されているとき、同じ共有 URL とコピー操作を表示する。管理画面の CSP は `/share.js` を読むため `script-src 'self'` を許す。

## 読者向けの配信と内部 cache

版の origin への匿名の request は、F02 の [配信の認可と失効](f02-publication.md#配信の認可と失効) と同じく毎回 D1 で認可する。認可を通った一般公開の file だけが、Workers Cache を有効にした名前付き entrypoint `ContentFiles`（`worker.ts`）を `ctx.exports` 経由で呼び、保存済みの bytes を読む。

| 項目 | 内容 |
| --- | --- |
| 内部 URL と cache key | `https://content-files.internal/<revision>/<deployment ID>/<sha256>/<object key>`（各部分は URL エンコード）。Workers Cache の key は path で、request の host を含まない。deployment と file の digest を path に入れるので、別の deck や版の同じ `/index.html` は別の entry になる |
| revision | `src/preview/stored-file.ts` の `CONTENT_CACHE_REVISION`。同じ file でも返す bytes を変えるときに上げる |
| 内部の応答 | `Cache-Control: public, max-age=31536000, immutable`、`Cache-Tag: deployment-<ID>`。見つからない object は `no-store` の 404 で cache しない |
| 読者への応答 | gateway が header を付け直す。`Cache-Control: no-cache`、weak の `ETag: W/"<sha256>"`、F02 の CSP。内部の長い TTL は browser に渡さない。`X-Content-Cache` に内部 cache の `Cf-Cache-Status`（`HIT`・`MISS` など）を写す |
| 作者限定の閲覧 | 共有 cache を通さず R2 から直接読み、`private, no-store` を返す |

停止・置き換えの後は、内部 cache が温まっていても gateway の認可で 404 になり、`ContentFiles` は呼ばれない。cache の purge は失効の手段にしない。deck を削除して R2 の object を消した後も、内部 cache の entry は期限まで残りうるが、D1 が拒否するので配信されない。消したいときは `Cache-Tag` で手動に purge する。自動の purge は実装していない。

`cross_version_cache` は entrypoint ごとには指定できないので、top level の `cache` に `enabled: false` と合わせて指定する。cache を有効にした `ContentFiles` だけに効き、Worker の version をまたいで entry を使い回す。返す bytes を変えるときは revision を上げ、古い entry を読まないようにする。デプロイ後に温まった file が `HIT` のままかは本番で確かめる。

`ContentFiles` は route を持たない名前付き entrypoint で、外部の request は届かない。default の entrypoint は cache を無効にし、すべての request を認可する。R2 bucket は公開せず、r2.dev の development URL も使わない。

ETag は weak にする。Cloudflare は圧縮した応答から strong な `ETag` を外すため、F02 の strong な `ETag` では browser の再検証で 304 を返せなかった。`If-None-Match` は weak 比較で照合し、一覧・`*`・strong 表記も受け付ける。

`ctx` のない呼び出し（テスト）では R2 を直接読む。ローカルの `wrangler dev` は `ctx.exports` を通すが cache は再現しないので、`X-Content-Cache` は `none` になる。cache の cold・warm は Workers Cache を模したテスト（`src/preview/content-cache.test.ts`）と、本番の `X-Content-Cache` で確かめる。

