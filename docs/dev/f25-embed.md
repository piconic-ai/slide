# ブログへの埋め込みの実装設計

[ブログに埋め込む](../features/f25-embed.md) を実装するための契約。共有 URL、viewer、スライドの枠の守りは [共有 URL と配信の実装設計](f03-sharing.md) を使い、ここでは、ほかのサイトの `<iframe>` に入るページと、それで増える危険への守りを扱う。

## 埋め込みのページ

`GET /embed/@handle/slug`(ページ番号つきは `/embed/@handle/slug/3`)は、管理 origin で、ほかのサイトの `<iframe>` に入れるための最小のページを返す(`src/embed/routes.ts`、`src/embed/pages.ts`)。

- 中身は、スライドの枠と、下端の 1 行(題名、作者の名前、「Slide で開く」のリンク)だけである。共通のヘッダーとフッターは付けない。作者の顔写真も出さない(読者の IP アドレスを GitHub に伝えないため)。
- `/embed` の後ろは、共有 URL と同じ規則(`parseSharePath`)で読む。大文字、`%40`、末尾の `/` の表記は、`/embed` の下の正しい表記へ 301 で送る。ページ番号の扱いは共有 URL と同じで、スライドの URL に `#3` を付けて渡す。
- 公開の判定は、共有 URL と同じ `readSharedDeployment` を、表示のたびに D1 で読む。一般公開中のスライドだけを返す。下書き、公開を止めたスライド、運営が非表示にしたスライド、停止中の作者のスライド、存在しないスライド、配信が未設定のときは、viewer と同じ 404(「この資料は公開されていません」)を返す。この 404 は、ほかの画面と同じく `X-Frame-Options: DENY` と `frame-ancestors 'none'` を持つので、埋め込み先では枠の中に表示されない。公開を止めると、埋め込みも見えなくなる。
- 「Slide で開く」は、viewer を新しいタブで開く(`target="_blank"`、`rel="noopener"`)。開始のページを指定した埋め込みでは、そのページの共有 URL を開く。埋め込み先のページは移動させない。
- 応答は `Cache-Control: no-cache` で、停止や置き換えは次の表示から反映する。検索の対象にしない(`X-Robots-Tag: noindex, nofollow`)。検索に載るのは、埋め込み先の記事と viewer である。
- 接続元 IP ごとの上限は、共有 URL と同じ `VIEWER_RATE_LIMITER` で数える。
- `/embed.js` は、スライドの枠に何もしない passive な `touchstart` の処理を登録するだけである。iOS Safari でスワイプをスライドに届けるためで、理由は viewer と同じ([対応ブラウザと外部依存](f03-sharing.md#対応ブラウザと外部依存))。

### ヘッダー

| ヘッダー | 値 | viewer との違い |
| --- | --- | --- |
| `Content-Security-Policy` | `default-src 'none'; frame-src <deployment の origin>; script-src 'self'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors *` | `frame-ancestors` が `*`。`connect-src` と `img-src` がない。`frame-src` に `'self'` がない |
| `X-Frame-Options` | 付けない | viewer とほかの画面は `DENY`。handler が `framedByAnyone` を立てた応答だけ、`siteHeaders`(`src/site/middleware.ts`)が外す |
| スライドの枠の属性 | `sandbox="allow-scripts allow-same-origin"`、`allow="fullscreen"`、`referrerpolicy="no-referrer"` | 同じ |

ほかのサイトに埋め込めるのは、このページだけである。viewer 本体、管理画面、404 は、これまでどおり埋め込めない。

## 作者のファイルを枠に入れられるサイト

ブラウザは `frame-ancestors` を、枠のすべての祖先について確かめる。埋め込みでは、スライド(配信 origin)の祖先は、埋め込みのページ(管理 origin)と、その外側の埋め込み先のサイトの 2 つになる。そのため、埋め込みのページだけを許しても、作者のファイルの CSP が `frame-ancestors <管理 origin>` のままでは、スライドは表示されない。

そこで、作者のファイルの `frame-ancestors` を、配る相手で分ける(`src/preview/content.ts` の `frameAncestorOf`)。

| 配るファイル | `frame-ancestors` |
| --- | --- |
| 一般公開のファイル(だれでも読める) | `*` |
| 作者限定のファイル(作者の session で読む下書き) | `<管理 origin>`(これまでと同じ) |

- CSP のほかの部分(`sandbox allow-scripts allow-same-origin; worker-src 'none'`)は変えない。だれの枠に入っても、スライドはページ全体を移動できず、別タブ、form、service worker を使えない。
- 一般公開のファイルは、もともと、だれでも配信 origin を直接開いて読める。枠に入れられるようになって増えるのは、ほかのサイトが、埋め込みのページを通さずに配信 origin を直接枠に入れられることである。そのときは下端の 1 行(題名、作者、「Slide で開く」)が出ない。配信 origin には管理 origin の cookie がなく、押されて困る操作もないので、読者の slide のアカウントへの危険は増えない。配信 origin の URL は版ごとに変わり、公開を止めるか版を入れ替えると 404 になるので、直接枠に入れたサイトの表示は続かない。
- 作者限定のファイルは、作者の session cookie(`SameSite=Lax`)で読む。別サイトの枠の中の request には、ブラウザがこの cookie を付けない。付いたとしても、`frame-ancestors <管理 origin>` と `Cross-Origin-Resource-Policy: same-origin` が、ほかのサイトの枠に入ることを止める。

## 埋め込みで増える危険と守り

### クリックジャッキング

埋め込みを許すと、悪意のあるサイトが枠を透明にして重ね、読者に意図しない操作を押させることができる。守りは、押されて困るものを埋め込みのページに置かないことである。

- 埋め込みのページは、読者の session を読まない。だれが開いても同じ応答を返す。
- フォロー、通報、ミュートなど、cookie を使う操作を置かない。form も button もない。CSP が `connect-src` を許さず `form-action 'none'` なので、このページの script から管理 origin へ request を送ることも、form を送ることもできない。
- 置いてあるリンクは「Slide で開く」の 1 つで、押しても、だれでも開ける viewer が新しいタブで開くだけである。
- フォロー、通報、ミュートは、開いた先の viewer で行う。viewer は埋め込めないので、そこでの操作は重ねられない。

### 埋め込み先のページを動かす

スライド(作者の JS)は、viewer と同じ sandbox の枠の中で動く。埋め込み先のページを移動させる、別タブを開く、form を送る、ダウンロードを始めることはできない。作者のファイルの CSP の `sandbox` も、単独で同じことを止める。

### 読者について伝わること

| 相手 | 伝わること | 伝わらないこと |
| --- | --- | --- |
| 埋め込み先のサイト | 記事を開いたこと(そのサイト自身のページなので)。枠の中は別 origin なので、スライドの中身、めくったページ、slide にログインしているかどうかは読めない | slide のアカウント、cookie。埋め込みのページは、親のページへ `postMessage` を送らない |
| slide(管理 origin と配信 origin) | IP アドレス、ブラウザの種類、埋め込みが読み込まれたこと。枠が画面に近づいたときに読み込む(`loading="lazy"`)。ブラウザの既定では、埋め込み先の origin(`Referer`。path は含まない)も届く。埋め込み先が Referrer-Policy で止めていれば届かない | slide の session。ブラウザは、別サイトの枠の中の request に `SameSite=Lax` の cookie を付けない。付いていても、埋め込みのページは読まない。読まれた回数は数えていない |
| スライドが読み込む外部のサービス | viewer で開いたときと同じ(IP アドレス、開いたこと)。[外部との通信](f03-sharing.md#外部との通信) を参照 | 埋め込み先のページの URL(枠は `referrerpolicy="no-referrer"`) |

### 埋め込みの中でできないこと

- スライドの中の、ほかのスライドの共有 URL へのリンクは、埋め込みの中では開かない。枠が読み込む移動用のページは、管理 origin だけが埋め込める(`frame-ancestors 'self'`)ためである。読者は「Slide で開く」から viewer へ移る。
- 表示中のページは、埋め込みのページに伝わらない。ページを伝える script は、スライドの枠の親が最上位のときだけ知らせる。「Slide で開く」の行き先は、埋め込みの URL のページ番号で決まり、めくっても変わらない。

## 確かめ方

- 埋め込みのページの応答(公開の状態ごとの 404、ヘッダー、session を読まないこと、ページ番号)は、ローカルの D1 と HTTP で確かめる(`src/embed/routes.test.ts`)。
- 別の origin に貼ったときの動きは、Playwright で確かめる(`src/embed/embed.browser.test.ts`)。別の origin のページに、埋め込みコードと、viewer 本体の URL の `<iframe>` を並べて置く。判定は viewer の隔離のテストと同じく、JS の戻り値ではなく、外に出た request、開いたページの数、ダウンロードの有無、枠の中身で行う。`BROWSER=firefox`・`BROWSER=webkit` でも動く。
  - 一般公開のファイルの `frame-ancestors` を `<管理 origin>` に戻すと、スライドが表示されずにテストが失敗する。枠の中の共有 URL への応答を、どのサイトからも埋め込めるように変えると、viewer 本体が表示されてテストが失敗する。どちらも確認済み。
- 実際のブログサービス(はてなブログ、Zenn など)が、このコードの `<iframe>` と `style` を通すかは、ローカルでは確かめられない。
