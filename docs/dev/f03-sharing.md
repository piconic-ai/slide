# 共有 URL と配信の実装設計

[URL を渡して読んでもらう](../features/f03-sharing.md) を scope1 で実装するための契約。公開状態・作者限定の閲覧・版ごとの origin は [公開管理の実装設計](f02-publication.md) を使い、ここでは共有 URL と読者向けの配信を扱う。全体の方針は [URL と HTML の隔離](design.md#url-と-html-の隔離) と [キャッシュの位置](design.md#キャッシュの位置) を参照する。

## handle

共有 URL の `@handle` は `accounts` の `handle` で、所有者の GitHub login を小文字にした値を最初のログイン時に記録する。GitHub の login は大文字小文字を区別しないので、小文字の表記を一つに決める。0010 の時点でログイン中の所有者は、`owner_sessions` の login から作る。ログアウト済みなら次のログインで作る。handle にできない login や、別の利用者がすでに持つ handle は記録せず、ログインは止めない。その所有者の共有 URL は開けない。

GitHub 側で改名しても handle は変えない。渡した URL が切れないことを優先する。handle は URL で deck を指すだけで、認可には使わない。退会すると handle も消え、再びログインするとその時点の login から作り直す。改名への追随と旧名の予約（他人に渡さない）は複数の作者を受け入れる段階で扱う。

## 共有 URL

`GET /@handle/slug` は管理 origin で、信頼する viewer を返す。`slug` は deck の ID。viewer は版の題名（`<title>`、なければ deck の ID）を表示し、作者のプロフィールへリンクする。版が description（`<meta name="description">`）を持つときは、題名と作者の下に表示する。共有 URL を貼られたサービスが題名と説明を出せるよう、`og:title`・`og:url`・`og:type`・`og:site_name`・`twitter:card` と、description があるときは `description`・`og:description` を出す。表紙の画像は `og:image` に出し、`twitter:card` は `summary_large_image` にする。表紙は、版が `<meta property="og:image">` でその版自身の画像ファイルを指すときはその画像（版の origin の URL）、指さないときはサービスが撮る 1 枚目の画像（[表紙の画像](#表紙の画像)）である。

`GET /start` は新規登録とログインの入口で、GitHub でのログイン（`/auth/github`）へ進むボタンと、そのあとの流れを示す。新規登録とログインは同じ操作なので、入口は 1 つにしている。ログイン済みの作者が開いたときは `/slides` へ 303 で送る。ヘッダーの右側は、ページを返す時点では空にしておく。トップページが静的なファイルで、返す時点では誰が見ているか分からないため、どのページも同じ方法にしている。`/share.js` が `GET /api/session`（`{ signedIn: false }` か `{ signedIn: true, login, handle }`、`no-store`）を読み、ログインしていなければ「はじめる」（`/start`）を入れる。ログイン中なら、スライドを追加する「+」（`/slides/new`）と、login の頭文字のアイコンを入れる。アイコンを押すとメニューが開き、プロフィール（`/@handle`、ハンドルがあるとき）、スライドの管理（`/slides`）、設定（`/settings`）、ログアウトが並ぶ。メニューは外側のクリックと Escape で閉じる。メニューの言葉は、ページが `data-*` 属性で渡す。直前の答えはその browser の `localStorage`（`slide:session`）に置き、次のページでは答えを待たずにそれを描いてから、新しい答えで直す。毎回遅れて現れるのを避けるためで、置いた値は描画の手がかりにしか使わない。ログアウトと退会の form を送るときは、置いた値を消す。次のページで、答えが届くまで前のアイコンが残らないようにするためである。初めて開いたときに答えが読めなければ「はじめる」を出し、すでに描いたものがあれば残す。script が動かない環境には `<noscript>` で「はじめる」を出す。この request のために、管理画面の CSP に `connect-src 'self'` を入れている。

`GET /settings` は作者の設定で、プロフィール設定（GitHub から同期したプロフィール、最後に同期した日、「GitHub から同期し直す」、ハンドルとプロフィールへのリンク。ハンドルは GitHub のユーザー名から決まり、ここでは変えられない）と、アカウント設定（ログイン中の GitHub のユーザー名、ログアウト、退会）を置く。退会とログアウトは `/slides` の一覧から設定へ移した。未ログインでは 401 でログインを促す。

トップページの 2 つのボタンは常に `/start` を指す。

`GET /@handle` は作者のプロフィールで、GitHub から同期したプロフィール（[後述](#github-から同期するプロフィール)）と、その作者の一般公開中のスライドを、公開中の版を受け取った新しい順に最大 100 件並べる。トップページ（`/`）は、ヒーローの直後に全作者の一般公開中のスライドを同じ順に 10 件、横スクロールの表紙で並べ、その後にサービスの価値を「さわる」「わかる」「あつまる」「クリエイターへ」の順に説明する。説明の項目には実装完了・実装中・仕様検討中のラベルを付ける。説明に添える画面はサービス側の静的な見本で、作者の HTML は埋め込まない。作者の HTML はトップページで動かさない。最近のスライドの表紙は [表紙の画像](#表紙の画像) を `<img>` で出し、上に重ねたリンクが共有 URL を開く。画像を読み込み終えるまでと、読めなかったときは、題名の文字の表紙を出す。トップページは静的なファイルで、表示するスライドは応答の時点で決まらないため、CSP の `img-src` には `'self'` と配信ドメインの全ての版の origin（`https://*.<配信ドメイン>`）を許す。配信ドメインが未設定のときは `img-src` を出さず、表紙は題名の文字だけになる。

どちらも共有 URL と同じ公開ポインタを読むので、一覧に出るのは共有 URL が viewer を返すスライドだけで、作者のみ限定公開・下書き・停止中・削除済みのスライドは出ない。作者本人がログインして自分のプロフィールを開いたときだけ、管理画面へのリンクを出す。誰も持たない handle は、未公開の資料と同じ 404 を返す。大文字・`%40`・末尾の `/` の表記は正規の `/@handle` へ 301 で転送する。

トップページの HTML は `vite build` の最後に `vite.config.ts` のプラグインが Hono の `toSSG` で言語ごとに生成する。日本語は `public/index.html`、英語は `public/_home/en/index.html` である。スライドの一覧は BarefootJS のクライアントコンポーネント `components/RecentDecks.tsx` で、生成時には同じ大きさの仮の表紙だけを出し、表示後に `createQuery` で `GET /api/public/slides` から取得する。この API はログインなしで呼べ、`public, max-age=60` を付ける。「デモを動かせる。」の節の指数バックオフも、`components/BackoffDemo.tsx` のクライアントコンポーネントで、倍率と回数のスライダーを動かすと待ち時間と合計が変わる。計算は `src/share/backoff.ts` の純粋な関数にある。sandbox(`SandboxDemo`)、AI レビュー(`ReviewDemo`)、ノート(`NotesDemo`)の絵も同じくクライアントコンポーネントで、ボタンや評価軸、表示の切り替えに応じて中身が変わる。sandbox の絵は、止められたときの見え方を再現するもので、絵の中では何も実行しない。実際の viewer で親ページの移動・別タブ・フォーム送信が止まることは `src/share/viewer.browser.test.ts` で確かめている。ダウンロードは sandbox に `allow-downloads` を付けないことで止めており、ブラウザでのテストはない。`/` は Static Assets から直接返さず、Worker がリクエストの言語([画面の言語](i18n.md))に合うファイルを取り出して返す。ファイルごとに ETag が違うので、別の言語で見たページは 304 にならない。`/_home/` 以下を直接開いても Static Assets からは返さず、404 になる。返すときは管理画面と同じ CSP に `connect-src 'self'` を加えたものと `no-cache` を付ける。表示のたびに D1 は読まない。

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

## GitHub から同期するプロフィール

作者のプロフィールは slide では編集せず、GitHub の公開プロフィールから写す。同期するのは、名前（`name`）、ユーザー名（`login`）、プロフィール画像（`avatar_url`）、場所（`location`）、Web サイト（`blog`）、GitHub Sponsors のページがあるかどうかの 6 つで、D1 の `profiles`（主キーは GitHub の user ID）に置く。自己紹介や所属、メールアドレスは保存しない。

同期はログインのたびに行う。user token は callback の終わりに失効させるので、取得はその中で済ませる（`src/auth/routes.ts`）。名前などは Better Auth が読む `GET /user` の答えから取り、Sponsors の有無だけは REST にないため GraphQL（`viewer { hasSponsorsListing }`）を 1 回呼ぶ。保存するのは、ログインが session の発行まで進んだときだけである。Sponsors の答えが得られなかったとき（失敗、権限不足、3 秒以内に答えがないとき）もログインは通し、前回の値を残す。初回は「なし」とする。プロフィールの保存に失敗したときもログインは通し、次のログインで同期し直す。保存は、その作者の GitHub アカウントが認証の表に残っていることを同じ SQL 文の中で確かめる。ログインの終わりと退会が重なっても、退会した作者のプロフィールを作り直さないためである。設定ページの「GitHub から同期し直す」は `/auth/github?to=settings` へのリンクで、ログインをやり直して `/settings` に戻る。戻り先に指定できるのは `settings` だけで、それ以外は `/slides` になる。

GitHub の答えは境界で検証する（`src/profile/github-profile.ts`）。画像は `https://avatars.githubusercontent.com` のものだけ、Web サイトは `http`・`https` の URL だけを受け付け、scheme のない `example.com` は `https` として読む。名前と場所は 255 文字まで、URL は書き出した形で 2048 文字までとし、制御文字は空白として読む。空の項目と、合わない項目は「なし」として扱い、ログインは拒否しない。D1 から読むときも、画像とリンクの URL は同じ検証を通す。

プロフィールには、画像、名前（なければ `@handle`）、場所、Web サイト、GitHub のページ、Sponsors のページ（`https://github.com/sponsors/<login>`、あるときだけ）を出す。ユーザー名は表示とリンクに使うだけで、共有 URL の handle は最初のログイン時のまま変えない。画像は GitHub から直接読むので、管理 origin のページの CSP に `img-src https://avatars.githubusercontent.com` を入れている。ヘッダーのアイコンも、同期した画像があればそれを出す（`GET /api/session` が `avatarUrl` を 64px の大きさで返す）。画像が読めないときと、まだ同期していないときは、login の頭文字を出す。ページは `Referrer-Policy: no-referrer` なので、GitHub に読者の見ているページは伝わらないが、読者の IP アドレスは GitHub に届く。トップページの `img-src` は、これに表紙の画像の origin を加えたものである。

本番の GitHub App の user token で Sponsors の有無が取れるかは、まだ確かめていない。取れないときは、Sponsors のリンクが出ないだけで、ほかの項目は同期される。

## viewer

viewer は `src/share/pages.ts` のサービス自身の markup と `/share.js` だけを実行する。

- iframe は `sandbox="allow-scripts allow-same-origin"`、`referrerpolicy="no-referrer"`、`allow="fullscreen"`。top navigation・popup・download・form を許さない。作者の JS はその deployment の origin で動き、管理 origin の cookie や DOM には届かない。
- CSP は `default-src 'none'; frame-src <deployment の origin> 'self' <引用で埋め込むスライドの origin> <投稿の埋め込みの origin>; script-src 'self'; style-src 'unsafe-inline'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`。viewer 自体は他のサイトに埋め込ませない。
- 「リンクをコピー」は共有 URL を clipboard に書く。clipboard が使えない環境では URL を選択状態にする。deployment の origin を直接開く導線は置かない([引用と SNS の反応を試す](reactions-trial.md)の試作で外した。出回る URL を共有 URL だけにするため)。
- 作者の JS から viewer へ要求を送る経路はない。viewer が受け取る `postMessage` は、サービス自身の origin が本体の iframe の中から送る「この共有 URL を開く」依頼だけで、共有 URL の path でなければ無視する。ほかに、X と Bluesky の埋め込みが自分の高さを知らせる message を受け取り、その iframe の高さだけを変える。仕組みは[引用と SNS の反応を試す](reactions-trial.md)を参照。

作者の管理画面（`/slides/:deck`）は、一般公開中で配信が設定されているとき、同じ共有 URL とコピー操作を表示する。管理画面の CSP は `/share.js` を読むため `script-src 'self'` を許す。

## 読者向けの配信と内部 cache

版の origin への匿名の request は、F02 の [配信の認可と失効](f02-publication.md#配信の認可と失効) と同じく毎回 D1 で認可する。認可を通った一般公開の file だけが、Workers Cache を有効にした名前付き entrypoint `ContentFiles`（`worker.ts`）を `ctx.exports` 経由で呼び、保存済みの bytes を読む。

| 項目 | 内容 |
| --- | --- |
| 内部 URL と cache key | `https://content-files.internal/<revision>/<deployment ID>/<sha256>/<object key>`（各部分は URL エンコード）。Workers Cache の key は path で、request の host を含まない。deployment と file の digest を path に入れるので、別の deck や版の同じ `/index.html` は別の entry になる |
| revision | `src/preview/stored-file.ts` の `CONTENT_CACHE_REVISION`。同じ file でも返す bytes を変えるときに上げる |
| 内部の応答 | `Cache-Control: public, max-age=31536000, immutable`、`Cache-Tag: deployment-<ID>`。見つからない object は `no-store` の 404 で cache しない |
| 読者への応答 | gateway が header を付け直す。`Cache-Control: no-cache, no-transform`、weak の `ETag: W/"<sha256>"`、F02 の CSP。内部の長い TTL は browser に渡さない。`X-Content-Cache` に内部 cache の `Cf-Cache-Status`（`HIT`・`MISS` など）を写す |
| 作者限定の閲覧 | 共有 cache を通さず R2 から直接読み、`private, no-store` を返す |

停止・置き換えの後は、内部 cache が温まっていても gateway の認可で 404 になり、`ContentFiles` は呼ばれない。cache の purge は失効の手段にしない。deck を削除して R2 の object を消した後も、内部 cache の entry は期限まで残りうるが、D1 が拒否するので配信されない。消したいときは `Cache-Tag` で手動に purge する。自動の purge は実装していない。

`cross_version_cache` は entrypoint ごとには指定できないので、top level の `cache` に `enabled: false` と合わせて指定する。cache を有効にした `ContentFiles` だけに効き、Worker の version をまたいで entry を使い回す。返す bytes を変えるときは revision を上げ、古い entry を読まないようにする。デプロイ後に温まった file が `HIT` のままかは本番で確かめる。

`ContentFiles` は route を持たない名前付き entrypoint で、外部の request は届かない。default の entrypoint は cache を無効にし、すべての request を認可する。R2 bucket は公開せず、r2.dev の development URL も使わない。

ETag は weak にする。Cloudflare は圧縮した応答から strong な `ETag` を外すため、F02 の strong な `ETag` では browser の再検証で 304 を返せなかった。`If-None-Match` は weak 比較で照合し、一覧・`*`・strong 表記も受け付ける。ただし、HTML を書き換えうる機能（Email Obfuscation、Automatic HTTPS Rewrites、Replace insecure JavaScript libraries）が有効だと、Cloudflare は weak な `ETag` も外す（[ETag の文書](https://developers.cloudflare.com/cache/reference/etag-headers/)）。2026-11-07 の反映後、当時の試用の配信ドメイン（`kobaken.co`）の版の origin では配信した HTML が保存した bytes と一致したまま `ETag` だけが外れ、304 にならなかった。最初の 2 つを Configuration Rule で Off にしても外れたままで、zone の Replace insecure JavaScript libraries を一時的に Off にすると `ETag` が付き 304 が返った。この機能は zone 全体にしか設定できず、同じ zone のほかのサイトの守りも外れる。そこで作者のファイルの応答に `no-transform` を付け、本文を書き換えないよう edge に伝える。作者の bytes をそのまま届けるという約束にも合う。代わりに Cloudflare は応答を圧縮しない。反映後、最初の 2 つを Off にしていた Configuration Rule も無効にし、3 つとも zone で On のまま `ETag` が残り 304 が返ることを確かめた。そのため配信用 zone に Configuration Rule は置かない（[本番に反映する](deploy.md#初回の設定)）。

`ctx` のない呼び出し（テスト）では R2 を直接読む。ローカルの `wrangler dev` は `ctx.exports` を通すが cache は再現しないので、`X-Content-Cache` は `none` になる。cache の cold・warm は Workers Cache を模したテスト（`src/preview/content-cache.test.ts`）と、本番の `X-Content-Cache` で確かめる。


## 対応ブラウザと外部依存

最初に対応するのは、デスクトップの Chrome・Edge・Firefox・Safari と、スマートフォンの iOS Safari・Android Chrome の最新版。page adapter のない deck も元の HTML のまま表示し、ページの判定はしない。操作は資料自身の JS に任せる。キーボード操作のため、viewer は読み込み時に iframe へ focus を移す。

iOS Safari は、touch の処理が登録された場所にだけ touch を送る。別の origin の iframe の中では、資料の `window`・`document` に付けた処理をこの判定に数えない。そのため `window` だけでスワイプを受け取る資料は、viewer の中では touch を 1 つも受け取れず、進まなかった（2026-11-07、iOS 18.7 の Safari 26.6.3。資料だけで開くと進み、Android Chrome は viewer の中でも進んだ）。資料の要素に touch の処理が 1 つでもあると、`window` にも届いた。viewer は `/share.js` で iframe 要素に何もしない passive な `touchstart` の処理を登録し、iframe の場所を touch の処理ありとみなさせる。実機で、`window` だけで受け取る資料が viewer の中でもスワイプで進むことを確かめた。

タップは別の仕組みで、viewer では直せない。iOS Safari は、リンク・ボタン・click の処理が付いた要素など、クリックできると判定した要素でしか `click` を出さない。`window` に付けた処理は判定に数えないので、`window` でタップを受け取る資料は、資料だけで開いても iPhone ではタップで進まない。資料の作者は、タップの処理をスライドの要素に付ける（[slide-sample](https://github.com/piconic-ai/slide-sample) の `nav.js` を参照）。

作者のファイルの CSP は `sandbox`・`worker-src`・`frame-ancestors` だけを制限し、外部の font・script・画像の読み込みと `fetch` は止めない。止めるかわりに、通信先を実測して読者に見せる([外部との通信の実測](#外部との通信の実測))。サービスは外部 URL を proxy せず、外部依存の可用性は作者の責任とする。発表で確実に使う資料は、依存を deployment に含めることを勧める。

自動の確認は `src/share/viewer.browser.test.ts` で行う。engine は環境変数 `BROWSER`（`chromium`・`webkit`・`firefox`、既定は `chromium`）で選ぶ。`pnpm test` は Chromium で、CI の `Viewer on webkit`・`Viewer on firefox` が WebKit（Safari の engine）と Firefox で同じテストを動かす。スマートフォンは、WebKit では iPhone 13、Chromium では Pixel 7 の画面サイズ・タッチを模し、Firefox は幅 390px の画面で確かめる。実機の iOS Safari・Android Chrome とは別物である。service worker の登録が CSP で拒否されたときの文言は engine ごとに違うので、engine ごとに照合する。すべての request を Worker の `fetch` に通し、実際の header のもとで確かめる。

- module script、相対パス・root 相対パスの CSS と画像、宣言した directory index（`/next/`）が読み込め、viewer の iframe が focus を持つ。
- スマートフォン幅で横スクロールが出ず、iframe が幅いっぱいに広がり、リンクをコピーできる。
- 作者の JS が top navigation（読み込み時と、読者のクリック後の両方）・popup・form 送信・service worker 登録を試みても通らない。判定は JS の戻り値ではなく、外に出た request、開いたページの数、service worker の登録が CSP で拒否されたことで行う。iframe の `sandbox` と作者ファイルの CSP の `sandbox` はそれぞれ単独でも止めることを、片方だけを外した viewer と、iframe を使わずトップレベルで開いた deck で確かめる。どちらかの層、`worker-src 'none'`、または `allow-top-navigation-by-user-activation` などの許可を足す変更でテストが失敗することを確認済み。
- 管理 API への request には owner の cookie が付かず、拒否され、CORS の許可も返らない。Playwright が応答を差し込むときは browser の CORS 検査が働かないため、応答が読めないことではなく request と応答の header で確かめる。

管理 origin の cookie や DOM に作者の JS が触れないことは、版の origin が別の site であることによる。これはブラウザの same-origin policy の結果で、このテストの対象にしていない。外部の font・script・画像を止めないことも、テストでは確かめていない（テストは外への request を遮断する）。

iOS Safari・Android Chrome の実機と、本番の Cloudflare 経由での表示は、デプロイ後に作者が確かめる。

## 表示中のページ

共有 URL の `/@handle/slug/6` は 6 ページ目から開く。viewer がスライドの URL に `#6` を付けて渡す。逆向きに、読者がスライドの中でめくったページを viewer が知るには、スライドの側から伝える必要がある。スライドは別 origin の枠の中で動き、viewer からは中が見えないためである。計画は [スライドが「いま何ページ目か」を slide に伝えられるようにする #138](https://github.com/piconic-ai/slide/issues/138)。

- 配信 origin は `GET /_preview/pages.js` で、ページを伝える script を返す(`src/pages/script.ts`)。スライドの HTML が `<script src="/_preview/pages.js"></script>` を読み込むと動く。この 1 行は、アップロードのときに uploader(`scripts/upload.mjs`、公式 Action)が HTML ファイルへ足す(`scripts/page-script.mjs`)。足す場所は `</head>` の直前で、スライド自身の script がアドレスを変える前に動かすためである。head がなければ `</body>` の直前、それもなければ末尾に足す。作者の directory のファイルは変えず、送る byte だけを変える。すでに読み込んでいるファイル、UTF-8 でないファイル、別の charset を宣言しているファイルは、そのまま送る。Action の入力 `page-script: false`(`SLIDE_PAGE_SCRIPT=false`)で、足さずに送れる。作者が自分で書いてもよい。`_preview/` は作者のファイルに使わせない path である。script は誰にでも同じ内容を返し、`public, max-age=300` を付ける。サービスの側(Worker)は、受け取った byte を変えずに配る。
- script は fragment の番号(`#6`)をページ番号として読み、変わるたびに `postMessage` で viewer に `{ type: 'slide:page', page }` を送る。fragment がなければ 1 ページ目とする。見出しの名前や別のツールの綴りなど、ページ番号として読めない fragment のときは何も送らない(1 ページ目と決めつけると、読者のアドレスが見ていたページから外れるため)。Marp と peitho の綴りである。ツールは History API でも fragment を変え、そのときは event が出ないので、`pushState` と `replaceState` を包んで拾う。送る相手は管理 origin だけで、スライド自身の最上位の文書だけが送る。
- viewer(`public/share.js`)は、本体の枠の、その版の origin からの知らせだけを受け取る。下に小さく並べたほかのスライドの枠からの知らせと、1 から 9999 の整数でない番号は無視する。受け取ると、アドレスバーとコピー用の URL を `/@handle/slug/6` に合わせる(1 ページ目は番号なし)。読者が共有する URL が、見ていたページを開く。
- ページ番号はスライドの自己申告で、表示の補助にだけ使う。安全の判定には使わない。
- script のないスライドは、いまと同じに動く。Marp(`@marp-team/marp-cli` 4.5.1)で作ったスライドでは、矢印キーでめくるたびに番号が届くことを手元で確かめた。総ページ数と、Reveal.js のように fragment の形が違うツールには、まだ対応していない。

## 外部との通信の実測

[知らない人のスライドも、安心して開ける](../features/f17-safe-viewing.md)の方針で、スライドから外部への通信は止めずに、通信先を読者に見せる。

- 作者のファイルには `Content-Security-Policy-Report-Only: default-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob:; report-uri https://d-<id>.<配信ドメイン>/_preview/reports` を付ける(`src/preview/content.ts`)。報告先は絶対 URL にする。スライドが blob や data の URL から作った文書は policy を引き継ぐが、相対 path を解決する基準を持たないためである。内容が変わっていないときの `304` にも 2 つの CSP を付け、ブラウザが以前から持っている写しにも policy が効くようにする。Report-Only なので何も止めず、スライドが自分の origin 以外へ向けた request(画像、script、font、media、`fetch`、WebSocket、iframe)をブラウザが報告する。
- 報告は配信 origin の `POST /_preview/reports` で受ける。`_preview/` は作者のファイルに使わせない path である。報告の `blocked-uri` から host を取り出し(`src/safety/reported-host.ts`)、版ごとに `deployment_hosts`(migration `0019_deployment_hosts.sql`)へ保存する(`src/safety/store.ts`)。保存するのは host だけで、URL の path や query、報告した読者の情報は持たない。
- 報告は認証できないので、誰でも偽の host を送れる。そのため host の形式を検証し、その版を読める相手(公開中なら誰でも、下書きなら作者の session)からの報告だけを保存する。本文は `Content-Length` が 8192 以下と宣言されたものだけを読む。応答は結果によらず `204` にする。配信 origin の rate limit もかかる。
- 表示するのは版ごとに先に報告された 20 件までで、保存は 21 件までにする。作者が無害な host で一覧を先に埋めて、あとの通信先を隠そうとしても、viewer は「このほかにも通信先が報告されています」と出す。
- viewer は、そのスライドならではの情報として、報告された host の一覧だけを `<details>` で出す(`src/safety/pages.ts` の `safetySection`)。どのスライドにも共通すること(ブラウザが止めている操作、外部と通信できること、一覧の読み方、ログイン画面への注意)はヘルプページ `/help` に置き(`src/site/help-page.ts`、`safetyHelp`)、viewer からは `/help#safety` へ link する。viewer には「報告にもとづく一覧で、すべての通信先とは限らない」の 1 文だけを残す。host は国際化ドメイン名も ASCII の綴り(punycode)のまま出し、見た目の似た名前で別の host を装えないようにする。
- 報告はスライドが動いている間に届くので、viewer は読者が一覧を開くたびに `GET /api/public/deployments/:id/hosts`(`src/safety/routes.ts`)で読み直す(`public/share.js`)。スライドは読み込み直さない。この API は公開中の版にだけ答え、下書き・停止中・存在しない版には同じ `404` を返す。文言はすべて HTML 側に持ち、script は一覧を埋めて該当する行の表示を切り替えるだけにする。そのため viewer の CSP に `connect-src 'self'` を足している。
- 版を消すときに、その版の host も消す(`src/decks/deletion.ts`)。

限界は次のとおりで、一覧は「通信しないこと」の証明にはならない。

- 読者のブラウザが実際に通った処理の通信しか報告されない。
- 第三者は偽の host を足せる。作者は 20 件を先に埋められる(その場合は「このほかにも」の表示が出る)。
- CSP の対象外の通信は報告されない。スライドが自分の枠を外部サイトへ切り替える操作(`location = …` や meta refresh)、WebRTC、`dns-prefetch`・`preconnect` がこれにあたる。
- 報告は読者の IP ごとの rate limit の枠を使う。スライドが自分の origin へ大量に request を送って枠を使い切ると、その読者からの報告は届かない。
- report-uri を解釈しないブラウザからは報告が来ない。

Playwright の Firefox は、報告の request を `route()` に渡さず実在しない host へ送る。`src/share/viewer.browser.test.ts` は、Firefox のときだけ、ブラウザが作った報告を Worker に渡している。

## 表紙の画像

スライドの表紙は 1 枚の画像で、トップページの一覧と、共有 URL を貼られたサービスのプレビュー（`og:image`）が使う。

- 版が `<meta property="og:image">` で自分の画像ファイルを指すとき（[受領時に読む](f01-local-slice.md)）は、版の origin のその URL が表紙になる。
- 指さないときは、サービスが 1 枚目を撮る。`GET /covers/<deployment ID>.jpg`（管理 origin）が、[Browser Rendering](https://developers.cloudflare.com/browser-rendering/) の binding `BROWSER` の `quickAction('screenshot')` で、版の origin を 1280×720 の画面で開いて JPEG にする（`src/covers/shot.ts`）。

`/covers/…` は毎回 D1 を読み、その deployment がいま共有 URL で見える版であるときだけ画像を返す。停止・置き換え後の版の表紙は 404 になる。撮影は、作者ファイルと同じく認可のあとで呼ぶ内部の cache 対象 entrypoint（`CoverShots`、`worker.ts`）が行う。deployment の中身は変わらないので、cache の key は revision と deployment ID だけで、撮れた画像は長期に cache する。撮影の失敗（Browser Rendering の上限超過、15 秒以内に読み込みが落ち着かないスライドなど）は、内部では `503` を `public, max-age=60` で返し、同じ版を 1 分は撮り直さない。読者には `no-store` の `503` と `Retry-After` を返す。撮影の間に版が停止・置き換えされたときは、撮れた画像（版の origin のエラー画面）を cache せず 404 にする。同じ版への同時の要求は、Workers Cache が 1 回の撮影にまとめる（[Workers Cache の文書](https://developers.cloudflare.com/workers/cache/)）。`HEAD` は D1 の確認だけで答え、撮影しない。失敗の `503` が実際に 1 分 cache されるかは本番で確かめていない。読者には作者ファイルと同じく `Cache-Control: no-cache` と weak の `ETag` で返し、毎回 gateway で確かめ直す。停止・置き換えの後は、取得済みの表紙も次の取得で 404 になる。変わっていなければ撮影も内部 cache の読み出しもせず `304` を返す。経路は viewer と同じ per-IP の rate limit に入る。

撮影では作者の HTML が Cloudflare の browser の中で動く。開くのは一般公開中の版の origin だけで、誰でも開ける URL と同じものである。テストは binding を代役に置き換えており、実際の browser がスライドを描くことは deploy 後に確かめる。
