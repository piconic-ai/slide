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
- `/embed.js` は 2 つのことをする。1 つは、スライドの枠に何もしない passive な `touchstart` の処理を登録することで、iOS Safari でスワイプをスライドに届けるためである(理由は viewer と同じ。[対応ブラウザと外部依存](f03-sharing.md#対応ブラウザと外部依存))。もう 1 つは、枠の移動が断られてスライドが消えたときに、スライドを読み込み直すことである([埋め込みの中でできないこと](#埋め込みの中でできないこと))。

### ヘッダー

| ヘッダー | 値 | viewer との違い |
| --- | --- | --- |
| `Content-Security-Policy` | `default-src 'none'; frame-src <deployment の origin>; script-src 'self'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors *` | `frame-ancestors` が `*`。`connect-src` と `img-src` がない。`frame-src` に `'self'` がない |
| `X-Frame-Options` | 付けない | viewer とほかの画面は `DENY`。handler が `framedByAnyone` を立てた応答だけ、`siteHeaders`(`src/site/middleware.ts`)が外す |
| スライドの枠の属性 | `sandbox="allow-scripts allow-same-origin"`、`allow="fullscreen"`、`referrerpolicy="no-referrer"` | 同じ |

ほかのサイトに埋め込めるのは、このページだけである。viewer 本体、管理画面、404 は、これまでどおり埋め込めない。

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

- スライドの中のリンクのうち、そのスライド自身のファイル以外へ向かうもの(ほかのスライドの共有 URL、ほかのサイト)は、埋め込みの中では開かない。スライドの枠の移動を、埋め込みのページの CSP(`frame-src <deployment の origin>`)が、request を出す前に断るためである。サービスにも、リンク先のサイトにも、何も届かない。断られた後の枠の中身は、ブラウザによって違う(2026-11-20 に Playwright の 3 つの engine で確かめた)。
  - Firefox は、スライドをそのまま残す。読者は続きを読める。
  - Chromium は、枠の中身をブラウザのエラーの表示に置き換える。そのままでは、記事を読み込み直すまでスライドが戻らない。そこで `/embed.js` が、スライドを最初の URL(埋め込みの URL が指すページ)から読み込み直す。読者が見ていたページは失われるが、スライドは読める状態に戻る。
  - WebKit は、スライドを残すが、枠の `load` を Chromium と同じように知らせる。埋め込みのページは、別 origin の枠の中身を見られず、この 2 つを区別できないので、WebKit でも読み込み直す。
  - 判定は、埋め込みのページの `securitypolicyviolation`(`frame-src`)と、枠の `load` が、ほぼ同時(`load` が違反の 250ms 前から 2 秒後まで)に起きたことで行う。スライド自身のファイルへの移動(複数のファイルでできたスライド)は、違反なしに `load` だけが起きるので、何もしない。
  - 移動を通す形にはしていない。枠が共有 URL を読み込めるようにするには、`frame-src` に管理 origin を足し、移動用のページ(`frame-ancestors 'self'`)を、ほかのサイトの枠の中でも表示できるようにする必要があり、viewer の守りを弱めるためである。読者は「Slide で開く」から viewer へ移り、そこでリンクをたどる。
- 表示中のページは、埋め込みのページに伝わらない。ページを伝える script は、スライドの枠の親が最上位のときだけ知らせる。「Slide で開く」の行き先は、埋め込みの URL のページ番号で決まり、めくっても変わらない。
