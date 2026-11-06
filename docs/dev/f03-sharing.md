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

共有 URL は接続元 IP ごとに `VIEWER_RATE_LIMITER`（毎分 600 回）で数える。勉強会では参加者が会場の同じ IP を共有するので、管理画面より大きい上限にしている。

## viewer

viewer は `src/share/pages.ts` のサービス自身の markup と `/share.js` だけを実行する。

- iframe は `sandbox="allow-scripts allow-same-origin"`、`referrerpolicy="no-referrer"`、`allow="fullscreen"`。top navigation・popup・download・form を許さない。作者の JS はその deployment の origin で動き、管理 origin の cookie や DOM には届かない。
- CSP は `default-src 'none'; frame-src <deployment の origin>; script-src 'self'; style-src 'unsafe-inline'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`。viewer 自体は他のサイトに埋め込ませない。
- 「リンクをコピー」は共有 URL を clipboard に書く。clipboard が使えない環境では URL を選択状態にする。「資料だけを開く」は deployment の origin をトップレベルで開く。
- viewer と iframe の間で `postMessage` は使わない。作者の JS から viewer へ要求を送る経路はない。

作者の管理画面（`/decks/:deck`）は、一般公開中で配信が設定されているとき、同じ共有 URL とコピー操作を表示する。管理画面の CSP は `/share.js` を読むため `script-src 'self'` を許す。
