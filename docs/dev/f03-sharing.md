# 共有 URL と配信の実装設計

[URL を渡して読んでもらう](../features/f03-sharing.md) を scope1 で実装するための契約。公開状態・作者限定の閲覧・版ごとの origin は [公開管理の実装設計](f02-publication.md) を使い、ここでは共有 URL と読者向けの配信を扱う。全体の方針は [URL と HTML の隔離](design.md#url-と-html-の隔離) と [キャッシュの位置](design.md#キャッシュの位置) を参照する。

## handle

共有 URL の `@handle` は `accounts` の `handle` で、所有者の GitHub login を小文字にした値を最初のログイン時に記録する。GitHub の login は大文字小文字を区別しないので、小文字の表記を一つに決める。0010 の時点でログイン中の所有者は、`owner_sessions` の login から作る。ログアウト済みなら次のログインで作る。handle にできない login や、別の利用者がすでに持つ handle は記録せず、ログインは止めない。その所有者の共有 URL は開けない。

GitHub 側で改名しても handle は変えない。渡した URL が切れないことを優先する。handle は URL で deck を指すだけで、認可には使わない。退会すると handle も消え、再びログインするとその時点の login から作り直す。改名への追随と旧名の予約（他人に渡さない）は複数の作者を受け入れる段階で扱う。

## 共有 URL

`GET /@handle/slug` は管理 origin で、信頼する viewer を返す。`slug` は作者が決めた deck の名前(`decks.slug`)で、deck の鍵(`decks.id`)とは別である。viewer は版の題名（`<title>`、なければ slug）を表示し、作者のプロフィールへリンクする。版が description（`<meta name="description">`）を持つときは、題名と作者の下に表示する。共有 URL を貼られたサービスが題名と説明を出せるよう、`og:title`・`og:url`・`og:type`・`og:site_name`・`twitter:card` と、description があるときは `description`・`og:description` を出す。表紙の画像は `og:image` に出し、`twitter:card` は `summary_large_image` にする。表紙は、版が `<meta property="og:image">` でその版自身の画像ファイルを指すときはその画像（版の origin の URL）、指さないときはサービスが撮る 1 枚目の画像（[表紙の画像](#表紙の画像)）である。

ログインの説明のページ（`/start`）と、リポジトリを連携するページ（`/slides/new`）はなくした。`GET /start` は `/` へ、`GET /slides/new` は `/slides` へ、だれが開いても 303 で送る。ログインのボタンは `/auth/github` へ直接進む。ヘッダーの右側は、ページを返す時点では空にしておく。トップページが静的なファイルで、返す時点では誰が見ているか分からないため、どのページも同じ方法にしている。ヘッダー(`src/site/header.ts`)、1 つの `<main>`、フッターからなる共通の枠は `src/site/shell.ts` の `pageShell` が組み立て、規約、ヘルプ、エラー、見つからない共有 URL のページもこれを使う。`/share.js` が `GET /api/session`（`{ signedIn: false }` か `{ signedIn: true, login, handle, avatarUrl, unread }`、`no-store`）を読み、ログインしていなければ「ログイン」（`/auth/github`）を入れる。ログイン中なら、「スライドの管理」（`/slides`）、お知らせのベル（`/notifications`。未読があれば点を付ける）、顔写真か login の頭文字のアイコンを入れる。スライドを追加する「+」は置かない。追加は、トップと「スライドの管理」のドロップで行う。アイコンは見た目 36px、押せる範囲 44px で、押すとメニューが開き、プロフィール（`/@handle`、ハンドルがあるとき）、スライドの管理（`/slides`）、設定（`/settings`）、ログアウトが並ぶ。メニューは外側のクリックと Escape で閉じ、開いているかどうかを `aria-expanded` で示す。メニューの言葉は、ページが `data-*` 属性で渡す。直前の答えはその browser の `localStorage`（`slide:session`）に置き、次のページでは答えを待たずにそれを描いてから、新しい答えで直す。毎回遅れて現れるのを避けるためで、置いた値は描画の手がかりにしか使わない。メニューの「ログアウト」は form だが、`/share.js` が送信を止めて、同じ宛先へ `fetch` で POST する。ヘルプ、規約、エラー、viewer のページは CSP の `form-action 'none'` で form の送信を許さないためで、`connect-src 'self'` の範囲で済む。ログアウトが成功してから置いた値を消し、ページを読み直す。失敗したときは置いた値を残す。script が動かない環境では、form がそのまま送られる(form の送信を許すページに限る)。退会の form を送るときも、置いた値を消す。停止中の作者に見せるページ(`account: 'none'`)は、ヘッダーにアカウント欄を出さない。停止中は `/api/session` が 403 を返すので、欄を出すと「ログイン」や古いメニューが描かれるためである。初めて開いたときに答えが読めなければ「ログイン」を出し、すでに描いたものがあれば残す。script が動かない環境には `<noscript>` で「ログイン」を出す。この request と顔写真のために、共通の枠を使うページの CSP は `script-src 'self'`、`connect-src 'self'`、`img-src https://avatars.githubusercontent.com` を許す（`SHELL_SOURCES`）。

`GET /settings` は作者の設定で、プロフィール設定（GitHub から同期したプロフィール、最後に同期した日、「GitHub から同期し直す」、ハンドルとプロフィールへのリンク。ハンドルは GitHub のユーザー名から決まり、ここでは変えられない）と、アカウント設定（ログイン中の GitHub のユーザー名、ログアウト、退会）を置く。退会とログアウトは `/slides` の一覧から設定へ移した。未ログインでは 401 でログインを促す。

`GET /@handle` は作者のプロフィールで、GitHub から同期したプロフィール（[後述](#github-から同期するプロフィール)）と、その作者の一般公開中のスライドを、公開中の版を受け取った新しい順に最大 100 件並べる。トップページ（`/`）は、説明をせず、見出しも置かない。上から、スライドを置くドロップ枠（`src/site/home-drop-frame.tsx`）、ログイン中の人の「自分のスライド」と「フォロー中の人の新着」の置き場所（`src/site/home-signed-in-frames.tsx`。中身が届くまで `hidden`）、全作者の一般公開中のスライドを新しい順に 8 件並べる「最近のスライド」を置く。最近のスライドは横に流さず、折り返す格子にする（幅 375px で 2 列、760px 以上で 4 列）。1 本も公開されていないときは、見出しごと出さない。script が動かない環境では一覧が届かないので、`<noscript>` の style で見出しと仮の表紙を隠す。`[data-drop-zone]` の上での `dragover` と `drop` は、`/share.js` が既定の動きを止める。ドロップ枠がまだファイルを受け取れなくても、落としたファイルをブラウザが開いてページを離れないようにするためである。作者の HTML はトップページで動かさない。最近のスライドは、プロフィールと同じ表紙のカード（`src/site/deck-card.ts` と同じ markup）で出す。表紙は 2 層で、題名を入れた面の上に [表紙の画像](#表紙の画像) の `<img data-cover>` を重ねる。読めなかった画像は `/share.js` が隠すので、題名の面が見え、壊れた画像の印は出ない。トップページは静的なファイルで、表示するスライドは応答の時点で決まらないため、CSP の `img-src` には `'self'` と配信ドメインの全ての版の origin（`https://*.<配信ドメイン>`）を許す。配信ドメインが未設定のときは `img-src` を出さず、表紙は題名の文字だけになる。

どちらも共有 URL と同じ公開ポインタを読むので、一覧に出るのは共有 URL が viewer を返すスライドだけで、作者のみ限定公開・下書き・停止中・削除済みのスライドは出ない。作者本人がログインして自分のプロフィールを開いたときだけ、管理画面へのリンクを出す。誰も持たない handle は、未公開の資料と同じ 404 を返す。大文字・`%40`・末尾の `/` の表記は正規の `/@handle` へ 301 で転送する。

トップページの HTML は `vite build` の最後に `vite.config.ts` のプラグインが Hono の `toSSG` で言語ごとに生成する。日本語は `public/index.html`、英語は `public/_home/en/index.html` である。スライドの一覧は BarefootJS のクライアントコンポーネント `components/RecentDecks.tsx` で、生成時には同じ大きさの仮の表紙だけを出し、表示後に `createQuery` で `GET /api/public/slides` から取得する。この API はログインなしで呼べ、`public, max-age=60` を付ける。`/` は Static Assets から直接返さず、Worker がリクエストの言語([画面の言語](i18n.md))に合うファイルを取り出して返す。ファイルごとに ETag が違うので、別の言語で見たページは 304 にならない。`/_home/` 以下を直接開いても Static Assets からは返さず、404 になる。返すときは管理画面と同じ CSP に `connect-src 'self'` を加えたものと `no-cache` を付ける。表示のたびに D1 は読まない。

| 状態 | 応答 |
| --- | --- |
| deck の `public_deployment_id` が同じ deck の `ready` な deployment | 200 の viewer。その deployment の origin の `/` を iframe で開く |
| 下書き・停止中・存在しない deck・不正な表記 | 404 の「この資料は公開されていません」。どれも区別しない |
| プロフィールの URL で、存在しない handle・運営が停止したアカウント | 404 の「このページは見つかりません」。2 つを区別しない([アカウントの停止の実装設計](f17-suspension.md)) |
| `CONTENT_ORIGIN` が未設定・不正 | 同じ 404 |
| 大文字・`%40` などのエンコード・末尾の `/` を含む表記 | 正しい表記の URL へ 301 |
| `/@` 以下のそれ以外の path（`/@handle` だけ、余分な segment など） | 同じ 404 |

解決は `src/share/store.ts` の `readSharedDeployment` が、閲覧のたびに handle・deck・deployment を一つの join で D1 から読む。削除した deck は公開 pointer を持たないので、同じ 404 になる。版を置き換えると同じ URL が新しい deployment を開き、旧版の origin は F02 の認可で 404 になる。次の下書きは公開 pointer に載らないので、deployment ID を推測しても匿名では読めない。

応答は `Cache-Control: no-cache` で、停止や置き換えは次の閲覧から反映する。公開中の viewer（200）だけを検索対象にしてよく、`X-Robots-Tag` を付けない。404 やエラーは `noindex` にする。path の判定は request の生の path で行い、エンコードされた別表記を 200 で返さない。

共有 URL は接続元 IP ごとに `VIEWER_RATE_LIMITER`（毎分 600 回）で、版の origin への request は `CONTENT_RATE_LIMITER`（毎分 3000 回）で数える。勉強会では参加者が会場の同じ IP を共有するので、管理画面より大きい上限にしている。

## GitHub から同期するプロフィール

作者のプロフィールは slide では編集せず、GitHub の公開プロフィールから写す。同期するのは、名前（`name`）、ユーザー名（`login`）、プロフィール画像（`avatar_url`）、場所（`location`）、Web サイト（`blog`）、GitHub Sponsors のページがあるかどうかの 6 つで、D1 の `profiles`（主キーは GitHub の user ID）に置く。自己紹介や所属、メールアドレスは保存しない。

同期はログインのたびに行う。user token は callback の終わりに失効させるので、取得はその中で済ませる（`src/auth/routes.ts`）。名前などは Better Auth が読む `GET /user` の答えから取り、Sponsors の有無だけは REST にないため GraphQL（`viewer { hasSponsorsListing }`）を 1 回呼ぶ。保存するのは、ログインが session の発行まで進んだときだけである。Sponsors の答えが得られなかったとき（失敗、権限不足、3 秒以内に答えがないとき）もログインは通し、前回の値を残す。初回は「なし」とする。プロフィールの保存に失敗したときもログインは通し、次のログインで同期し直す。保存は、その作者の GitHub アカウントが認証の表に残っていることを同じ SQL 文の中で確かめる。ログインの終わりと退会が重なっても、退会した作者のプロフィールを作り直さないためである。設定ページの「GitHub から同期し直す」は `/auth/github?to=settings` へのリンクで、ログインをやり直して `/settings` に戻る。戻り先に指定できるのは `settings` だけで、それ以外は `/slides` になる。

初めてハンドルが記録されたログインでは、プロフィールの保存処理の後、同じ user token と今回の login で `GET /users/{参加者の login}/followers?per_page=100&page=N` を呼ぶ。フォロワーの GitHub ユーザー ID と配信先の照合、ページ数と時間の上限は[参加のお知らせの実装設計](f20-notifications.md#github-でフォローしている人が参加したとき)に従う。

GitHub の答えは境界で検証する（`src/profile/github-profile.ts`）。画像は `https://avatars.githubusercontent.com` のものだけ、Web サイトは `http`・`https` の URL だけを受け付け、scheme のない `example.com` は `https` として読む。名前と場所は 255 文字まで、URL は書き出した形で 2048 文字までとし、制御文字は空白として読む。空の項目と、合わない項目は「なし」として扱い、ログインは拒否しない。D1 から読むときも、画像とリンクの URL は同じ検証を通す。

プロフィールには、画像、名前（なければ `@handle`）、場所、Web サイト、GitHub のページ、Sponsors のページ（`https://github.com/sponsors/<login>`、あるときだけ）を出す。ユーザー名は表示とリンクに使うだけで、共有 URL の handle は最初のログイン時のまま変えない。画像は GitHub から直接読むので、管理 origin のページの CSP に `img-src https://avatars.githubusercontent.com` を入れている。ヘッダーのアイコンも、同期した画像があればそれを出す（`GET /api/session` が `avatarUrl` を 64px の大きさで返す）。画像が読めないときと、まだ同期していないときは、login の頭文字を出す。ページは `Referrer-Policy: no-referrer` なので、GitHub に読者の見ているページは伝わらないが、読者の IP アドレスは GitHub に届く。トップページの `img-src` は、これに表紙の画像の origin を加えたものである。

本番の GitHub App の user token で Sponsors の有無が取れるかは、まだ確かめていない。取れないときは、Sponsors のリンクが出ないだけで、ほかの項目は同期される。

## viewer

viewer は `src/share/pages.ts` のサービス自身の markup と `/share.js` だけを実行する。

- iframe は `sandbox="allow-scripts allow-same-origin"`、`referrerpolicy="no-referrer"`、`allow="fullscreen"`。top navigation・popup・download・form を許さない。作者の JS はその deployment の origin で動き、管理 origin の cookie や DOM には届かない。
- CSP は `default-src 'none'; frame-src <deployment の origin> 'self' <引用で埋め込むスライドの origin> <投稿の埋め込みの origin>; script-src 'self'; connect-src 'self'; style-src 'unsafe-inline'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`。viewer のスクリプトは、作者名のそばでフォロー・解除するときに同じ origin に POST する。viewer 自体は他のサイトに埋め込ませない。
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

作者のファイルの CSP は `sandbox`・`worker-src`・`frame-ancestors` だけを制限し、外部の font・script・画像の読み込みと `fetch` は止めない。理由と、読者への説明は [外部との通信](#外部との通信) に書く。サービスは外部 URL を proxy せず、外部依存の可用性は作者の責任とする。発表で確実に使う資料は、依存を deployment に含めることを勧める。

自動の確認は `src/share/viewer.browser.test.ts` で行う。engine は環境変数 `BROWSER`（`chromium`・`webkit`・`firefox`、既定は `chromium`）で選ぶ。`pnpm test` は Chromium で、CI の `Viewer on webkit`・`Viewer on firefox` が WebKit（Safari の engine）と Firefox で同じテストを動かす。スマートフォンは、WebKit では iPhone 13、Chromium では Pixel 7 の画面サイズ・タッチを模し、Firefox は幅 390px の画面で確かめる。実機の iOS Safari・Android Chrome とは別物である。service worker の登録が CSP で拒否されたときの文言は engine ごとに違うので、engine ごとに照合する。すべての request を Worker の `fetch` に通し、実際の header のもとで確かめる。

- module script、相対パス・root 相対パスの CSS と画像、宣言した directory index（`/next/`）が読み込め、viewer の iframe が focus を持つ。
- スマートフォン幅で横スクロールが出ず、iframe が幅いっぱいに広がり、リンクをコピーできる。
- 作者の JS が top navigation（読み込み時と、読者のクリック後の両方）・popup・form 送信・service worker 登録を試みても通らない。判定は JS の戻り値ではなく、外に出た request、開いたページの数、service worker の登録が CSP で拒否されたことで行う。iframe の `sandbox` と作者ファイルの CSP の `sandbox` はそれぞれ単独でも止めることを、片方だけを外した viewer と、iframe を使わずトップレベルで開いた deck で確かめる。どちらかの層、`worker-src 'none'`、または `allow-top-navigation-by-user-activation` などの許可を足す変更でテストが失敗することを確認済み。
- 管理 API への request には owner の cookie が付かず、拒否され、CORS の許可も返らない。Playwright が応答を差し込むときは browser の CORS 検査が働かないため、応答が読めないことではなく request と応答の header で確かめる。

管理 origin の cookie や DOM に作者の JS が触れないことは、版の origin が別の site であることによる。これはブラウザの same-origin policy の結果で、このテストの対象にしていない。外部の font・script・画像を止めないことも、テストでは確かめていない（テストは外への request を遮断する）。

iOS Safari・Android Chrome の実機と、本番の Cloudflare 経由での表示は、デプロイ後に作者が確かめる。

## 表示中のページ

共有 URL の `/@handle/slug/6` は 6 ページ目から開く。viewer がスライドの URL に `#6` を付けて渡す。逆向きに、読者がスライドの中でめくったページを viewer が知るには、スライドの側から伝える必要がある。スライドは別 origin の枠の中で動き、viewer からは中が見えないためである。計画は [スライドが「いま何ページ目か」を slide に伝えられるようにする #138](https://github.com/piconic-ai/slide/issues/138)。

- 配信 origin は `GET /_preview/pages.js` で、ページを伝える script を返す(`src/pages/script.ts`)。スライドの HTML が `<script src="/_preview/pages.js"></script>` を読み込むと動く。この 1 行は、アップロードのときに uploader(`scripts/upload.mjs`、公式 Action)が HTML ファイルへ足す(`scripts/page-script.mjs`)。足す場所は `</head>` の直前で、スライド自身の script がアドレスを変える前に動かすためである。`</head>` を省いた文書では `</body>` の直前、それも省いていれば末尾に足す。script の文字列やコメント、`<template>`、`<textarea>` などの中に書かれた `</head>` は数えない。作者の directory のファイルは変えず、送る byte だけを変える。すでに読み込んでいるファイル、文書でない HTML の断片(スライドが読み込んでページに差し込むもの)、byte が UTF-8 でないファイルは、そのまま送る。ファイルが宣言している charset は読まない。足す tag は ASCII で、足す場所はファイルの中の ASCII の `<` であり、Shift_JIS や EUC など ASCII と互換の文字コードはこの byte を文字の途中に使わないので、前後の byte の意味は変わらない。そうでない文字コード(UTF-16、ISO-2022-JP)は NUL と ESC の byte で見分けて、そのまま送る。足したファイルの数は uploader が stderr に出す。Action の入力 `page-script: false`(`SLIDE_PAGE_SCRIPT=false`)で、足さずに送れる。作者が自分で書いてもよい。`_preview/` は作者のファイルに使わせない path である。script は誰にでも同じ内容を返し、`public, max-age=300` を付ける。サービスの側(Worker)は、受け取った byte を変えずに配る。
- script は fragment の番号(`#6`)をページ番号として読み、変わるたびに `postMessage` で viewer に `{ type: 'slide:page', page }` を送る。fragment がなければ 1 ページ目とする。見出しの名前や別のツールの綴りなど、ページ番号として読めない fragment のときは何も送らない(1 ページ目と決めつけると、読者のアドレスが見ていたページから外れるため)。Marp と peitho の綴りである。ツールは History API でも fragment を変え、そのときは event が出ないので、`pushState` と `replaceState` を包んで拾う。送る相手は管理 origin だけで、スライド自身の最上位の文書だけが送る。viewer の script が後から読み込まれると、それより前の知らせは届かないので、viewer は受け取る準備ができたときに `{ type: 'slide:page-request' }` で尋ね、script は表示中のページをもう一度送る。
- viewer(`public/share.js`)は、本体の枠の、その版の origin からの知らせだけを受け取る。下に小さく並べたほかのスライドの枠からの知らせと、1 から 9999 の整数でない番号は無視する。受け取ると、アドレスバーとコピー用の URL を `/@handle/slug/6` に合わせる(1 ページ目は番号なし)。読者が共有する URL が、見ていたページを開く。
- ページ番号はスライドの自己申告で、表示の補助にだけ使う。安全の判定には使わない。
- script のないスライドは、いまと同じに動く。Marp(`@marp-team/marp-cli` 4.5.1)で作ったスライドでは、矢印キーでめくるたびに番号が届くことを手元で確かめた。総ページ数と、Reveal.js のように fragment の形が違うツールには、まだ対応していない。

## 外部との通信

[知らない人のスライドも、安心して開ける](../features/f17-safe-viewing.md)の方針で、スライドから外部への通信は止めない。Web フォントや CDN の library を使うふつうのスライドが動かなくなるためである。止めているのは、枠の外へ出る操作(ページ全体の移動、別タブ、ダウンロード、form の送信、service worker)と、管理 origin の資格情報への到達である。

通信先を実測して読者に見せる仕組みは、作らない。一度は、Report-Only の CSP で読者のブラウザから通信先の報告を受け、viewer に一覧を出した(#133)。種類・URL・ページつきの表にする案(#139)も実装まで進めたが、どちらもやめた。理由は次のとおり。

- 表を見た読者に、何をしてほしいのかを説明できない。画面の裏で起きる通信を、読者が表から見抜くことは期待できない。
- 想定する脅威を特定できない。
- 見張れるのは、読者より多くを把握できる運営である。

外部と通信できること、通信先に IP アドレスと開いたことが伝わること、枠の中で入力した内容も送れることは、ヘルプページ `/help` に書く(`src/safety/pages.ts` の `safetyHelp`、`src/site/help-page.ts`)。問題のあるスライドには、[通報 #134](https://github.com/piconic-ai/slide/issues/134) と [運営による非表示 #135](https://github.com/piconic-ai/slide/issues/135) で対応する。

## 表紙の画像

スライドの表紙は 1 枚の画像で、トップページの一覧と、共有 URL を貼られたサービスのプレビュー（`og:image`）が使う。

- 版が `<meta property="og:image">` で自分の画像ファイルを指すとき（[受領時に読む](f01-local-slice.md)）は、版の origin のその URL が表紙になる。
- 指さないときは、サービスが 1 枚目を撮る。`GET /covers/<deployment ID>.jpg`（管理 origin）が、[Browser Rendering](https://developers.cloudflare.com/browser-rendering/) の binding `BROWSER` の `quickAction('screenshot')` で、版の origin を 1280×720 の画面で開いて JPEG にする（`src/covers/shot.ts`）。

`/covers/…` は毎回 D1 を読み、その deployment がいま共有 URL で見える版であるときだけ画像を返す。停止・置き換え後の版の表紙は 404 になる。撮影は、作者ファイルと同じく認可のあとで呼ぶ内部の cache 対象 entrypoint（`CoverShots`、`worker.ts`）が行う。deployment の中身は変わらないので、cache の key は revision と deployment ID だけで、撮れた画像は長期に cache する。撮影の失敗（Browser Rendering の上限超過、15 秒以内に読み込みが落ち着かないスライドなど）は、内部では `503` を `public, max-age=60` で返し、同じ版を 1 分は撮り直さない。読者には `no-store` の `503` と `Retry-After` を返す。撮影の間に版が停止・置き換えされたときは、撮れた画像（版の origin のエラー画面）を cache せず 404 にする。同じ版への同時の要求は、Workers Cache が 1 回の撮影にまとめる（[Workers Cache の文書](https://developers.cloudflare.com/workers/cache/)）。`HEAD` は D1 の確認だけで答え、撮影しない。失敗の `503` が実際に 1 分 cache されるかは本番で確かめていない。読者には作者ファイルと同じく `Cache-Control: no-cache` と weak の `ETag` で返し、毎回 gateway で確かめ直す。停止・置き換えの後は、取得済みの表紙も次の取得で 404 になる。変わっていなければ撮影も内部 cache の読み出しもせず `304` を返す。経路は viewer と同じ per-IP の rate limit に入る。

撮影では作者の HTML が Cloudflare の browser の中で動く。開くのは一般公開中の版の origin だけで、誰でも開ける URL と同じものである。テストは binding を代役に置き換えており、実際の browser がスライドを描くことは deploy 後に確かめる。
