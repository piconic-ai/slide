# ブログへの埋め込みの実装設計

[ブログに埋め込む](../features/f25-embed.md) を実装するための契約。共有 URL、viewer、スライドの枠の守りは [共有 URL と配信の実装設計](f03-sharing.md) を使い、ここでは、ほかのサイトの `<iframe>` に入るページと、それで増える危険への守りを扱う。

## 埋め込みのページ

`GET /embed/@handle/slug`(ページ番号つきは `/embed/@handle/slug/3`)は、管理 origin で、ほかのサイトの `<iframe>` に入れるための最小のページを返す(`src/embed/routes.ts`、`src/embed/pages.ts`)。

- 中身は、スライドの枠と、下端の 1 行(題名、作者の名前、「Slide で開く」のリンク)だけである。共通のヘッダーとフッターは付けない。作者のプロフィール画像も出さない。
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

## 埋め込みコード

埋め込みコードは、`<iframe>` 1 つである(`src/embed/code.ts` の `embedCode`)。

```html
<iframe src="https://slide.community/embed/@handle/slug" title="題名" loading="lazy" width="960" height="540" style="width:100%;height:auto;aspect-ratio:16/9;border:0" allowfullscreen></iframe>
```

- `style` で、置かれた列の幅いっぱいに広げ、16:9 を保つ。`width` と `height` の属性は、`style` を落とすサイトのための控えで、そのときは 960×540(16:9)の固定の大きさになる。
- `title` はスライドの題名(なければ URL の名前)で、読み上げが枠を名前で呼べるようにする。`"`、`<`、`>`、`&` は文字参照にし、改行などの制御文字は空白にする。題名がコードの属性や行を壊さない。
- `loading="lazy"` で、枠が画面に近づくまで読み込まない。`allowfullscreen` は、スライド自身の全画面の操作を通すためである。
- コピーされるコードは、ページ番号なしである。開始のページを変えたい作者は、`src` の末尾に `/3` を足す。
- 同じコードを、2 か所が出す。viewer の共有メニューの「埋め込みコードをコピー」と、oEmbed の応答の `html`(`maxwidth`・`maxheight` を渡されないとき)である。スライドの編集には、枠を置かない(F25-AC11)。どちらも `embedCodeOf`(スライド全体の共有 URL と題名から作る)を通るので、食い違わない。
- 第一スコープの見直しで、スライドの編集の「埋め込みコード」の枠(`embedCodeFrame`)を外した(F25-AC11)。コードを出すのは viewer の共有メニューと oEmbed の 2 か所である。

## oEmbed

