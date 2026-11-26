# 共有 URL と配信の実装設計

[URL を渡して読んでもらう](../features/f03-sharing.md) を scope1 で実装するための契約。公開状態・作者限定の閲覧・版ごとの origin は [公開管理の実装設計](f02-publication.md) を使い、ここでは共有 URL と読者向けの配信を扱う。全体の方針は [URL と HTML の隔離](design.md#url-と-html-の隔離) と [キャッシュの位置](design.md#キャッシュの位置) を参照する。

## handle

共有 URL の `@handle` は `accounts` の `handle` で、初めてログインした人が `/welcome` で自分で決めた値を記録する([メールのコードでログインする実装設計](f28-email-login.md#ハンドルの決まりと予約語d-26)。使える文字と予約語もそこにある)。ほかの利用者がすでに持つ handle と予約語は選べず、理由が出る。
handle は変えない。渡した URL が切れないことを優先する。handle は URL で deck を指すだけで、認可には使わない。退会すると handle も消え、再びログインすると `/welcome` で決め直す。改名への追随と旧名の予約（他人に渡さない）は複数の作者を受け入れる段階で扱う。

## 共有 URL

`GET /@handle/slug` は管理 origin で、信頼する viewer を返す。`slug` は作者が決めた deck の名前(`decks.slug`)で、deck の鍵(`decks.id`)とは別である。viewer は版の題名（`<title>`、なければ slug）を表示し、作者のプロフィールへリンクする。版が description（`<meta name="description">`）を持つときは、題名と作者の下に表示する。共有 URL を貼られたサービスが題名と説明を出せるよう、`og:title`・`og:url`・`og:type`・`og:site_name`・`twitter:card` と、description があるときは `description`・`og:description` を出す。表紙の画像は `og:image` に出し、`twitter:card` は `summary_large_image` にする。表紙は、版が `<meta property="og:image">` でその版自身の画像ファイルを指すときはその画像（版の origin の URL）、指さないときはサービスが撮る 1 枚目の画像（[表紙の画像](#表紙の画像)）である。ページ番号つきの共有 URL(`/@handle/slug/6`)では、対象の版に限り、表紙の代わりにそのページを撮った画像を `og:image` に出す([ページの画像](#ページの画像))。

ログインの説明のページ（`/start`）と、リポジトリを連携するページ（`/slides/new`）はなくした。`GET /start` は `/` へ、`GET /slides/new` は `/slides` へ、だれが開いても 303 で送る。ログインのボタンは `/login` へ進む(戻り先を付けられる画面では `?to=` を付ける)。ヘッダーの右側は、ページを返す時点では空にしておく。トップページが静的なファイルで、返す時点では誰が見ているか分からないため、どのページも同じ方法にしている。ヘッダー(`src/site/header.ts`)、1 つの `<main>`、フッターからなる共通の枠は `src/site/shell.ts` の `pageShell` が組み立て、規約、ヘルプ、エラー、見つからない共有 URL のページもこれを使う。`/share.js` が `GET /api/session`（`{ signedIn: false }` か `{ signedIn: true, login, handle, avatarUrl, unread }`、`no-store`）を読み、ログインしていなければ「ログイン」（`/login`）を入れる。ログイン中なら、お知らせのベル（`/notifications`。未読があれば点を付ける）と、プロフィール画像か login の頭文字のアイコンを入れる。ヘッダーはサービス名、ベル、アカウントのメニューの 3 つで、「スライドの管理」はメニューの中にだけ置く(F03-AC25)。スライドを追加する「+」は置かない。追加は、トップと「スライドの管理」のドロップで行う。アイコンは見た目 36px、押せる範囲 44px で、押すとメニューが開き、プロフィール（`/@handle`、ハンドルがあるとき）、スライドの管理（`/slides`）、コミュニティを作る（`/communities/new`。F30-AC44）、設定（`/settings`）、ログアウトが並ぶ。メニューは外側のクリックと Escape で閉じ、開いているかどうかを `aria-expanded` で示す。メニューの言葉は、ページが `data-*` 属性で渡す。直前の答えはその browser の `localStorage`（`slide:session`）に置き、次のページでは答えを待たずにそれを描いてから、新しい答えで直す。毎回遅れて現れるのを避けるためで、置いた値は描画の手がかりにしか使わない。メニューの「ログアウト」は form だが、`/share.js` が送信を止めて、同じ宛先へ `fetch` で POST する。ヘルプ、規約、エラー、viewer のページは CSP の `form-action 'none'` で form の送信を許さないためで、`connect-src 'self'` の範囲で済む。ログアウトが成功してから置いた値を消し、ページを読み直す。アイコンは前回の答えからすぐ描くので、そのページの `/api/session` が答える前にログアウトを押せる。ログアウトを送っている間と、成功した後に届いた `/api/session` の答えは、描画にも保存にも使わない(ログイン中だった時点の答えが、消した値を書き戻さないようにするため)。別のタブで遅れて届いた答えが新しい値を上書きすることは、防いでいない。失敗したときは置いた値を残す。script が動かない環境では、form がそのまま送られる(form の送信を許すページに限る)。退会の form を送るときも、置いた値を消す。停止中の作者に見せるページ(`account: 'none'`)は、ヘッダーにアカウント欄を出さない。停止中は `/api/session` が 403 を返すので、欄を出すと「ログイン」や古いメニューが描かれるためである。初めて開いたときに答えが読めなければ「ログイン」を出し、すでに描いたものがあれば残す。script が動かない環境には `<noscript>` で「ログイン」を出す。この request とプロフィール画像のために、共通の枠を使うページの CSP は `script-src 'self'`、`connect-src 'self'`、`img-src 'self'` を許す（`SHELL_SOURCES`)。

`GET /settings` は作者の設定で、プロフィール設定（表示名、自己紹介、場所、Web サイト、SNS のリンク、プロフィール画像。[プロフィールとプロフィール画像の実装設計](f28-profile.md)）と、アカウント設定（ハンドルとメールアドレス、ログアウト、退会）を置く。ハンドルは変えられない。メールアドレスは自分にだけ見える。退会とログアウトは `/slides` の一覧から設定へ移した。未ログインでは 401 でログインを促す。

`GET /@handle` は作者のプロフィールで、本人が書いたプロフィール（[後述](#プロフィール)）と、その作者の一般公開中のスライドを、公開中の版を受け取った新しい順に最大 100 件並べる。名前の下の切り替えから、その人がフォローしている人(`/@handle/following`)とフォロワー(`/@handle/followers`)の一覧へ進める（[フォローの実装設計](f21-follow.md#フォロー中とフォロワーの一覧)）。トップページ（`/`）は、説明をしない。ページの見出し（`h1`）は、ドロップ枠の題（「スライドをここにドロップ」）が兼ね、見た目は他の題と変えない。上から、スライドを置くドロップ枠（`src/site/home-drop-frame.tsx`）、ログイン中の人の「フォロー中の人の新着」（`src/site/home-signed-in-frames.tsx`。表示の後に `GET /api/home` で取りに行き、届く前も、0 件のときも、失敗したときも、4 件ぶんの高さを保つ。[フォローの実装設計](f21-follow.md#ログイン中のトップ)）、全作者の一般公開中のスライドを新しい順に 8 件並べる「最近のスライド」を置く。最近のスライドは横に流さず、折り返す格子にする（幅 375px で 2 列、760px 以上で 4 列）。1 本も公開されていないとき、読み込めなかったときも、8 件ぶんの高さを保ち、その上に文(失敗のときは取り直すボタンつき)を出す。script が動かない環境では一覧が届かないので、`<noscript>` の style で見出しと仮の表紙を隠す。`[data-drop-zone]` の上での `dragover` と `drop` は、`/share.js` が既定の動きを止める。ドロップ枠がまだファイルを受け取れなくても、落としたファイルをブラウザが開いてページを離れないようにするためである。作者の HTML はトップページで動かさない。最近のスライドは、プロフィールと同じ表紙のカード（`src/site/deck-card.ts` と同じ markup）で出す。表紙は 2 層で、題名を入れた面の上に [表紙の画像](#表紙の画像) の `<img data-cover>` を重ねる。画像が届くまでと、撮れなかったときだけ、題名の面が見える。枠は `aspect-ratio: 16 / 9` で大きさが決まるので、画像が届いても、カードの大きさは変わらない。読めなかった画像は `/share.js` が隠すので、題名の面が見え、壊れた画像の印は出ない。トップページは静的なファイルで、表示するスライドは応答の時点で決まらないため、CSP の `img-src` には `'self'` と配信ドメインの全ての版の origin（`https://*.<配信ドメイン>`）を許す。配信ドメインが未設定のときは `img-src` を出さず、表紙は題名の文字だけになる。

どちらも共有 URL と同じ公開ポインタを読むので、一覧に出るのは共有 URL が viewer を返すスライドだけで、作者のみ限定公開・下書き・停止中・削除済みのスライドは出ない。作者本人が自分のプロフィールを開いても、読者と同じ要素を出し、作者向けの操作は置かない(F21-AC23)。誰も持たない handle は、未公開の資料と同じ 404 を返す。大文字・`%40`・末尾の `/` の表記は正規の `/@handle` へ 301 で転送する。

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

共有 URL は接続元 IP ごとに `VIEWER_RATE_LIMITER`（毎分 5,000,000 回）で、版の origin への request は `CONTENT_RATE_LIMITER`（毎分 6,000,000 回）で数える。勉強会やイベントでは参加者が会場の同じ IP を共有するので、読者 10,000 人が 1 分の間に開ける上限にしている(F03-AC154。数え方は [サービスの基本の備え](service-basics.md#リクエスト頻度の上限))。

## プロフィール

プロフィールは本人が書く。表示名は `/welcome` で決め、自己紹介・場所・Web サイト・SNS のリンク(3 つまで)・プロフィール画像は設定で足す。D1 の `profiles`(主キーは利用者の id)に置き、検査は書き込みと読み出しの両方で同じ関数を通す。保存の列、入力の検査、プロフィール画像の順番(アップロードした画像、Gravatar、頭文字)と配信(`/avatars/<利用者の id>`)は [プロフィールとプロフィール画像の実装設計](f28-profile.md) にある。GitHub の公開プロフィールを写す仕組みは、第二スコープで取り除いた。

プロフィールには、プロフィール画像、名前（なければ `@handle`）、場所、Web サイト、SNS のリンクを出す。プロフィール画像はサービス自身が配るので、画像のための外部の origin は CSP に要らない。画像が読めないときは、名前の頭文字を出す。ヘッダーのアイコンも同じ画像である（`GET /api/session` が `avatarUrl` を返す）。メールアドレスと、その hash は、設定のほかのどのページにも出さない(`src/site/no-email-leak.test.ts`)。


## viewer

viewer は `src/share/pages.ts` のサービス自身の markup と `/share.js` だけを実行する。ヘッダーとフッターは、ほかの画面と同じ共通の枠である。スライドの下に、題名と操作のボタン、作者と「フォロー」、説明、関連リンク、引用、記事の順に markup を置く(縦並びの見た目は、記事が引用の前)。SNS の投稿のタイムラインと、イベントとコミュニティの表示は置かない。

- iframe は `sandbox="allow-scripts allow-same-origin"`、`referrerpolicy="no-referrer"`、`allow="fullscreen"`。top navigation・popup・download・form を許さない。作者の JS はその deployment の origin で動き、管理 origin の cookie や DOM には届かない。
- CSP は `default-src 'none'; frame-src <deployment の origin> 'self'; script-src 'self'; connect-src 'self'; style-src 'unsafe-inline'; img-src 'self' https://*.<配信ドメイン>; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`。viewer のスクリプトは、ヘッダーのためにログインの状態を読み、作者名のそばでフォロー・解除するときに同じ origin に POST する。画像は、サービス自身のもの、作者と読者のプロフィール画像(サービスが配る `/avatars/…`)、引用の一覧の表紙である。表紙はスライドが自分のファイルを指すことがあり、ミュートの後は一覧が入れ替わるので、`img-src` はトップページと同じく、すべての版の origin を許す。引用のスライドは枠で動かさないので、`frame-src` は読んでいるスライドの版の origin だけである。viewer 自体は他のサイトに埋め込ませない。
- 操作のボタンは「全画面」「共有」「⋯」の 3 つとである。「共有」を開くと、共有メニューが出る([共有メニュー](#共有メニュー))。「⋯」を開くと「通報する」と「この作者をミュート」がある。メニューは `<details data-menu>` で、開いているかどうかを `aria-expanded` で示し、外側のクリックと Escape で閉じる。スライドの中を押したときは、別 origin の iframe なのでクリックが viewer に届かない。window の `blur` で、フォーカスが iframe に移っていたら閉じる。1 つを開くと、ほかは閉じる。deployment の origin を直接開く導線は置かない(出回る URL を共有 URL だけにするため)。
- レイアウト(F03-AC129 から F03-AC139)。選択式ではなく、幅で決まる。`.viewer-layout` が、スライド、題名と操作、`.viewer-side`(作者・説明・関連リンク・引用)、記事を子に持ち、CSS の `grid-template-areas` で置き場所を決める。markup の順は 1 つである。幅 760px 以下は 1 列で、`.viewer-side` を `display: contents` にして中身を 1 つずつ置く。幅 761px 以上(ワイド)は、`main` を `:has()` で最大 1600px の中央にそろえ、スライドだけを左右の余白の外へ広げる。`data-side`(サーバーが `hasSideColumn` で決める)が `true` なら `.viewer-side` を右の列に置き、`position: sticky; top: 16px` で残す(高さが画面を超えるときは、その中でスクロールする)。`false` なら列を作らず、題名と操作、作者、記事を 44em の幅の 1 列で中央に置く。script は使わない(`/share.js` にレイアウトの処理はない)。
- 作者だけが開ける版(公開する前、停止中、まだ公開していない新しい版)の viewer は、枠に `src` を付けず、`name` と `data-origin` を付ける。同じページの `form[data-launch]` が、60 秒一度きりの token を、版の origin の `/_preview/launch` へ枠を target に送る(`/share.js` が送る。CSP の `form-action` はその origin だけ。`rel="noreferrer"`)。応答は `private, no-store` と `noindex`。「共有」と「⋯」は出さない。仕組みは [viewer で見せる設計](f02-publication.md#viewer-で見せる設計)。
- 作者の JS から viewer へ要求を送る経路はない。viewer が受け取る `postMessage` は、サービス自身の origin が本体の iframe の中から送る「この共有 URL を開く」依頼と、スライドが表示中のページを伝える message だけで、共有 URL の path でなければ無視する。

作者のスライドの編集（`/slides/:deck`）は、配信が設定されていてハンドルがあれば、公開する前から共有 URL とコピー操作を表示する。公開する前は「公開すると、この URL で読めます。」と添え、公開中は添え書きを置かない。公開した後は、URL の名前を入力欄でなく文字として出す。埋め込みコードの枠は置かない。コードは viewer の「共有」からだけ取る([埋め込みコード](f25-embed.md#埋め込みコード))。

### 共有メニュー

共有メニューの markup は `shareMenu`(`src/share/viewer-actions.ts`)、動きは `/share.js` にある。項目は上から次のとおり。

| 項目 | 動き |
| --- | --- |
| URL をコピー | スライド全体の共有 URL(ページ番号なし)を clipboard に書く。URL は読み取り専用の欄(`#share-url`)に見えている |
| いま見ているページの URL をコピー | 表示中のページの URL(`#share-page-url`)を書く。スライドがページを伝えるまで `hidden` で、ページを伝える script のないスライドでは出ないままになる |
| X に投稿、Bluesky に投稿 | それぞれの投稿画面を新しいタブで開くリンク(`target="_blank"`、`rel="noopener noreferrer"`)。X には題名(`text`)と URL(`url`)を、Bluesky には「題名 URL」を 1 つの `text` で渡す。URL は、ページが分かるまでスライド全体の共有 URL で、分かったら表示中のページの URL に変わる |
| 埋め込みコードをコピー | [埋め込みコード](f25-embed.md#埋め込みコード)(`#embed-code`。ページ番号なし)を書く。一般公開中のスライドにだけ出す。viewer は一般公開中のスライドにしか出ないので、viewer では常に出る |
| ほかのアプリで共有 | `navigator.share` に題名と表示中のページの URL を渡す。`navigator.share` がないブラウザでは `hidden` のままにする |

- 投稿のリンクは、ふつうのリンクである。viewer の CSP はリンクの移動先を制限しないので、CSP を広げていない。投稿先のサービスへ request が出るのは、読者がリンクを押したときだけである。viewer のページは `Referrer-Policy: no-referrer` なので、投稿先に viewer の URL は Referer としては伝わらない(渡すのは、リンクに入れた題名と URL だけ)。
- リンクの宛先は、サーバーが題名までを組み立てて `data-share-post` に置き(`src/share/share-links.ts`)、`/share.js` がその後ろに `encodeURIComponent` した URL を付ける。空白は `%20` で綴る(`+` を空白として読まない受け手があるため)。
- コピーできたことは、押したボタンの文字を 2 秒間「コピーしました」に変えて示す。同じ文字を、メニューの中の `role="status"` の行(`#share-status`。画面には出さない)にも書き、読み上げに伝える。行は 2 秒後に空に戻すので、続けてコピーしても読み上げられる。
- clipboard が使えない、または断られたときは、その URL の欄を選択した状態にして、手でコピーできるようにする。ふだん隠している欄(表示中のページの URL、埋め込みコード)は、このときに出す。コピーできたとは示さない。
- 開閉は、ほかのメニューと同じ `<details data-menu>` の仕組みを使う。キーボードでは、Enter で開き、Tab で項目を進み、Escape で閉じてボタンにフォーカスが戻る。

### 画面の枠

viewer、スライドの編集、スライドの管理、設定、トップは、枠ごとに別の関数に分けてある。枠の中身を変える機能は、その枠のファイルだけを変える。

| 画面 | 枠 | 関数とファイル |
| --- | --- | --- |
| viewer | viewer(と埋め込み)の行き来は、ページ全体の移動にする(F03-AC72)。viewer は作者のスライドの枠を持ち、`form-action 'none'` と、1 つの deck の origin だけの `frame-src` という、ほかの画面と違う CSP の下で動く。作者だけが開ける版の viewer(token と launch の form)も同じ読み込みで動くので、router のための経路(特別な header、script からの token の発行)は作らない。`/share.js` の登録は、viewer を全体で読み込んだときに 1 度だけ動く |
| viewer | 作者と「フォロー」 | `viewerAuthor`(`src/share/viewer-author.ts`) |
| viewer | 操作のボタン(全画面、共有、⋯) | `viewerActions`(`src/share/viewer-actions.ts`) |
| viewer | 引用 | `viewerCitations`(`src/share/viewer-citations.ts`) |
| viewer | スタイル | `viewerStyle`(`src/share/viewer-style.ts`) |
| スライドの編集 | 全体の並び(1 列。題名と「ビューアーで見る」、公開、共有 URL、新しい版、削除の順。プレビューは置かない) | `deckPageBody`(`src/decks/deck-page.ts`) |
| スライドの編集 | 公開 | `publicationPanel`(`src/publication/panel.ts`) |
| スライドの編集 | 共有 URL と URL の名前 | `shareUrlFrame`(`src/decks/share-url-frame.ts`) |
| スライドの編集 | 新しい版 | `replaceFrame`(`src/decks/replace-frame.ts`) |
| スライドの編集 | 新しい版の下の版の行(2 行まで) | `versionsList`(`src/decks/versions-frame.ts`)。行は純粋な `versionRows`(`src/publication/version-rows.ts`)が決める |
| スライドの編集 | 削除 | `deletionFrame`(`src/decks/deletion-frame.ts`) |
| スライドの管理 | 一覧とドロップ枠 | `deckListBody`・`deckListDropFrame`(`src/decks/deck-list-page.ts`) |
| 設定 | 全体の並び、プロフィール、ミュート、お知らせ、言語、アカウント、退会 | `settingsBody`(`src/site/settings-pages.ts`) |
| 設定 | AI エージェントから置く | `settingsAgentFrame`(`src/site/settings-agent-frame.ts`) |
| プロフィール | 全体の並びと、スライドの格子 | `profileBody`(`src/share/list-pages.ts`) |
| プロフィール | 切り替え「スライド / フォロー中 / フォロワー」 | `profileTabs`(`src/profile/pages.ts`) |
| プロフィール | フォロー中とフォロワーの一覧 | `peopleListBody`(`src/follows/people-pages.ts`) |
| トップ | ドロップ枠 | `HomeDropFrame`(`src/site/home-drop-frame.tsx`) |
| トップ | フォロー中の人の新着 | `HomeFollowingFrame`(`src/site/home-signed-in-frames.tsx`)。中身は `components/HomeFollowing.tsx` |
| トップ | 最近のスライド | `RecentDecks`(`components/RecentDecks.tsx`) |

枠をまたいで使う部品は、`src/site/` に 1 つずつある。コピーの欄(読み取り専用の入力欄とコピーのボタン)は `copyRow`(`src/site/copy-row.ts`)で、共有 URL、viewer の埋め込みコード、設定の MCP の URL が使う。ドロップ枠の中身(題、ボタン、ファイルの入力欄、注記)は `dropZoneBody`(`src/site/drop-zone-body.ts`)で、スライドの管理の一覧と差し替えが使う。トップのドロップ枠は静的なページの JSX なので、同じ印(`data-drop-*`)を `HomeDropFrame` に書き、`public/drop.js` が 3 つを同じに扱う。表紙のカードは `deckCard`(`src/site/deck-card.ts`)、日付の書式は `dayFormats`(`src/share/dates.ts`)、メニューは `<details data-menu>`(`public/share.js` が 1 か所で開閉を扱う)である。

スライドの管理の一覧と、スライドの編集の題名・表紙は、作者のスライドを `listOwnDecks`(`src/decks/own-decks-store.ts`)で読む。

### 画面の移り方

画面を移るとき、ヘッダーとフッターを残して、本文だけを差し替える。[URL を渡して読んでもらう](../features/f03-sharing.md)の F03-AC49〜F03-AC64 と F03-AC67〜F03-AC69 の設計で、実装済みである(2026-11-20)。

| 決めたこと | 内容 |
| --- | --- |
| 仕組み | `@barefootjs/router` の `startRouter()` を、入口 `src/site/router-entry.ts` で 1 度だけ呼ぶ。同じ origin のリンクを横取りし、ふつうのページの HTML を取りに行き、差し替えの場所 `[bf-region]` の中身だけを入れ替える。JavaScript が動かないときは、リンクのままふつうに移る |
| 版 | `@barefootjs/*` はすべて `^0.41.3` にそろえた(`pnpm-lock.yaml` も同じ)。npm の最新は `0.41.3`(2026-11-20 に確認)。`0.40.2` からの変更は、GitHub の release で `client` `jsx` `hono` を読み、コンパイラの修正(子コンポーネントへの spread、Fragment の分岐の属性、配列の子、prop の既定値は `undefined` のときだけ使う)で、このリポジトリのコンポーネントの出力は変わらない。`router` は `0.41.0` からの変更なし。`pnpm build` とコンポーネントのテストが通ることで確かめた |
| 差し替えの場所 | 共通の枠(`src/site/shell.ts` の `pageShell`、静的なトップは `home-page.tsx`)の `<main bf-region="page">` が 1 つ。ヘッダーとフッターは外にある。`<main>` の属性は差し替えで変わらないので、ページごとの幅(`page-wide` `page-reading` `page-narrow`)と固有の class は、中身の先頭の `<div class="page …">` に付ける。`main.page-reading` などの CSS は `.page-reading` などに直した。「アップロードの状態」の画面(`/uploads/:id`)も同じ枠にした |
| ページごとの CSS | `<head>` の `<style>` は router が合わせない。共通の CSS(`pageStyle`)は `<head>` に残し、ページ固有の CSS(ヘルプ、規約、viewer)は `pageShell` の `style` で本文の側(`<main>` の中、`.page` の前)に置く。差し替えで入り、出るときに一緒に消えるので、移った後も、全体を読み込んだときと同じに当たる。`<head>` に残るのは、`<meta>` と `<link rel=alternate>`(題、`description`、`og:`、`robots` は router が合わせる)だけにする |
| ページごとの script | `/share.js`(ヘッダー、共有メニュー、コピーなど)は全ページが 1 度だけ読む。ページの要素に付ける処理は `bindX(root)` の関数にし、`window.slidePage.onMount(bind)` で登録する。全体を読み込んだときは `document` に、移った後は router が差し替えた `<main>` に 1 度ずつ呼ぶ。要素ごとに `WeakSet` で 1 度しか付けないので、二重にならない。`document` と `window` に付ける listener(メニュー、`message`)は 1 度だけ付け、動くときに探す(viewer の iframe は `message` を受け取った時点で探す)。`/drop.js` も同じ登録を使う。`/drop.js` は最初に読んだページで 1 度だけ実行されるので、後から移ったページのドロップ枠は登録で設定する |
| router の入口 | `vite.config.ts` が、コンポーネントと一緒に `router-entry.ts` を `/components/assets/router.js`(名前が変わらない)として組む。`pageShell` が `/share.js` の後に `type="module"` で読む。BarefootJS の client runtime は、移った先にコンポーネント(`bf-s`)があるときだけ、動的に読む(トップ) |
| 差し替えない移動 | `src/site/router-policy.ts` の `movesInFrame`(純粋)で決める。`data-bf-router="false"`、`download`、`target`(`_self` 以外)、`rel=external`、別の origin(作者のスライドの origin を含む)、同じページの `#hash`、`?lang=`(言語の切り替え)、`/auth/`(ログイン・ログアウト)、`/account/`(退会)、`/api/`、`/oauth/`、`/mcp`、`/oembed`、`/embed/`、`/uploads/`(これらのページからのリンクも、全体の移動)。フォームの送信と `fetch` は router が横取りしないので、いまのまま(ログアウトは `/share.js` が `fetch` して読み直す。ファイルの送信は `/drop.js` が `fetch` し、終わったら `location.assign`)。区画のない画面(埋め込み、`/uploads/:id` の中身など)へ向かうリンクは、router が取りに行った後に、ページ全体の移動に戻る(router の決まり) |
| 移った後 | 題と `description` などは router が新しいページのものにする。フォーカスは本文の最初の見出し(なければ `<main>`)に移り、題を読み上げる。フッターの言語の切り替えは、いま見ているページを指すよう、押したときに `href` を書き換える |
| viewer | 差し替えで、作者のスライドの枠が作り直される。`/share.js` の処理は、枠ごとに 1 度だけ付ける。`message` は、受け取った時点で `iframe#deck[data-share]` を探すので、viewer を何度移っても listener は 1 つ。作者限定の枠の launch(`form[data-launch]` を `form.submit()` で枠に送る)も、`bindX` として移った後に 1 度だけ動く。作者限定の viewer は `Sec-Fetch-Dest: document` の読み込みにだけ、一度きりの token を作るので、router の取りに行く request に `X-Slide-Move: 1` を付け、同じ origin(`Sec-Fetch-Site: same-origin`)のときだけ、文書の読み込みとして答える。別のサイトは custom header を送れない |
| ログイン中のトップ | 新着が届く前に、届いたときと同じ高さの仮の表示を出す(F21-AC52)。ログイン中かどうかは、Worker が `/` を返すときに、セッションの cookie の有無で本文に印を付ける(`data-member`、`src/site/home-viewer.ts`)ので、はじめて開く端末でも、ブラウザが何も覚えていなくてよい。移った後のトップも、router が取りに行った本文に同じ印が付く。CLS は、ブラウザで測る(`src/site/home-shift.browser.test.ts`、`router.browser.test.ts`) |
| CSP | **広げない**(F03-AC63)。文書の CSP は、移った後の本文にも当たる。そこで、CSP を足して違いをなくすのではなく、違うページ(viewer と埋め込み。`isWholePagePath`)との行き来を、ページ全体の移動にした(F03-AC72)。ほかのページの間も、`router-entry.ts` が、router の取りに行く request を包み、移る前のページの CSP(最初は `HEAD` で 1 度だけ読み、あとは移ったページのもの)が、移る先の CSP の `script-src`・`connect-src`・`style-src`・`img-src`・`frame-src` を許し、移る先の本文にフォームがあるときは `form-action` も許すかを `policyCovers` で調べる。許さなければ 409 を返し、router が全体の移動に戻る(F03-AC73)。たとえば、ヘルプ(`form-action 'none'`)から設定へは全体の移動で、設定からヘルプへはページの中で移る。許可の画面(`/oauth/`)などの全体のページからのリンクも、全体の移動にする。作者のファイルの CSP と iframe の `sandbox`、別の origin は変えない |
| cache と認証 | router は `Accept: text/html`、`credentials: same-origin` で取りに行き、ページが答えを変える(ログイン状態、作者向けの要素)のを壊さないよう、先読み(`prefetch`)を切り、router の cache の期限を 0 にした(毎回取りに行く)。ページの `Cache-Control`(`no-store`、トップは `no-cache`)と `Vary: Cookie` は、ふつうの読み込みと同じに効く。ヘッダーの口(`data-account`)は空で出て `/api/session` で描くので、どの訪問者にも同じ HTML である。ヘッダーは差し替えないので、移るたびに `/api/session` を取り直すこともしない。静的なトップの `GET /api/home` と `GET /api/public/slides` は、トップの island が動くたびに取りに行く |
| 確かめ方 | `src/site/router.browser.test.ts`(Playwright)で、文書とヘッダーの要素が同じであること、題・`og:`・フォーカス、戻る・進む、全体の移動になる移動、viewer の共有メニュー・コピー・URL の更新が 1 回ずつ(2 回移った後も)、CLS、移った後の計算後のスタイル、ドロップ枠を確かめる。`src/site/router-policy.pure.test.ts` と `router-policy-routes.test.ts` で、リンクの判断と CSP を確かめる。viewer の隔離(`src/share/viewer.browser.test.ts`)、`src/preview/cross-deck.browser.test.ts`、トップ、狭い幅、`account-link.browser.test.ts` の既存のテストは通る |

## 読者向けの配信と内部 cache

版の origin への匿名の request は、F02 の [配信の認可と失効](f02-publication.md#配信の認可と失効) と同じく毎回 D1 で認可する。認可を通った一般公開の file だけが、Workers Cache を有効にした名前付き entrypoint `ContentFiles`（`src/app/worker-routes.ts`）を `ctx.exports` 経由で呼び、保存済みの bytes を読む。

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

- ページを伝える script(`src/pages/script.ts` の `pageScript`)は、配信 origin が版のトップの `index.html` を配るときに、inline で差し込む(`src/pages/inject.ts`、[差し込み](#差し込み))。作者は何も書かなくてよい。R2 の object は変えず、置き直さなくても、すでにある版にも効く。
- 配信 origin は `GET /_preview/pages.js` でも同じ文字列を返す。作者が `<script src="/_preview/pages.js"></script>` を書いた HTML と、以前はアップロードのときに uploader・ブラウザのドロップ・MCP の受け口がこの 1 行を足していた版のためである(いまは足さない。足した 1 行は、作者の CSP に止められると、コンソールに違反を残していた)。差し込んだ script と外のファイルの script は、先に動いたほうが文書に印(`Symbol.for('slide.page-script')` の window のプロパティ)を付け、もう一方は何もしない。差し込む script は `<head>` の先頭近くにあり、外のファイルより先に動くので、差し込めた版では差し込んだほうが働く。差し込めなかった版では、外のファイルのほうが働く(CSP が許すとき)。script は誰にでも同じ内容を返し、`public, max-age=300` を付ける。`_preview/` は作者のファイルに使わせない path である。
- script は fragment の番号(`#6`)をページ番号として読み、変わるたびに `postMessage` で viewer に `{ type: 'slide:page', page }` を送る。fragment がなければ 1 ページ目とする。見出しの名前や別のツールの綴りなど、ページ番号として読めない fragment のときは何も送らない(1 ページ目と決めつけると、読者のアドレスが見ていたページから外れるため)。Marp と peitho の綴りである。ツールは History API でも fragment を変え、そのときは event が出ないので、`pushState` と `replaceState` を包んで拾う。送る相手は管理 origin だけで、スライド自身の最上位の文書だけが送る。viewer の script が後から読み込まれると、それより前の知らせは届かないので、viewer は受け取る準備ができたときに `{ type: 'slide:page-request' }` で尋ね、script は表示中のページをもう一度送る。
- viewer(`public/share.js`)は、本体の枠の、その版の origin からの知らせだけを受け取る。下に小さく並べたほかのスライドの枠からの知らせと、1 から 9999 の整数でない番号は無視する。受け取ると、アドレスバーと、共有メニューの「いま見ているページの URL」と投稿のリンクを `/@handle/slug/6` に合わせる(1 ページ目は番号なし)。読者が共有する URL が、見ていたページを開く。スライド全体の共有 URL(「URL をコピー」)は変えない。
- ページ番号はスライドの自己申告で、表示の補助にだけ使う。安全の判定には使わない。
- ページを伝えない(fragment がページ番号の形でない、または差し込めなかった)スライドは、これまでと同じに動く。Marp(`@marp-team/marp-cli` 4.5.1)で作ったスライドでは、矢印キーでめくるたびに番号が届くことを手元で確かめた。総ページ数と、Reveal.js のように fragment の形が違うツールには、まだ対応していない。

### 差し込み

`src/preview/content-routes.ts` が、版のトップの `index.html`(path が `index.html`、media type が `text/html`)を配るときに、`src/pages/inject.ts` の `injectIntoBytes` を通す。ほかの HTML ファイルには差し込まない。viewer が開くのはトップで、ページ番号はトップの fragment だからである。ほかのページが伝えた番号は、トップのページ番号と取り違えられる。

- 差し込む文字列は `pageScript(viewerOrigin)` だけで、viewer の origin は設定(`PUBLIC_ORIGIN`)から作る。ユーザー由来の値は入らない。
- 文書の読み取りは `src/pages/markup.ts` の `readHead` が行う。以前の `scripts/page-script.mjs` と同じく、コメント、script などの text、`<template>` の中の tag は数えず、閉じない tag は引用符の状態ごとに 1 度だけ末尾まで読む(大きさに比例する時間で終わる)。読むのは `<body>` の開始 tag までで、`<body>` の後の meta の CSP は、ブラウザが無視するので数えない。tag の名前と属性の名前は大文字小文字を区別せず、属性の順と引用符(`"`、`'`、なし)を問わない。
- 差し込む位置は、`<head>` の開始 tag の直後(なければ `<html>`、それもなければ doctype の直後)である。それより前に、meta の CSP(`http-equiv` が `Content-Security-Policy`)か作者の script があれば、そのうち最初のものの直前にする(F03-AC151)。meta の CSP は、その要素より後ろの内容にだけ効くので、前に置いた script は、作者の CSP が何を許すかに関わらず動く。作者の最初の script より前に置くのは、History API の関数を、スライド自身の script より先に包むためである。
- 作者の meta の CSP は読まず、書き換えない(F03-AC152)。差し込んだ `<script>…</script>` のほかは、置いた byte のままである。以前は、meta の CSP の後に置き、CSP に差し込む script のハッシュを足していた(2026-11-25 にやめた。#458)。作者の CSP を書き換えずに済み、CSP の読み取りと調整の分岐(文字参照や meta の数で差し込めない場合)もなくなった。
- meta の CSP は、差し込んだ script が動いた後に読まれる内容には効き続ける。差し込む script は通信せず(`fetch` などを使わない)、親への `postMessage` と History API の包みと event の受け取りだけを行うので、作者の `connect-src` などに止められない。
- script を `<meta charset>` より前に置くことがある。配信は HTML を `text/html; charset=utf-8` で配るので、文字コードの判定は header で決まり、変わらない。
- 差し込まずに、置いた byte のまま配るもの(F03-AC153): 5MB(1 ファイルの既定の上限、`MAX_INJECTED_BYTES`)を超えるファイル、UTF-8 として読めないファイル(配信は HTML を UTF-8 として配る)、NUL の byte を含むファイル(UTF-16)、ISO-2022 の escape sequence(ESC の後に `$`・`(`・`)` など。ANSI の色付けの `ESC [` は数えない)を含むファイル(ISO-2022-JP)、`<head>`・`<html>`・先頭の doctype のどれもない断片。meta の CSP の値と数は、差し込めるかどうかに関わらない。
- 差し込みは、応答のたびに行い、結果を cache しない。読み取りと書き直し(1 か所に挟んで 1 度だけつなぐ)は、ファイルの大きさに比例する時間で終わる。閉じない tag や meta の CSP で埋めた 5MB の入力で、時間をテストしている(`src/pages/inject.performance.test.ts`)。
- 作者の CSP のほかに、配信の HTTP の header の CSP(`sandbox …; worker-src 'none'; frame-ancestors …`)がある。こちらは置き場所に関わらず、差し込んだ script にも効く。script を制限しないので、変えない。
- 公開中の版の `index.html` の `ETag` は、`W/"<sha256>-p2-<ハッシュの先頭 16 文字>"` である(`injectedValidator`)。ハッシュは、差し込む script の文字列の SHA-256(`scriptHashSource`)で、環境ごとに 1 つの値になる。置いたファイル、差し込みの規則の版(`INJECTION_REVISION`)、差し込む script の 3 つで、配る byte が決まる。どれかが変われば `ETag` も変わり、変わらなければ、ファイルを読まずに `304` を返せる。差し込まなかったファイルも、同じ形の `ETag` になる。差し込みの規則を変えるときは `INJECTION_REVISION` を上げる(meta の CSP の前に置くようにしたとき、`p1` から `p2` にした。前の規則で配った byte を `304` にしないため)。
- 内部 cache(`ContentFiles`)は、置いたファイルの byte をそのまま持つ。差し込みは、内部 cache から読んだ後に、応答のたびに行う。差し込む script が変わっても、内部 cache を捨てずに済む。`304` で済む再訪問では、差し込みも行わない。
- 作者だけが開ける版も、同じく差し込む(R2 から直接読み、cache しない)。作者が自分の版の viewer でページを送ると、アドレスバーが変わる。
- 埋め込み(`/embed/@handle/slug`)の枠では、スライドの親(埋め込みのページ)が最上位の文書でないので、script は何も伝えない。表紙とページの撮影は、版の origin を最上位の文書として開くので、script は何も伝えない。撮影は、これまでどおり `/#6` で開いて撮る。

## 外部との通信

[知らない人のスライドも、安心して開ける](../features/f17-safe-viewing.md)の方針で、スライドから外部への通信は止めない。Web フォントや CDN の library を使うふつうのスライドが動かなくなるためである。止めているのは、枠の外へ出る操作(ページ全体の移動、別タブ、ダウンロード、form の送信、service worker)と、管理 origin の資格情報への到達である。

通信先を実測して読者に見せる仕組みは、作らない。一度は、Report-Only の CSP で読者のブラウザから通信先の報告を受け、viewer に一覧を出した(#133)。種類・URL・ページつきの表にする案(#139)も実装まで進めたが、どちらもやめた。理由は次のとおり。

- 表を見た読者に、何をしてほしいのかを説明できない。画面の裏で起きる通信を、読者が表から見抜くことは期待できない。
- 想定する脅威を特定できない。
- 見張れるのは、読者より多くを把握できる運営である。

外部と通信できること、通信先に IP アドレスと開いたことが伝わること、枠の中で入力した内容も送れることは、ヘルプの記事「知らない人のスライドを安全に開く」(`/help/safety/external-access`、`src/help/articles/safety/external-access.ts`。ヘルプ全体の作りは[ヘルプ](#ヘルプ)を参照)に書く。問題のあるスライドには、[通報 #134](https://github.com/piconic-ai/slide/issues/134) と [運営による非表示 #135](https://github.com/piconic-ai/slide/issues/135) で対応する。

## 表紙の画像

スライドの表紙は 1 枚の画像で、トップページの一覧と、共有 URL を貼られたサービスのプレビュー（`og:image`）が使う。

- 版が `<meta property="og:image">` で自分の画像ファイルを指すとき（[受領時に読む](f01-local-slice.md)）は、版の origin のその URL が表紙になる。
- 指さないときは、サービスが 1 枚目を撮る。`GET /covers/<deployment ID>.jpg`（管理 origin）が、[Browser Rendering](https://developers.cloudflare.com/browser-rendering/) の binding `BROWSER` を `@cloudflare/puppeteer` で動かして、版の origin を 1280×720 の画面で開いて JPEG にする（`src/covers/shot.ts`）。

`/covers/…` は毎回 D1 を読み、その deployment がいま共有 URL で見える版であるときだけ画像を返す。停止・置き換え後の版の表紙は 404 になる。撮影は、作者ファイルと同じく認可のあとで呼ぶ内部の cache 対象 entrypoint（`CoverShots`、`src/app/worker-routes.ts`）が行う。deployment の中身は変わらないので、cache の key は revision と deployment ID だけで、撮れた画像は長期に cache する。撮影の失敗（Browser Rendering の上限超過、15 秒以内に読み込みが落ち着かないスライドなど）は、内部では `503` を `public, max-age=60` で返し、同じ版を 1 分は撮り直さない。読者には `no-store` の `503` と `Retry-After` を返す。撮影の間に版が停止・置き換えされたときは、撮れた画像（版の origin のエラー画面）を cache せず 404 にする。同じ版への同時の要求は、Workers Cache が 1 回の撮影にまとめる（[Workers Cache の文書](https://developers.cloudflare.com/workers/cache/)）。`HEAD` は D1 の確認だけで答え、撮影しない。失敗の `503` が実際に 1 分 cache されるかは本番で確かめていない。読者には作者ファイルと同じく `Cache-Control: no-cache` と weak の `ETag` で返し、毎回 gateway で確かめ直す。停止・置き換えの後は、取得済みの表紙も次の取得で 404 になる。変わっていなければ撮影も内部 cache の読み出しもせず `304` を返す。経路は viewer と同じ per-IP の rate limit に入る。

撮影では作者の HTML が Cloudflare の browser の中で動く。開くのは一般公開中の版の origin だけで、誰でも開ける URL と同じものである。テストは `@cloudflare/puppeteer` を代役に置き換えており(`src/test-browser-setup.ts`)、実際の browser がスライドを描くことは、ローカルでは `verify-slide` で、本番では deploy 後に確かめる。

### 撮影の方法(Puppeteer)

撮影は、Browser Rendering の Quick Actions(`quickAction('screenshot')`)から、binding を `@cloudflare/puppeteer` で動かす形に変えた(D-140)。`puppeteer.launch(env.BROWSER)` で browser を開き、`page.setViewport`・`page.goto`・`page.screenshot` で撮って、`finally` で `browser.close()` する。撮る大きさ(1280×720)、JPEG の品質(85)、待ち方(`networkidle2`、15 秒)、ページ番号の付け方(`/#6`)、予算、cache、失敗の扱い、公開を止めた版の扱いは、これまでと同じである(D-142)。`shotOptions`(`src/covers/shot.ts`)が値を持ち、撮影はそれを Puppeteer に渡す。撮影の途中で例外が出ても、`close()` が呼ばれ、session は残らない。

- 理由: Cloudflare の文書では、Quick Actions はローカルの `wrangler dev` では動かず、`--remote` か binding の `"remote": true` が要る。Puppeteer / Playwright / CDP で binding を使う形は、`wrangler dev` がローカルに Chrome を立てて動く(`vite dev` も同じ)。開発者が本番に触れずに表紙を撮れる。
- Puppeteer と Playwright のどちらか: `@cloudflare/puppeteer` にした。これまでの待ち方 `networkidle2`(接続が 2 本以下で 500ms 続いたら落ち着いたと見なす)が、そのまま `waitUntil` に使える。Playwright の `networkidle` は 0 本が基準で、待ち方が変わる。リポジトリの `playwright`(ブラウザのテスト用の devDependency)とは別の物で、版を固定した(`2.0.1`。内部は Puppeteer 25 系)。
- `wrangler.jsonc` の `compatibility_flags` に `nodejs_compat` を足した(ライブラリが Node の API を使う)。`browser` の binding の名前(`BROWSER`)と、`remote` ではなくローカルで動く設定は変えていない。
- 料金と上限(2026-11 時点の文書による): Quick Actions は browser hours だけの課金で、Puppeteer などの Browser Sessions は browser hours と同時に開く browser の数の両方の課金になる。Workers Paid では、browser hours は月 10 時間まで含み、超えると 1 時間あたり $0.09。同時に開く browser は 10 まで含み(日ごとの最大値の月平均)、超えると 1 つあたり $2.00。上限は、Workers Paid が同時に 200 まで・新しい browser は毎秒 3 つ、Workers Free が同時に 3 まで・新しい browser は 20 秒に 1 つ。Quick Actions の上限は、Paid が毎秒 30 要求、Free が 10 秒に 1 要求である。この service の撮影は、版ごとの予算(1 分に表紙 1 回とページ 6 回まで)で絞ってあるので、同時に開く browser の数は小さいままのはずだが、本番の最大値は確かめていない。上限を超えると browser を開く `launch` が失敗し、撮影の失敗として `503` になる。
- 読んだ文書: [Playwright](https://developers.cloudflare.com/browser-rendering/playwright/)、[Puppeteer](https://developers.cloudflare.com/browser-rendering/puppeteer/)、[制限](https://developers.cloudflare.com/browser-rendering/limits/)、[料金](https://developers.cloudflare.com/browser-rendering/pricing/)。
- 時間の上限: 撮影の上限は、ページを開いてから画像になるまでの全体で 20 秒(`SHOT_DEADLINE_MS`、`src/covers/shot.ts`)である。ページが落ち着くのを待つ 15 秒(`goto` の `timeout`)に、描く数秒を足した。超えたら撮影を諦めて browser を閉じ、版の失敗(`503`、`public, max-age=60`)にする。作者の HTML が、load の後に `alert()` を出す、または止まらない loop に入ると、`screenshot` は応答せず、Puppeteer の `protocolTimeout`(約 180 秒)まで browser を占有する。それを防ぐために、ダイアログは `dialog.dismiss()` で自動で閉じ、全体に上限をかけた。`browser.close()` はそれ自体に 5 秒の上限(`CLOSE_DEADLINE_MS`)を置く。
- close の失敗: `browser.close()` が失敗しても(session がすでに切れたときなど)、撮れた画像は返し、撮影の失敗はその失敗のままにする。close の失敗は `console.warn` に記録するだけである。popup、新しいタブ、ダウンロードは、browser の close で session ごと閉じる。
- browser を開けない失敗: `launch` が失敗するのは、新しい browser の上限(Workers Paid は毎秒 3 つ)に達したときなど、版ではなく全体の混雑や service の不調である。プロフィールの 100 枚のカードが同時に表紙を求めると、4 枚目から失敗しうる。この失敗は、版の失敗として 1 分 cache せず、内部では `503`、`Cache-Control: no-store`、`Retry-After: 5` を返す(`BROWSER_BUSY_HEADERS`)。読者への応答も `no-store` の `503` で、`Retry-After` は 5 になる(撮影の失敗は 60)。撮り直しは、カードが次に表紙を求めたときに行う。
- 範囲外: 作者が表紙を選ぶ・アップロードする仕組み、撮影の予算と cache の期間の変更。

## ページの画像

[説明したいページを画像付きで共有する](../features/f05-page-ogp.md)のための設計である。ページ番号つきの共有 URL(`/@handle/slug/6`)のカードに、そのページを撮った画像を出す。

### 対象の版

公開中のすべての版のページを撮る。どの版のトップの `index.html` にも、配るときにページを伝える script を差し込むので([差し込み](#差し込み))、`#6` の形でページを持つスライドなら、作者が何もしなくてもページが伝わるためである。作者だけが開ける版は撮らない(撮影は公開中の版の origin だけを開く)。

- 以前は、アップロードの確定時に `index.html` が `/_preview/pages.js` を読み込んでいるかを読み、D1 の `page_script_deployments` に記録して、行がある版だけを撮っていた。差し込むようになって読み手がなくなったので、`0047_drop_page_script_deployments.sql` で表ごと消した。行は版の `index.html` から導いた値だけで、ほかの情報を持たない。
- 差し込めなかった版(断片、UTF-8 でないなど)や、fragment をページ番号に使わない版も撮る。番号つきの URL は、ふつう script が伝えた番号から viewer が作るので、そうした版で番号つきの URL が出回ることは少ない。手で書いた番号なら、ブラウザが `#6` で描いたものを撮る。撮影の予算(下の「配信」)は変えない。

### 撮影と cache の鍵

ページは、表紙と同じ仕組み(`CoverShots`、`src/covers/serve-routes.ts` の `takeCoverShot`)で、必要になったときに撮る。アップロードの時点では撮らない。

- 撮る対象は、表紙か、ある版の 1 ページかのどちらかで、`ShotTarget`(`src/covers/shot.ts`)で表す。撮るページは 1 から 200(`MAX_SHOT_PAGE`)まで。
- ページは、版の origin の `/#6` を、表紙と同じ画面(1280×720)と同じ待ち方で開いて撮る。viewer が本体の枠に渡す URL と同じ綴りである。`#6` 以外の綴りには対応しない。総ページ数は取らないので、スライドにないページ番号でも、ブラウザが描いたものを撮る。
- 内部 cache の鍵は、表紙が `https://cover-shots.internal/v1/<deployment ID>`、ページが `https://cover-shots.internal/p1/<deployment ID>/<ページ番号>` である。版・ページが同じなら鍵は 1 つで、違えば鍵も違う。
- 撮影の版は、表紙(`COVER_SHOT_REVISION`、いまは `v1`)とページ(`PAGE_SHOT_REVISION`、いまは `p1`)で分けた。ページの撮り方だけを変えるとき(ページを開いてからの待ち方など)は `PAGE_SHOT_REVISION` だけを上げる。表紙の鍵はページを足す前と同じなので、すでに cache にある表紙は捨てない。画面の大きさや画質のように両方に効く変更では、両方を上げる。2 つの版の文字列は重ならないので、片方の鍵がもう片方として読まれることはない。
- 撮れた画像は、表紙と同じく長期に cache し、`Cache-Tag: deployment-<deployment ID>` を付ける。失敗は `503` を `public, max-age=60` で返し、同じ版の同じページを 1 分は撮り直さない。あるページの失敗は、ほかのページと表紙の鍵には影響しない。
- 撮影の間に版が停止・置き換えされたときは、撮れた画像を cache せず 404 にする。表紙と同じである。

実際の browser が `#6` のページを描いて撮れることは、ローカルでは確かめられない。テストは binding を代役に置き換えており、どの URL を開くか、答えをどう扱うかだけを確かめている。deploy 後に確かめる。

### 配信

`GET /covers/<deployment ID>/<ページ番号>.jpg`(管理 origin、`src/covers/routes.ts`)が、ページの画像を返す。認可、cache、`HEAD`、rate limit の扱いは、表紙(`/covers/<deployment ID>.jpg`)と同じにしてある。

- 毎回 D1 を読み(表紙と同じ `isPublicDeployment` と、`src/covers/store.ts` の `readPageSource`)、その deployment がいま共有 URL で見える版であるときだけ答える。停止した版、置き換えられた版、運営が非表示にしたスライドの版は 404 になる。内部 cache を読む前に確かめるので、cache に画像が残っていても返さない。
- 1 から 200 の整数でないページ番号(`0`、`201`、`06`、`-6`、`1.5`、文字)は 404 で、撮影しない。viewer はこれらの URL を `og:image` に出さない。
- 読者には `Cache-Control: no-cache` と weak の `ETag`(`W/"page-p1-<deployment ID>-<ページ番号>"`)で返す。変わっていなければ、撮影も内部 cache の読み出しもせずに `304` を返す。`HEAD` は D1 の確認だけで答え、撮影しない。
- 経路は `/covers/` の下なので、表紙と同じ viewer の per-IP の rate limit に入る(`src/site/rate-limit-policy.ts`)。
- 同じ版・同じページへの同時の要求は、内部 cache の同じ鍵を尋ねる。1 回の撮影にまとめるのは、表紙と同じく Workers Cache である。テストは、同時の要求が同じ鍵を使うことと、鍵ごとに 1 度だけ答えを作る代役の cache の下で撮影が 1 回になることを確かめている。実際の Workers Cache がまとめることは、本番で確かめていない。

新しく撮るページの数には、版ごとの上限を置く。1 つの版につき 1 分に 6 ページまでである(`PAGE_SHOT_RATE_LIMITER`、`wrangler.jsonc` の `ratelimits`。値は `src/covers/shot.ts` の `PAGE_SHOTS_PER_MINUTE` と同じにする)。

- 理由: 撮影の失敗は鍵ごとに 1 分しか覚えない。表紙だけなら「1 つの版につき 1 分に 1 回」で済むが、ページの鍵は版ごとに 200 個あり、互いの失敗を知らない。通信が落ち着かないスライドの `1.jpg` から `200.jpg` を毎分尋ねると、1 つの IP から毎分 200 回、browser を 15 秒ずつ動かせてしまう。viewer の rate limit(1 つの IP から毎分 5,000,000 回)では止まらない。
- 数えるのは接続元ではなく版(`page-shots:<deployment ID>`)である。だれが、いくつの IP から尋ねても、1 つの版が 1 分に動かす browser は、ページ 6 回と表紙 1 回までになる。
- 数える場所は、内部 cache の後ろの entrypoint(`takeCoverShot`)である。ここは cache に答えがないときだけ動くので、撮影済みのページと、まだ覚えている失敗は数えない。読まれているページの配信は、上限にかからない。
- 上限を超えたページは撮らず、内部では `no-store` の `503` を返す。試していないので、失敗として 1 分覚えることもしない。読者には、下の「撮影に失敗したとき」と同じく表紙を返す。枠が空けば、次の要求で撮る。
- 表紙は数えない。表紙は版に 1 枚で、失敗を 1 分覚えるためである。
- binding は Cloudflare の拠点ごとに数えるので、正確な上限ではなく、乱用を抑える目安である。初めて共有されたスライドで、1 分に 7 ページ以上が同時に貼られると、超えた分のカードは、取り直されるまで表紙になる。

あるページの撮影に失敗したとき(Browser Rendering の上限超過、15 秒以内に読み込みが落ち着かないスライドなど)は、`503` ではなく、そのスライドの表紙を返す。カードに何も出ないより、表紙が出るほうがよいためである。

- 版が自分の画像を表紙に指しているときは、その画像の URL(版の origin)へ `302` で送る。画像は版のファイルで、管理 origin からは配らないためである。
- 指していないときは、サービスが撮る表紙(内部 cache の表紙の鍵)を `200` で返す。表紙も撮れないときは、表紙と同じ `503` と `Retry-After: 60` を返す。
- 代わりに返す表紙は、そのページの画像ではない。`ETag` を付けず、`Cache-Control: no-store` で返すので、ページの画像として `304` で確かめ直されることも、cache に残ることもない。次の要求で、もう一度ページを尋ねる。ページの失敗は内部で 1 分 cache されているので、その間は撮り直さずに表紙を返す。
- 撮影の間に版が停止・置き換えされたとき(内部の答えが 404)は、表紙を返さずに 404 にする。

### viewer の `og:image`

viewer(`src/share/routes.ts`)が `og:image` に出す画像は、`src/share/cover.ts` の `previewImageUrl` が決める。入力は、共有 URL のページ番号(なければ null)と、版が指す表紙である。

| 共有 URL | `og:image` |
| --- | --- |
| 番号なし(`/@handle/slug`) | 表紙(これまでと同じ) |
| 番号つき、1 から 200 | そのページの画像(`/covers/<deployment ID>/<ページ番号>.jpg`) |
| 番号つき、201 以上 | 表紙 |

- 作者だけが開ける版の viewer は、番号つきの URL でも表紙を出す。ページは公開中の版だけを撮るためである。
- 版が `og:image` で自分の画像を表紙に指していても、番号つきの URL ではページの画像を出す。表紙の画像では、どのページの話かが伝わらないためである。
- `/@handle/slug/1` は番号つきの URL なので、1 ページ目を撮った画像を出す。viewer は 1 ページ目のアドレスを番号なしにそろえるので、読者がこの URL を共有することは少ない。
- viewer を返す時点では撮影しない。画像は、貼られたサービスが `og:image` の URL を取りに来たときに撮る。
- 201 以上の番号でも、スライドはそのページから開く(`#201` を渡す)。変わるのは画像だけである。

## ヘルプ

第四スコープで、ヘルプは 1 枚のページの節から、したいことごとの記事に分かれた。ページの作り、記事の持ち方、検索は [ヘルプの枠の実装設計](f36-help-frame.md) に書く。ここには、第三スコープまでの節が何を事実の出どころにしていたかを残す。節の「記事」への移し先は、その文書の対応表にある。

| 変更の前の節 | 事実の出どころ |
| --- | --- |
| 置き方 | `src/uploads/limits.ts`、`src/drops/root.ts`、[ドロップして置くための実装設計](f22-browser-drop.md) |
| ページごとの共有 | [ページの画像](#ページの画像)、`src/share/path.ts` の `MAX_PAGE`、`src/covers/shot.ts` の `MAX_SHOT_PAGE` |
| 引用 | [引用の実装設計](f24-citations.md) |
| ブログへの埋め込み | [埋め込みの実装設計](f25-embed.md) |
| AI エージェントから置く | [AI エージェントから置く実装設計](f23-agent-upload.md)、`src/mcp/files.ts` の `MAX_ARGUMENT_BYTES` |
| フォロー | [フォローの実装設計](f21-follow.md) |
| イベントの発表 | [イベントの発表の実装設計](f29-event-talks.md) |
| コミュニティ | [コミュニティの実装設計](f30-communities.md)、`src/communities/` の上限の定数、`src/handles/hold.ts` の `HANDLE_HOLD_SECONDS` |
| ブロック | [ブロックの実装設計](f32-block.md) |
| 安全について | 「知らない人のスライドを安全に開く」の記事(`src/help/articles/safety/external-access.ts`)。中身は変えていない |
| 規約、プライバシー | `/terms`、`/privacy` へのリンクだけを置く記事。本文は、ここでは持たない |

- 上限と、ページ番号の範囲は、手で書かずに、実装の定数から本文に入れる(`src/help/numbers.ts` の `helpNumbers`)。定数が変わると、ヘルプも変わる。ブラウザが送る前に断る `VERSION_LIMITS` と、サービスの既定の上限が食い違わないことは、`src/help/moved-content.pure.test.ts` が確かめる。
- 画面の文言は、日本語と英語の両方を同じ構造で持つ。ボタンや見出しの名前は、画面の側の文言(`src/drops/text.ts`、`src/publication/panel.ts` など)に合わせる。画面の文言を変えたら、ヘルプも直す。
- 画面からヘルプへのリンクは、記事の URL を指す(`/help/<狙い>/<記事>`)。いまは、記事の編集のページが `/help/articles/markdown` を、コミュニティを作るページが `/help/community/create-community` を、ブロックの確認のページが `/help/safety/block-user` を指す(フッターは `/help` を指す)。単独で置くリンクは、`helpArticleLink` で作り、押せる高さ 44px の `help-link` の class を持たせる。記事の名前を変えるときは、リンク元を探して直す(`src/help/links.test.ts` が、行き先の記事があることを確かめる)。
- 「安全と規約」の一覧から、別のページ `/help/bot`(`src/site/help-bot-page.ts`)へのリンクを置く。Luma の配信を読む User-Agent が指すページで、読むもの、間隔、目的、問い合わせ先を書く。数は `src/feeds/limits.ts` の定数から出す([Luma の配信の実装設計](f33-luma-feeds.md))。
- 規約とプライバシーポリシーは仮のページで、本文は変えていない。ヘルプに書いたことと、それらの本文の食い違いは、PR の「人の確認」に挙げた。
