# 一度開いたスライドを手元に残す実装設計

[通信が切れても読める](../features/f37-offline-reading.md)(F37)の設計。2026-11-26 に、作業 O が書いた。実装は、この設計のとおりに、受け入れ条件ごとの PR に分けて積む。実装が設計と違ったときは、この文書を直す。

## 先に確かめたこと(D-95)

別サイトの枠の中で、Service Worker と Cache Storage が使えるかを、Playwright(1.64.1)で、Chromium 156、Firefox 157、WebKit 27.2 に試した(2026-11-26)。試験は [`src/offline/frame-support.browser.test.ts`](../../src/offline/frame-support.browser.test.ts)。ふつうの HTTP サーバーを使い、ブラウザー自身の通信で動かす(Playwright の経路の差し替えは Service Worker の通信を通さないため)。管理 origin に当たる `localhost` の中に、版の origin に当たる `d-abc.localhost` の枠を、viewer と同じ `sandbox="allow-scripts allow-same-origin"` で置いた。

| 試したこと | Chromium | Firefox | WebKit |
| --- | --- | --- | --- |
| 枠の中で Service Worker を登録し、`ready` まで進む | 使える | 使える | 使える |
| 枠の中で Cache Storage に書いて読む | 使える | 使える | 使える |
| 登録の次の読み込みから、枠が Service Worker に管理される | される | される | される |
| 枠の origin が応答しない、または `503` のとき、保存したページが出る | 出る | 出る | 出る |
| CSP `worker-src` に、Service Worker の URL(パスまで)だけを書く | その URL は登録でき、作者の `/author-sw.js` は拒否 | 同じ | 同じ |
| CSP `worker-src 'none'`(いまの配信) | 拒否 | 拒否 | 拒否 |
| 枠の `sandbox` から `allow-same-origin` を外す | Cache Storage が使えない | 使えない | 使えない |
| Firefox の設定で、サードパーティの Cookie をすべて止める(`network.cookie.cookieBehavior = 1`) | (対象外) | 登録が拒否される。枠の画面は今までどおり | (対象外) |

結論: 3 つのブラウザーのすべてで使える。D-95 の「3 つとも使えない」には当たらないので、F37-AC1 から AC16 を実装する。使えない設定(上の最後の行)では、登録が拒否されるか、`serviceWorker` が無い。そのとき枠は何もせず、スライドは今までどおり出る(F37-AC17)。

試験で確かめられていないこと(人の確認に挙げる)。

- **保存の場所の分け方(partitioning)。** 実際の Chrome 115 以降、Firefox 103 以降、Safari は、別サイトの枠の Service Worker と Cache Storage を、上のサイトごとに分ける。Playwright の Chromium は、起動の既定の引数で `ThirdPartyStoragePartitioning` を止めているので、試験では分かれていない。この設計は、分かれていてもいなくても正しく動くように作る(後の節)。
- **実機の iOS の Safari。** Playwright の WebKit は、Safari の「サイト越えトラッキングを防ぐ」の設定と同じではない。実機で、枠の登録と通信が切れたときの表示を確かめる。

確かめた公式の文書(2026-11-26)。