`GET /oembed?url=<共有 URL>&format=json` は、共有 URL を受け取ったサイトに、埋め込み方を JSON で答える([oEmbed](https://oembed.com) の `rich` 型。`src/embed/oembed.ts`)。viewer の `<head>` に、発見用の `<link rel="alternate" type="application/json+oembed">` を付ける。`href` は、開いているページ番号にかかわらず、スライド全体の共有 URL についての問い合わせである。

| 項目 | 値 |
| --- | --- |
| `type`、`version` | `rich`、`1.0` |
| `html` | 上の埋め込みコード。ページ番号つきの共有 URL を渡しても、ページ番号なしのコードを返す。`maxwidth`・`maxheight` を渡されたときは、`width`・`height` の属性だけを、下の値に変える |
| `width`、`height` | 960 と 540。`maxwidth`・`maxheight` を渡されたときは、16:9 のまま、その中に収まる整数(どちらの上限も超えない。最小は 1×1) |
| `title`、`author_name`、`author_url` | 題名(なければ URL の名前)、作者の名前(なければ `@handle`)、プロフィールの URL |
| `provider_name`、`provider_url` | サービス名、管理 origin |

- 答えるのは、管理 origin の、正しい表記の共有 URL(スライド、またはそのページ)で、一般公開中のものだけである。ほかのサイトの URL、プロフィール、`/embed/…`、別の表記、公開中でないスライド(埋め込みのページが 404 になるものと同じ)は、404 を返す。存在しないスライドと公開中でないスライドを区別しない。
- `maxwidth`・`maxheight` は、`652.8` や `640.0` のような小数を受け付け、切り捨てて上限にする(列の幅を測った値をそのまま渡す受け手のため)。`html` の `width`・`height` の属性も同じ値にするのは、`style` を落とす受け手で枠が上限を超えないようにするためである。`style` を通す受け手では、これまでどおり列の幅いっぱいで 16:9 になる。
- 上限として読めない値には 400 を返す。`0`、1 未満、負の数、空の値、数でない値(`wide`、`480px`、`1e3`)である。無視して 960×540 を返すと、渡された上限より大きい枠を返すことになるので、無視しない。指数や単位つきの表記は受け付けない。
- `format` は `json` だけに対応する。それ以外(`xml`)には、oEmbed の仕様のとおり 501 を返す。
- 読者の session は読まない。応答は `Cache-Control: no-cache`。接続元 IP ごとの上限は、共有 URL と同じ枠で数える。

## 作者のファイルを枠に入れられるサイト

ブラウザは `frame-ancestors` を、枠のすべての祖先について確かめる。埋め込みでは、スライド(配信 origin)の祖先は、埋め込みのページ(管理 origin)と、その外側の埋め込み先のサイトの 2 つになる。そのため、埋め込みのページだけを許しても、作者のファイルの CSP が `frame-ancestors <管理 origin>` のままでは、スライドは表示されない。

そこで、作者のファイルの `frame-ancestors` を、配る相手で分ける(`src/preview/content.ts` の `frameAncestorOf`)。

| 配るファイル | `frame-ancestors` |
| --- | --- |
| 一般公開のファイル(だれでも読める) | `*` |
| 作者限定のファイル(作者の session で読む下書き) | `<管理 origin>`(これまでと同じ) |

- CSP のほかの部分(`sandbox allow-scripts allow-same-origin; worker-src 'none'`)は変えない。だれの枠に入っても、スライドはページ全体を移動できず、別タブ、form、service worker を使えない。
- 一般公開のファイルは、もともと、だれでも配信 origin を直接開いて読める。枠に入れられるようになって増えるのは、ほかのサイトが、埋め込みのページを通さずに配信 origin を直接枠に入れられることである。そのときは下端の 1 行(題名、作者、「Slide で開く」)が出ない。配信 origin には管理 origin の cookie がなく、押されて困る操作もないので、読者の slide のアカウントへの危険は増えない。配信 origin の URL は版ごとに変わり、公開を止めるか版を入れ替えると 404 になるので、直接枠に入れたサイトの表示は続かない。
- 作者限定のファイルは、viewer の枠の session cookie(`SameSite=None; Partitioned`)で読む。別サイトの枠の中の request には、cookie の partition が違うので付かない。付いたとしても、`frame-ancestors <管理 origin>` と `Cross-Origin-Resource-Policy: same-origin` が、ほかのサイトの枠に入ることを止める。

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

## 確かめ方

- 埋め込みコードと oEmbed の応答の組み立ては、Vitest で確かめる(`src/embed/code.test.ts`、`src/embed/oembed.test.ts`)。題名に引用符、`<`、改行を含むスライドで、コードが 1 つの `<iframe>` のままであることを見る。
- 埋め込みのページの応答(公開の状態ごとの 404、ヘッダー、session を読まないこと、ページ番号)、oEmbed の経路、スライドの編集に枠がないことは、ローカルの D1 と HTTP で確かめる(`src/decks/edit-page.test.ts`)。
- 別の origin に貼ったときの動きは、Playwright で確かめる(`src/embed/embed.browser.test.ts`)。別の origin のページに、埋め込みコードと、viewer 本体の URL の `<iframe>` を並べて置く。判定は viewer の隔離のテストと同じく、JS の戻り値ではなく、外に出た request、開いたページの数、ダウンロードの有無、枠の中身で行う。`BROWSER=firefox`・`BROWSER=webkit` でも動く。
  - 埋め込みの中で、ほかのスライドの共有 URL と、ほかのサイトへのリンクを押す。外に request が出ず、記事が動かず、スライドが読める状態のままであること(Firefox はそのまま、Chromium と WebKit は最初のページから)を見る。スライド自身の別のファイルへのリンクでは、読み込み直しが起きないことも見る。`/embed.js` の読み込み直しを外すと、Chromium でこのテストが失敗する。
  - 一般公開のファイルの `frame-ancestors` を `<管理 origin>` に戻すと、スライドが表示されずにテストが失敗する。枠の中の共有 URL への応答を、どのサイトからも埋め込めるように変えると、viewer 本体が表示されてテストが失敗する。どちらも確認済み。
- 実際のブログサービス(はてなブログ、Zenn など)が、このコードの `<iframe>` と `style` を通すかは、ローカルでは確かめられない。