- [MDN: State Partitioning](https://developer.mozilla.org/en-US/docs/Web/Privacy/Guides/State_Partitioning): Firefox は DOM Cache、Shared Workers、Service Workers を、上のサイトごとに分ける。103 から既定。
- [Chrome: Storage Partitioning](https://privacysandbox.google.com/cookies/storage-partitioning): 「Service Workers registered from a third-party context are now partitioned」。Cache storage も分ける。Chrome 115 から。
- [MDN: ServiceWorkerContainer.register()](https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerContainer/register): script と scope は登録するページと同じ origin。広い scope は `Service-Worker-Allowed` が要る。secure context(`localhost` と `https`)だけ。
- [MDN: CSP worker-src](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/worker-src): `ServiceWorker` の script を制限する。パスの決まりは [CSP の仕様](https://www.w3.org/TR/CSP3/#match-paths)(`/` で終わらないパスは、同じパスだけに合う)に従う。上の試験で、3 つのブラウザーが同じに動くことを確かめた。
- [WebKit: Full Third-Party Cookie Blocking and More](https://webkit.org/blog/10218/full-third-party-cookie-blocking-and-more/): Service Worker の登録と保存は、Safari を 7 日使っても、そのサイトに操作が無いと消える。この記事は、枠の中の扱いを書いていない。

## 何を、どこに置くか

```text
  読者のブラウザー
  ┌────────────────────────── 管理 origin(slide.community) ─────────────────────────┐
  │ viewer のページ ── 枠 ─→ 版の origin(d-<ID>.slideusercontent.com)               │
  │  share.js が offline-client.js を読む     ├ 版の Service Worker(/_preview/sw.js) │
  │  管理の Service Worker(/offline-sw.js)    └ 版の Cache Storage(その版だけ)       │
  │  管理の Cache Storage(開いた版の一覧)                                           │
  └──────────────────────────────────────────────────────────────────────────────────┘
```

Service Worker は 2 つある。同じ `src/offline/sw-entry.ts` から作る 1 つの script で、置かれた URL で役を決める。

| | 版の Service Worker | 管理の Service Worker |
| --- | --- | --- |
| origin と URL | 版の origin の `/_preview/sw.js` | 管理 origin の `/offline-sw.js` |
| scope | `/`(その版の origin 全部) | `/@`(共有 URL だけ) |
| 保存するもの | その版のファイル(同じ origin の GET の `200`) | 持たない(一覧は viewer の script が書く) |
| 役 | 版のファイルを、取りに行ってだめなときだけ保存から返す | 共有 URL の読み込みが、取りに行ってだめなときだけ、保存した viewer の殻を返す |

### 作者のファイルのパスと重ならないこと(F37-AC18)

版の origin の `_preview/` で始まるパスは、作者のファイルを返さない決まりである(`src/preview/access.ts` の `requestedFile` が `null` にする)。版の Service Worker(`/_preview/sw.js`)、その版が読む script(`/_preview/offline.js`)、保存を消すページ(`/_preview/evict`)は、すべてこの下に置く。作者が `_preview/sw.js` というファイルを置いても、取り出せず、Service Worker を隠せない。試験で、そのファイルを置いたスライドを開いて確かめる。

管理 origin では、`/offline-sw.js`、`/offline-client.js` は `public/` の静的なファイルで、作者のファイルは管理 origin に無い。

## 版の origin の CSP(D-96)

いまの配信の CSP は `worker-src 'none'` で、作者のファイルが Service Worker を登録できない。これを、一般公開の版のファイルについてだけ、次のように変える。

```text
sandbox allow-scripts allow-same-origin; worker-src <版の origin>/_preview/sw.js; frame-ancestors *
```

- `worker-src` が名指しするのは、サービスの Service Worker の URL 1 つだけである。作者が `/sw.js` などを登録しようとしても、3 つのブラウザーが拒否する(上の表)。作者のファイルが自分で Service Worker を登録する組み合わせは、起きない。そのため、D-96 の「決まりを守れない組み合わせ」は無く、その版を保存しない場合も無い(F37-AC19 は、この拒否を確かめる試験で満たす)。
- 作者限定で配るファイル(作者だけが見られる版)は、今までどおり `worker-src 'none'`。
- 作者の script が、サービスの Service Worker を自分で登録することはできる。同じ script なので、何も増えない。scope を狭くしても、できるのは管理する範囲を狭めることだけである。
- 配信のキャッシュの指定(`no-cache, no-transform`)と、配ってよいかを毎回確かめる仕組みは変えない(D-97、F37-AC20)。

## 取りに行く順番と、保存したものを見せる条件(D-91、D-92、D-93)

版の Service Worker が、同じ origin の GET の要求を受けるたびに、先に必ずサービスへ取りに行く。`/_preview/` の下の要求と、別の origin への要求は、何もしない。

| 取りに行った結果 | することと、返すもの |
| --- | --- |
| `200`(転送されたものでなく、`Cache-Control` に `private` も `no-store` も無い) | 保存を入れ替え(F37-AC6)、届いたものを返す。保存の印の `X-Slide-Stored-At`(取れた時刻、ミリ秒)を付けて書く |
| 最初のページ(`/`、`/index.html`)への `404`、`410`、`403`、`401`、または `private`・`no-store` の `200` | その版の保存をすべて消し(F37-AC7〜AC9)、届いたものを返す。`401` と `private`・`no-store` の `200` は、作者の確認用の版(公開の版ではなくなった)の答えである |
| 最初のページ以外への `404`、`410`、`403`、`401`、`private`・`no-store` の `200` | 何も消さず、保存もせず、届いたものを返す。1 つのファイルの `404` が、版の保存全部を消さないためである |
| `429`、`5xx`(メンテナンスの `503` を含む) | 保存したものがあり、1 日以内なら、それを返す。無ければ、届いたものを返す |
| 通信できない、つながらない | 保存したものがあり、1 日以内なら、それを返す。無ければ、ブラウザーの失敗のまま |
| それ以外(`3xx`、ほかの `4xx`、`206`、`304`) | 保存せず、届いたものを返す |

`Cache-Control` に `private` か `no-store` がある応答は、作者だけに配るもので、保存しない。一般公開の版の応答は、`no-cache, no-transform` で、保存できる。

消す合図が来たときに、まだ書いている途中のファイルがあっても、消した後に書き戻さない(版の Service Worker が、消した回数を数え、取りに行った時点と書く時点で食い違えば、書かない。書いた後に食い違えば、取り除く)。

最初のページを保存から返すのは、viewer の枠(`request.destination === 'iframe'`)のときだけである。帯を出せる文脈でない読み込み(その origin を直接開く、など)には、保存した最初のページを返さない。

メンテナンス中の `503`(D-121)は、`5xx` の 1 つとして、同じに扱う。[メンテナンスの実装設計](maintenance.md)(作業 N)は、メンテナンス中の応答に `X-Slide-Maintenance` を付け、`503` で `Retry-After` を付ける。O は応答の本文を読まず、状態の数字だけで決めるので、印の有無で枝分かれしない。管理 origin の `503`(viewer のページ)も、配信 origin の `503` も、同じ決まりである。

通信できるときの応答の速さは、落とさない。版の Service Worker は、`fetch` の中で、先に保存を読むことはしない。サービスへの要求を先に出し、保存への書き込みは、応答を返した後に行う(`waitUntil`)。ナビゲーションの先読み(Navigation Preload)は、版の Service Worker では使わない。有効にすると、Firefox 157 は、接続が切られたときのナビゲーションを、Service Worker が保存から答える前に失敗させた(2026-11-26、`version-offline.browser.test.ts` の最初の試験が Firefox だけで落ちた)。先読みが無くても、枠の読み込みは、Service Worker の起動のぶんしか遅れない。

### 保存した版を見せていることを、帯に伝える(F37-AC2、AC13、AC14)

保存した最初のページ(`/`)を返すとき、版の Service Worker は、ページに差し込んである script(`pageScript`)の中の、時刻の印 `slide-stored-at` を、保存の時刻に置き換える。script は、その印が入っていれば、viewer に `slide:stored` を送る。viewer が後から聞き始めたときのために、`slide:page-request` への答えでも送る(いまのページの通知と同じ形)。

**伝わらないときは、保存した版を見せない側に倒す。** 印が見つからないページ(差し込みができなかったもの。UTF-8 でない、5 MiB を超える、`head` が読めない、など)は、そもそも保存しないし、保存してあっても返さない。印の置き換えが 1 か所でなければ、保存を返さない。伝える側(script)が走らない場合は、枠の script が無いので、viewer は帯を出せない。そのため、viewer は、枠が「保存を使える」と答えたときだけ、保存の殻を書く(次の節)。

最初のページ以外のファイルを保存から返したときは、帯を出さない。画面は、最初のページで決まるためである。

## 保存を始めるのは viewer(D-94 の前提)

枠の中の script(`pageScript`)は、自分では何も登録しない。viewer の script が、枠に頼んだときだけ登録する。ほかのサイトに埋め込まれた枠は、頼まれないので、登録しない。

1. viewer のページ(`share.js` から `offline-client.js` を読む)が、一般公開の版の viewer で、`navigator.serviceWorker` と `caches` があるときだけ動く。枠が読み込めたら、枠に `slide:offline-register` を送る。
2. 枠の `pageScript` が、`event.source` が親で、`event.origin` が viewer の origin のときだけ、`/_preview/offline.js` を読み込む。その script が、版の Service Worker を登録し、有効になるまで待つ。まだ枠を管理していない(初めて開いた)ときは、`performance.getEntriesByType('resource')` の同じ origin の URL と、枠自身の URL を、Service Worker に渡して保存させる。次からは、Service Worker が、取りに行くたびに保存する。
3. 保存できたら、枠が viewer に `slide:offline-state`(`stored`)を送る。枠の最初のページに印が無いなど、保存できなかったときは `unsupported` を送る。登録が拒否された、`serviceWorker` が無い、などでは、何も送らない(エラーも出さない。F37-AC17)。
4. viewer の script は、`stored` を受けたときだけ、管理の Service Worker を登録し、開いた版の一覧に書く(次の節)。

先読み(performance の記録)は、ブラウザーの上限(250 件)までしか見えない。それより多い読み込みを持つスライドは、残りを、次に開いたときに、読み込みのたびに保存する。最初の 1 回で全部が残る保証は無い。ここで残る保証は、「保存の印があるファイルだけが、保存から返る」ことである。

## 開いた版の一覧と、1 日、20 本(D-94)

版はそれぞれ別の origin なので、版の Service Worker は、自分の版のことしか知らない。本数と期限は、管理 origin の側(viewer の script)が持つ。

一覧は、管理 origin の Cache Storage の `slide-offline-viewer` に置く。共有 URL ごとに 1 件(ページ番号は除く。`/@handle/slug`)。

| 部分 | 中身 |
| --- | --- |
| キー | `https://<管理 origin>/@handle/slug` |
| 本体 | viewer の殻(次の節)の HTML |
| `X-Slide-Stored-At` | 最後に通信で取れた時刻(ミリ秒)。開いて、枠が `stored` を返すたびに更新する |
| `X-Slide-Content-Origin` | その版の origin |

- **1 日の数え方(F37-AC10)。** `X-Slide-Stored-At` から 86400 秒(1 日)。ちょうど 86400 秒は、まだ使える。それを過ぎたものは、管理の Service Worker が返さない。版の Service Worker も、ファイルごとの `X-Slide-Stored-At` で同じに調べる。ただし、作者の script は、自分の版の保存に書けるので、版の側の時刻は作者が偽れる。管理の側が決める時刻が、本当の門である。
- **20 本の数え方(F37-AC11)。** viewer の script は、書き込みのたびに、一覧を読み、`planPrune`(純粋な関数)で、期限を過ぎたものと、新しい方から 20 本を超えるもの(最後に開いた時刻の古い順)を決める。それらを消す。
- **消すこと。** 一覧の件を消し、その版の origin を「消す予定」(管理 origin の Cache Storage の `slide-offline-evict`)に載せる。そのうえで、その版の枠に、保存を消すように伝える。版の保存は別の origin にあり、その origin の枠からしか届かない。viewer の CSP は、いま開いている版だけを枠に入れてよいと言う(F03-AC63)ので、広げない。代わりに、viewer が、管理 origin の `/_offline/evict#<版の origin>`(`X-Frame-Options: SAMEORIGIN`、この origin だけが枠に入れられる)を隠した枠で開く。そのページは、版の origin を検査して(`d-<UUID>.<コンテンツドメイン>` の形だけ)、版の `/_preview/evict` をさらに枠に入れる。後者は、その origin の Service Worker の登録を外し、Cache Storage を消して `slide:offline-evicted` を送る。管理のページが、それを viewer に渡す。2 つの消すページ(`/_preview/evict`、`/_offline/evict`)は、`Sec-Fetch-Dest: iframe` のときだけ答える(リンクを開いても何も消えない。ヘッダーを送らないブラウザーは、今までどおり答える)。管理の側は、さらに `Sec-Fetch-Site` が `same-origin` か `same-site` のときだけ答える。版の側は、管理 origin とは別のサイトから枠に入れられるので、サイトは問わない。消せたら「消す予定」の件を外す。通信できないなどで消せなかったものは、次に一般公開のスライドを通信できる状態で開いたときにやり直す(次の項)。
- **消す時機(F37-AC22)。** `prune`(期限と 20 本の判断、「消す予定」の消化)は、版を保存したとき(`keepShell`)に加えて、viewer の script が動き始め、ページが読み込まれたあと(枠の読み込みを待つ `load`。このモジュールは遅れて読まれるので、すでに済んでいれば、すぐ)にも動く。最初の表示と競わないためである。そのため、取り下げ、差し替え、期限切れ、20 本を超えたもので消す予定に載った版は、別の一般公開のスライドを開くだけで、その版を保存できたかによらず消える。`prune` は 1 本ずつしか動かない(`singleFlight`)。動いている間にもう一度頼まれたら、並べて動かさず、終わってから 1 回だけ、続けて動かす(いま書いた件を、動いているほうが読み損ねていることがあるため)。書き込みの数、追い出す順(`planPrune`)、20 本、1 日は変えない。期限切れの件が、早く消えるだけである。
- **版が変わったとき(差し替え)。** 同じ共有 URL に、別の版の origin が書かれたら、前の版を消す。

## viewer のページを通信できないときに出す(殻)

viewer のページそのもの(作者の記事、引用、操作を含む)は、読者ごとに中身が変わる(ミュート、作者の下書きの記事など)。それを保存すると、別の人に出すおそれがある。そこで、保存するのは、読者によらない小さな「殻」だけにする。

- 殻は、題名、枠、保存した版の帯だけ。サービスが作る HTML(`src/offline/shell-page.ts`)で、viewer のページの中の、隠した要素の属性 `data-offline-shell` に、エスケープして入っている(`<template>` では、`html` や `head` が落ちるため)。題名は作者のもので、文字として入る。読者の情報は入らない。一般公開の版を、作者でない見方でも同じに出せるときだけ(作者限定の版、記事のプレビュー、表紙だけの表示には、入れない)。
- 帯は、`role="status"` と `aria-live="polite"` を持つ入れ物に、「接続できないため、保存した版を表示しています。」と「もう一度読み込む」を入れて出す。出す前の入れ物は空である。日本語と英語は、殻を作ったときの言語で書く。帯のボタンは、高さ 44px 以上。
- 通常の viewer のページにも、スライドの枠の上に、同じ入れ物(空の `role="status"` と、帯の `<template>`)が入る。通信はできるが、枠が保存から返したとき(版の origin だけが応えないとき)に、同じ帯を出す。
- 殻の script(`/offline-client.js`)は、管理の Service Worker が、取りに行く間の保存から返す(インストールのときに先に保存する)。殻の CSP は、管理の Service Worker が、版の origin の形を検査して作る(`default-src 'none'; frame-src <版の origin>; script-src 'self'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`)。

### 管理の Service Worker の決まり

共有 URL(`/@handle/slug`、`/@handle/slug/<ページ>`)のナビゲーションだけを扱う。ほかは何もしない。

| 取りに行った結果 | することと、返すもの |
| --- | --- |
| `200`(転送されたものでなく、枠の中のリンク先の小さなページでもない) | 届いたものを返す(帯は出ない。F37-AC5)。返したあとで、一覧の件が、届いた応答の `X-Slide-Content-Origin` と食い違えば(違う版、またはヘッダーが無い)、件を消し、消す予定に載せる(F37-AC21)。件が無ければ何もしない |
| `404`、`410`、`403` | 一覧の件を消し、消す予定に載せる(F37-AC7〜AC9)。届いたものを返す |
| `429`、`5xx`、通信できない | 一覧に件があり、1 日以内なら、殻を返す。無ければ、届いたものを返す(F37-AC12) |
| それ以外 | 何もしない |

`X-Slide-Content-Origin` は、サービスが、殻を出す一般公開の viewer の応答にだけ付ける(値は、見せている版の origin)。作者の下見には付けない。`Cache-Control` では、下見とログインした読者の応答を見分けられない(どちらも `private, no-store`)ので、ヘッダーで見分ける。判定を viewer の script に置かないのは、作者の下見のページには殻が無く、`share.js` が `offline-client.js` を読み込まないからである。判定は管理の Service Worker に置き、純粋な `isSuperseded`(`src/offline/records.ts`)で食い違いを決める。通信できないときに殻を返す経路は通らないので、通信できないときの表示は消えない。

残る危険が 2 つある。

- viewer の script が殻を書く `keepShell` と、この判定が呼ぶ `forget` が競合すると、書いたばかりの新しい保存を消すことがある。消えたときは、その版は通信できないときに読めない(安全側の失敗)。次に通信できるとき開けば、また保存される。
- この判定は、新しい Service Worker にだけある。古い Service Worker は、更新が届くまで(最大 1 日)、差し替えられた版の保存を消さない。

「もう一度読み込む」(殻のボタン)は、`location.reload()` である。通信が戻っていれば、`200` で viewer のページが読め、帯は消える。戻っていなければ、また殻が返り、帯が残る(F37-AC13)。

## 保存の対象

一般公開の公開中の版だけを保存する(迷ったときの決め)。限定公開(作者だけが見られる)の版と、非公開(下書き、停止中)の版は、対象にしない。作者だけが見られる版は、viewer が殻を出さず、版の側も `private`、`no-store` の応答を保存しないので、保存の門に入らない。公開を止めた、差し替えた、運営が非表示にした版の保存が、通信できるときに消えることは、次の 3 つの場合の試験で確かめる。

| 場合 | 確かめること |
| --- | --- |
| 作者が公開を止めた(非公開にした) | 通信できるとき、共有 URL が `404` で、一覧の件が消える。通信できないときは、保存した版が出る(読者は知りようがない。1 日で消える) |
| 別の版に差し替えた | 通信できるとき、新しい版が開き、前の版が消える。前の版の origin は `404` を返し、保存が消える |
| 運営が非表示にした | 通信できるとき、`404` で一覧の件が消える |

「通信できないときに、止めたことを知る方法は無い」ことは、仕組みの限界であり、1 日の期限が上限になる。

## 作者のファイルが自分で Service Worker を登録している場合(D-96)

上の CSP で、作者の script による登録は、3 つのブラウザーで拒否される。作者のファイルが `<script>` で `navigator.serviceWorker.register('/sw.js')` を呼んでも、`SecurityError` になり、スライドは今までどおり動く。作者の Service Worker が、サービスの `404`、`410`、`403` で消す決まりを避けることは、起きない。

作者の script が、自分の版の Cache Storage に、偽の保存を書くことはできる。ただし、(1) その版の origin の中だけで、別の版や管理 origin に触れない(origin ごとに分かれる)。(2) 見せる門は、管理 origin の一覧で、時刻と本数を管理の側が決める。(3) 作者が見せられるのは、作者がもともと配れる内容である。作者が公開を止めても、すでに開いた読者の端末に、1 日は残ることは、F37 の受け入れる限界である。

## 使えないブラウザー(F37-AC17)

次のとき、何もしない。エラーを出さず、帯も出さない。

- `navigator.serviceWorker` か `caches` が無い。
- 登録が拒否される(第三者の保存を止める設定、CSP、プライベートの閲覧)。
- 枠の最初のページに印が無い。
- 管理 origin の `caches` に書けない。

すべての呼び出しを `try/catch` で囲み、`await` の失敗は、静かに捨てる。

## 保存したものを利用者が消す方法(ヘルプの材料)

画面に消すボタンは足さない。ブラウザーの設定で消す。ヘルプ(作業 H2)に書く材料。

- 「サイトのデータを消す」で、slide.community と slideusercontent.com のデータを消す。サイトごとに分けて保存されるので、`slideusercontent.com`(版の origin)のデータが、保存の本体である。
- Chrome: 設定 → プライバシーとセキュリティ → サードパーティ Cookie / サイトデータ。Firefox: 設定 → プライバシーとセキュリティ → Cookie とサイトデータ → データを管理。Safari: 設定 → プライバシー → Web サイトデータを管理。
- 1 日を過ぎたものと、21 本目を超えたものは、次に viewer を開いたときに、自動で消える。

## 範囲外

一度も開いていないスライドを先に保存すること。アプリとして入れられるようにすること。通信できないあいだの操作。管理 origin のほかのページの保存。配信のキャッシュの指定を変えること。

## 人の確認

- 実機の iOS の Safari(と、Chrome、Firefox の実機)で、通信を切って、同じ URL が出て、帯が出ること。
- 実機と本番の回線で、通信できるときの共有 URL の応答の速さが、変更の前と変わらないこと(上の測定は、ローカルの回線)。サイトごとの分け方の下で、枠の登録が動くこと。
- Safari の 7 日の上限(サイトに操作が無いと、スクリプトで書いた保存が消える)の下で、読めなくなる場合の見え方。

## 通信できるときの応答の速さ(測定)

2026-11-26、Chromium 156、ローカルの Worker(HTTP)。読者が開く操作を 15 回(毎回、新しいタブ)くり返し、中央値を取った。2 回の組を、Service Worker を止めた文脈(`serviceWorkers: 'block'`)と、働いている文脈で比べた(マシンの負荷が高く、揺れが大きい)。

| 測ったもの | Service Worker なし | あり |
| --- | --- | --- |
| 共有 URL の読み込みから、viewer の枠が出るまで | 112 ms、110 ms | 114 ms、112 ms |
| 同じ読み込みから、枠の中の最初のページが見えるまで | 143 ms、136 ms | 143 ms、145 ms |

差は揺れの範囲だった。管理の Service Worker は、共有 URL の読み込みを、先にサービスに取りに行き、届いたものを手を加えずに返す。保存の読み書きは、その応答を返すより前に待たない。ただし、Service Worker が止まっている状態から起動するぶんの遅れは、ナビゲーションの先読みなしでは避けられない(ここでは、15 回の間に止まらなかった可能性がある)。実機と本番の回線での測定は、人の確認に挙げる。

## 版の origin の検査

殻に書かれた版の origin を、CSP に入れる前、枠に入れる前、消す予定に載せる前に、`isVersionOrigin` で検査する。設定の配信ドメイン(`CONTENT_ORIGIN`)の下の `d-<UUID>` で、プロトコルとポートまで同じで、origin のほかに何も付かないものだけを通す。配信ドメインは、サービスが viewer のページに `data-content-base` として書き、viewer の script が、管理の Service Worker を `/offline-sw.js?base=<配信ドメインの origin>` で登録するときに渡す。殻と管理の消すページにも書く。`base` が無い、または読めない Service Worker は、殻を出さない。

## 保存できたかどうか

枠が「保存できた」と答えるのは、最初のページが保存にあり、先読みの URL のどれも、取れない・書けないで失敗していないときだけである(容量の上限で 1 つでも書けなければ `unsupported`)。その版には殻を書かない。サービスが `404` を返した URL(たとえば、ページが探した `favicon.ico`)は、失敗に数えない。
