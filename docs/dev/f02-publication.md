# 公開管理の実装設計

[作者のみ限定公開で確認し、一般公開する](../features/f02-publication.md) を scope1 で実装するための契約。全体の方針は [公開の競合](design.md#公開の競合) と [作者のみ限定公開](design.md#作者のみ限定公開) を参照する。

## 公開状態

アップロード状態（deployment の `state`）と公開状態（deck の列）を分ける。受け取りの `ready` 確定だけでは公開状態は変わらない。

| 状態 | 保存する列 | 匿名配信 |
| --- | --- | --- |
| 下書き `draft` | `public_deployment_id` と `paused_at` が NULL | しない |
| 一般公開 `public` | `public_deployment_id` に一つの deployment | その deployment だけ |
| 停止 `paused` | `paused_at` と、再開で戻す `resume_deployment_id`（任意） | しない |

`public_deployment_id` は一般公開中だけ値を持つ。停止中に公開 pointer が残って漏れることはない。外部キーでは「同じ deck の」「`ready` の」deployment であることまでは保証できない。pointer を書く更新はこの二つを同じ文の条件に含め、配信の認可も pointer と deployment の `deck_id`・`state` を合わせて確かめる。`resume_deployment_id` も同じ。版ごとの配信許可はこの pointer から導出する。版を置き換えると旧版の匿名配信は止まる。購入者向けの現行版は後続 scope で別の列として持つ。

型は `src/publication/state.ts` の `Publication` で表し、矛盾する組み合わせは D1 の CHECK 制約と `parseDeckPublication` の両方で拒否する。

## revision

| 値 | 意味 |
| --- | --- |
| `decks.revision` | 公開状態が変わるたびに 1 進む。作者の操作は表示時の revision を送り、一致したときだけ反映する |

公開状態を変えるのは、作者の操作(公開、停止、再開)と、運営による非表示、スライドの削除だけである。受け取りの開始・送信・確定は、`decks` の公開の列に書き込まない。公開を止めた後に新しい版を受け取っても、止める前に開始した受け取りが止めた後に確定しても、再公開されない(F02-AC7。`src/publication/paused-uploads.test.ts`)。リポジトリの設定に従う公開の方式と、そのための列(`publication_mode`、`author_revision`、`ci_run_id`、`ci_run_attempt`、`deployments.start_revision`、`publish_intent`)は、migration `0034_manual_publication.sql` で取り除いた。

遷移は `src/publication/transitions.ts` の純粋関数で決める。保存側は判断時の revision を条件にした更新で確定し、条件が外れたら読み直す。

### 作者の操作

`decideAuthor(deck, command, expectedRevision)` は次を返す。revision が違えば `conflict` で、現在の状態を変えない。ただし停止は配信を止める方向にしか働かないので revision を照合せず、その時点の状態に適用する。作者が判断している間に別の tab が公開した版も止まる。

| 操作 | 結果 | 失効させる作者限定セッション |
| --- | --- | --- |
| `publish`（公開・更新反映・差し戻し） | 指定した deployment を一般公開。停止中でも明示操作として停止を終える | その deployment |
| `pause` | 停止。一般公開中だった deployment を再開用に覚える | deck の全 deployment |
| `resume` | 覚えた deployment を一般公開、なければ下書き。停止中でなければ `not_paused` | 一般公開に戻す deployment |

同じ状態への操作は `unchanged` で、revision を進めない。対象 deployment が所有者のものか、`ready` かは保存時の条件付き更新で確かめる。

## 作者の公開 API

所有者の session cookie で認証する。応答は `Cache-Control: no-store`。`POST` は JSON を読むので、`Origin` ヘッダーが、要求を受けた URL の origin と一致することを求める(`src/uploads/start-request.ts` の `isOwnOrigin`)。一致しない、`null`(sandbox の iframe)、ヘッダーがない要求は、`Content-Type` が何であっても 403 にする。`hono/csrf` の `csrf()` は、フォームの型のときだけ `Origin` を見るので、この API には足りない。管理画面のフォーム(`POST /slides/:deck/publication`)は、`csrf()` を通す。他人の deck と存在しない deck は同じ 404 にする。

| API | 内容 |
| --- | --- |
| `GET /api/slides/:deck/publication` | `{ publication }`。`publication`(状態)と `revision` を返す |
| `POST /api/slides/:deck/publication` | 本文の `action` で操作を選び、表示時の `expectedRevision` を送る |

| `action` | 追加の項目 |
| --- | --- |
| `publish` | `deploymentId`。公開・更新反映・差し戻しに共通 |
| `pause` | なし。`expectedRevision` は送るが照合しない |
| `resume` | なし |

| 結果 | status | 本文 |
| --- | --- | --- |
| 反映した・変化なし | 200 | `{ result: "applied" \| "unchanged", publication }` |
| revision の競合 | 409 | `{ code: "conflict", publication }`。現在の状態を見て選び直す |
| 停止中でない deck の再開 | 409 | `{ code: "not_paused", publication }` |
| 同じ deck の `ready` でない deployment | 422 | `{ code: "not_publishable", publication }` |
| 本文の不正 | 400 | `{ error }` |

判定は revision の照合を先に行い、古い表示からの操作は対象 deployment の状態にかかわらず `conflict` にする。

保存は `src/publication/store.ts` の `saveTransition` が、判断時の revision、deck の所有者、一般公開にする deployment（同じ deck・`ready`）を同じ UPDATE の条件にして確定する。停止は一般公開にする版がないので、覚えている版が `ready` でなくなっていても止められる。条件が外れたら読み直し、revision が進んでいれば `conflict`、進んでいなければ `not_publishable` を返す。停止だけは、保存までの間に公開が割り込んでも読み直して最大 3 回まで適用し直す。

## 作者限定の閲覧

### コンテンツ origin

作者の HTML は管理画面と別の origin で開く。`CONTENT_ORIGIN`（例 `https://slideusercontent.example`）を設定すると、deployment ごとに `https://d-<deployment ID>.<CONTENT_ORIGIN の host>` を割り当てる。未設定の間は作者限定の閲覧と配信を無効にする。本番の配信ドメインは、作者のファイルだけを置く `slideusercontent.com` で、`wrangler.jsonc` の `CONTENT_ORIGIN` と route `*.slideusercontent.com/*` で設定している。版の origin は 1 階層の subdomain（`d-<ID>.slideusercontent.com`）なので、無料の Universal SSL で TLS が通る。この route は apex 以外の全 subdomain を Worker に向けるため、`slideusercontent.com` に別用途の subdomain を作らず、apex にもサイトを置かない。`CONTENT_ORIGIN` は `PUBLIC_ORIGIN` と末尾 2 ラベルが異なる host でなければ設定エラーとし（同じ site の host は必ず末尾 2 ラベルが一致する。`co.jp` のような複数ラベルの public suffix では別 site でも拒否されるが、安全側に倒している）、末尾ドット付きの値も拒否する。その場合も管理画面は止めずにコンテンツ配信だけを無効にする。ローカルでは `.dev.vars` に `CONTENT_ORIGIN=http://localhost:8794` を置き、`d-<ID>.localhost:8794` で開く。`wrangler dev` は既定で routes の host に request を書き換えるため、`pnpm dev` は `--infer-origin-from-routes=false` を付けて実際の host を保つ。

`src/app/routes.tsx` は `CONTENT_ORIGIN` の host とその subdomain への request を、末尾のドットの有無にかかわらず管理 app に渡さない。サービス自身の Static Assets（`public/`）は Worker を先に動かす設定（`run_worker_first`）にし、管理 host でだけ `ASSETS` binding から返す。これがないと、版の origin の `/styles.css` などがサービスのファイルで隠れ、作者のファイルを読めない。deployment の origin は `src/preview/content.ts` の route だけを持ち、apex・それ以外の subdomain・末尾ドット付きの host は 404 にする。scheme・port が設定と違う request も deployment の origin とみなさない。作者限定の応答は `private, no-store`、`Referrer-Policy: no-referrer`、`X-Robots-Tag: noindex, nofollow` を返す。

### 保存するもの

| テーブル | 内容 |
| --- | --- |
| `preview_launches` | 一度限りの launch token の hash、対象 deployment、所有者、期限、消費時刻と開いた session の hash |
| `content_sessions` | 閲覧セッションの hash、対象 deployment、所有者、期限(枠の session は 5 分で、延長しない) |

token と session は hash だけを保存する。失効は行の削除で表す。

| 値 | 初期値 | 意味 |
| --- | --- | --- |
| launch token の有効期間 | 60 秒 | viewer のページが発行してから、枠の中で消費するまで |
| 枠の session の期限 | 5 分 | 延長しない。切れたら viewer が開き直す |

値は `src/preview/lifetime.ts` に置き、使いながら見直す。

### viewer で見せる設計

作者が、公開する前のスライドと、まだ公開していない新しい版を、自分の viewer(`/@handle/slug`)の枠で見られるようにする([作者のみ限定公開で発表し、一般公開する](../features/f02-publication.md)の F02-AC18〜F02-AC44。2026-11-20 に決めた)。viewer の枠は、トップレベルの移動ではなく、管理画面(別の site)の中の枠である。下の `SameSite=Lax` の cookie は、枠の中の要求には送られない。そのため、別の仕組みが要る。

#### 条件

- 別のスライドの中から、作者限定の中身を読めないこと。「開く流れ」と `src/preview/cross-deck.browser.test.ts` の守りを弱めない。
- 作者限定の中身を出すための値が、viewer の URL、履歴、Referer、サーバーのアクセスログ、共有 URL に残らないこと。
- 値の期限が短いこと。launch token は 60 秒、枠の session と cookie は 5 分(F02-AC33 の「5 分以内」は、この両方を指す)。公開を止めた後、削除した後、作者が退会した後に使えないこと。
- 本番の設定(DNS、ドメイン、secret、binding)を変えないこと。

#### 候補の比較

| 案 | 守り | 手間と欠点 | 結論 |
| --- | --- | --- | --- |
| A 版と作者に結びついた署名つきのパス(`https://d-<ID>/_v/<署名>/index.html`) | 値は版・作者・期限に結びつく。別のスライドは値を知らない | 作者のファイルは byte のまま配るので、`/assets/app.js` のようなルートからの絶対パスの読み込みは、署名のない URL へ行ってしまう(Vite の既定がこの形)。直すには HTML の書き換えか、結局 cookie が要る。値は URL に入るので、アクセスログと、枠の中の Referer の対象になる。署名には secret が要り、新しい secret は本番の設定の変更である | 採らない |
| B 版ごとにランダムな host(`https://v-<乱数>.<配信ドメイン>`)を D1 の行に結びつける | 絶対パスも効く。別のスライドは host を知らない。cookie が要らない | 値が host に入るので、Cloudflare のアクセスログに残る。枠が開いている間は更新され続けるので、ログの値が期限で死なない。host の形が増え、`routeOfHost` と証明書の範囲(1 階層の wildcard)に頼る | 採らない |
| C 枠の中で launch を行い、Partitioned な cookie(CHIPS)を置く | 値は form の本文で送るので、URL・履歴・Referer・アクセスログに残らない。launch token は 60 秒の一度きり。cookie は枠の partition(最上位の site `PUBLIC_ORIGIN`)に閉じ、`HttpOnly`・`Secure`。絶対パスも効く | 下の「partition の共有」の補強が要る。CHIPS に対応しないブラウザでは、枠が開けない | **採る** |
| D Storage Access API で、枠の中から first-party の cookie を使う | cookie は版の origin の本来のもの | 利用者の操作と、Safari の許可の表示が要る。sandbox に `allow-storage-access-by-user-activation` を足すので、作者のファイルの隔離も弱まる | 採らない |
| E `SameSite=None` の通常の cookie | C と同じ | Safari・Firefox の既定、Chrome のシークレットで 3rd-party cookie が止まる。どの partition でも、別の site から送られる | 採らない |

ブラウザの事実(2026-11-20 に確かめた。[MDN: Partitioned cookies](https://developer.mozilla.org/en-US/docs/Web/Privacy/Guides/Privacy_sandbox/Partitioned_cookies)、[Chrome: CHIPS](https://privacysandbox.google.com/cookies/chips)、[WebKit のバグ 292975](https://bugs.webkit.org/show_bug.cgi?id=292975))。

- `Partitioned` は、Chrome・Edge 114、Firefox 141、Safari 26.2 から使える(Safari は 18.4 で入り、18.5 で外れ、26.2 で戻った)。`Secure` が要り、`__Host-` 接頭辞も使える。
- partition の鍵は、cookie を置いた版の origin と、そのときの最上位の URL の site である。祖先の枠は鍵に入らない。
- Firefox は 3rd-party の cookie をもともと最上位の site ごとに分けている。Safari は 3rd-party cookie を止めている。

#### 採る設計(C)

1. 作者が、公開する前のスライド、停止中のスライド、または `?v=<版>` で指した新しい版の viewer を、文書の読み込み(`GET`。HEAD、先読みの `Sec-Purpose`、`Sec-Fetch-Dest` が `document` でない要求を除く)で開くと、サーバーは作者本人(`AUTHOR_GITHUB_IDS` に入っている人)であることを確かめ、その版の launch token(60 秒、一度きり。`issueLaunch`)を発行する。未使用の token は 1 人 20 件までで、古いものから消す。`?v=` が指す版は、一覧の件数にかかわらず直接確かめる。その deck の受け取り済みの版でなければ、作者にも 404 で、別の版を代わりに出さない。
2. viewer のページは、枠(`iframe#deck`)に `name` を付け、`src` を付けない。token は、viewer の markup の中の form の hidden field に置く。form は版の origin の `/_preview/launch` を指し、枠を target にする。`rel="noreferrer"`。`/share.js` が form を送る。token は URL にもヘッダーにも出ない。viewer の CSP の `form-action` は、その版の origin だけを許し、`frame-src` も同じ origin だけにする。枠の `sandbox` と `referrerpolicy` は変えない。viewer の応答は `private, no-store` で、`noindex` を付ける。
3. `/_preview/launch` は、これまでの検査(未使用・期限内・その版宛て・本人・`ready`)に加え、`Sec-Fetch-Dest: iframe` の要求には、`__Host-slide_preview` を `Secure; HttpOnly; SameSite=None; Partitioned; Max-Age=300` で置く。session の行も 5 分で、延長しない。枠でない launch は受けない(404)。
4. 枠の launch への応答は、**303 ではなく 200 の小さなページ**で、`<meta http-equiv="refresh" content="0;url=/">`(ページ番号があれば `/#<番号>`)を持つ。cookie はこの応答で置く。その後の移動は、版の origin のページ自身が行うので、`Sec-Fetch-Site: same-origin` になり、`ownerSessionApplies` の既存の規則(`same-origin` と、トップレベルの移動に効く)で通る。**`ownerSessionApplies` は変えない。** `cross-site` の枠の移動を効かせる規則は、初版で足したが、取り除いた。
5. 値が使えなくなる経路は、これまでの session と同じ行(`content_sessions`)である。公開を止める、版を公開する、スライドを削除する、退会する、運営が非表示にするで、行が消えるか、読むときの検査で外れる(「配信の認可と失効」)。viewer は、開いてから 4 分以上たって再び表示されたとき(`visibilitychange`、bfcache の復帰)に、ページを読み直して、新しい token で開き直す。

初版の誤り(レビューで見つかった)を、ここに残す。初版は、launch の 303 の移動が `cross-site` の枠の移動になることを前提に、`cross-site` の枠の移動を効かせる規則を足し、「別のスライド T の要求は `same-site` なので当たらない」と書いた。しかし Fetch Metadata は、redirect の連鎖に別の site が 1 つでも入ると、最終の要求を `cross-site` にする。T の枠を別の site の redirect 経由で P へ移すと、`cross-site` の枠の移動になり、cookie が付き、規則が通って、P が T の枠の場所に描画された(読み取りはできない)。この規則を足したことが、既存の守り(`fetch-site.test.ts` の「別の site の枠は効かない」)を弱めていた。上の 4 で、規則を足さずに済ませた。

#### partition の共有と別のスライド

CHIPS の鍵は最上位の site だけなので、viewer(最上位は `PUBLIC_ORIGIN`)に出た別のスライド T の枠は、作者限定の版 P の枠と同じ partition にいる。T の script が P の origin へ出す要求には、P の cookie が付く。cookie の有無では守れないので、次の 4 つで守る。これは、`SameSite=Lax` の cookie が同じ登録可能ドメインの別の版の要求に付く、いまの状況と同じ立場で、より悪くはならない。

- `ownerSessionApplies`(変えない): session が効くのは、`same-origin`、`none`、トップレベルの移動だけである。T からの要求(`same-site`)、redirect を挟んだ T の枠の移動(`cross-site`)、別の site の枠(`cross-site`)は、枠の移動を含めて効かない。
- `Cross-Origin-Resource-Policy: same-origin`: script・画像・fetch の埋め込みを、Fetch Metadata を送らないブラウザでも止める。
- `frame-ancestors <PUBLIC_ORIGIN>`: 別の site が P を枠に入れても表示しない。別の site の最上位の partition には、cookie がない。
- session は 5 分で、延長しない。

`Partitioned` を知らない、または無視するブラウザは、`SameSite=None; Secure; HttpOnly` の partition のない cookie を保存する。それはどの最上位 site の枠からも送られ、cookie では守れない。この場合の守りは、`ownerSessionApplies`(Fetch Metadata)と CORP と `frame-ancestors` と、5 分の期限である。Fetch Metadata を送らない client は、`ownerSessionApplies` が真になる(これまでと同じ)。

テストは、`cross-deck.browser.test.ts` に、いまの 3 つの経路(自分の origin、別の版の origin、viewer の中の別のスライド)に加え、次を Chromium と Firefox で足した。viewer で作者限定の版を開いたあと、(a)別の最上位 site が P を枠に入れても、P の応答は中身を返さない、(b)同じページに P の枠と別のスライド T の枠が同時にあり、T が script・fetch・frame・画像で P を読んでも、200 が返らない、(c)T の枠を別の site 経由で P へ移しても、P が出ない。Playwright は、route で返した応答の `Set-Cookie` を partition なしで保存する(Chromium)ので、「別の site の枠に cookie が付かない」ことの確認は Firefox だけである。Chromium は、Fetch Metadata が応答を止めることを確かめる。WebKit は、cookie をテストに見せないので、対象から外す(実機の確認に残る)。

#### 限界

- CHIPS に対応しないブラウザ(Safari 26.2 より前など)では、cookie が置かれず、枠の移動の先は「cookie なし」の `same-origin` の枠の要求になる。版の origin はこれに、中身ではなく、viewer に `slide:preview-unavailable`(`reason: 'unsupported'`)を伝えるページ(404)を返す。session が切れた場合(cookie はあるが無効)は、同じ形で `reason: 'expired'`(401)を返す。viewer は、メッセージの送り元(`event.source` が枠、`event.origin` が版の origin)を確かめて、理由ごとの文を出す(開けないブラウザには「公開すると、読者と同じように見られます。」と添える。別のタブで開く手段は置かない)。作者の HTML が同じ message を送っても、出るのは作者自身の画面の通知だけで、害はない。第三者の site に埋め込まれた枠(`same-origin` でない)には、これまでどおりの素の 404 を返す。
- viewer の枠の中で、作者の JS が `document.cookie` を読むことはない(`HttpOnly`)。
- 枠の session は 5 分で延長しないので、開いてから 5 分より後に、枠の中で初めて読み込む資源(遅延読み込みなど)は、見えなくなる。viewer を開き直すと、また見える。

### 開く流れ

作者限定の中身を開く経路は、viewer の枠だけである(2026-11-20。依頼者の決定: 作者限定の配信 origin は内部の値で、作者に見せる機能ではない)。上の「viewer で見せる設計」の流れ(viewer が token を発行し、枠の中の form が `/_preview/launch` へ送り、Partitioned cookie が置かれ、枠が自分で移る)が、その全部である。

最上位の tab で開く「作者限定で開く」(`POST /slides/:deck/deployments/:id/preview`、`SameSite=Lax` の cookie、`consumeLaunch` の最上位用の経路、`launchPage`)と、MCP の `GET /slides/:deck/deployments/:id/preview` は、取り除いた(F02-AC18)。`/_preview/launch` は `Sec-Fetch-Dest: iframe` の POST だけを受け、ほかは 404 にする。

取り除いて、守りの面が減った点:

- 最上位の session(`SameSite=Lax`、無操作 2 時間・上限 12 時間、延長)がなくなった。session は、枠の cookie 1 種類で、5 分、延長しない。
- `ownerSessionApplies`(`src/preview/fetch-site.ts`)は、`Sec-Fetch-Site` が `same-origin`(または、ヘッダーを送らない古い client)のときだけ session を効かせる。以前は、トップレベルの移動(`navigate` と `document`)も効かせたが、session が最上位で使われなくなったので、取り除いた。同じ厳しさか、それより厳しい。別のスライドの要求、別の site の枠、redirect を挟んだ枠の移動は、これまでどおり効かない。
- session の延長(`renewSession`)がなくなり、読む経路から D1 への書き込みが 1 つ減った。

| request | session |
| --- | --- |
| deployment 自身のファイルの読み込み、launch のあとの枠自身の移動(`same-origin`) | 効く |
| 別の deployment やほかのサイトからの script・画像・fetch・iframe、最上位の移動 | 効かない |
| Fetch Metadata を送らない client | 効く(これまでどおり。cookie が付くのは、枠の partition だけ) |

作者限定で配るファイルには、`Cross-Origin-Resource-Policy: same-origin` も付ける。Fetch Metadata を送らないブラウザでも、別の origin が埋め込めないようにするためである。

これは `src/preview/cross-deck.browser.test.ts` が、Chromium と Firefox で確かめる。Firefox は、自分が送る cookie と Fetch Metadata を、テストにそのまま見せる。Chromium は、cookie を付けるかどうかは自分で決めるが、Fetch Metadata をテストに見せないので、ネットワークに出る値をテストが補う。WebKit は、cookie をテストに見せないので、対象から外している。

使えない token は 403 と、スライドの管理から viewer を開き直す案内を返す。期限切れの launch token と session は定期処理で消す。

## 配信の認可と失効

deployment の origin への `GET` は、毎回 D1 の現在の状態で認可してから R2 を読む。cache や purge の成否には依存しない。判定は `src/preview/access.ts` の `decideAccess` が行う。

| 状態 | 応答 |
| --- | --- |
| deck の `public_deployment_id` がこの deployment で `ready` | 匿名で配信。`Cache-Control: no-cache, no-transform` と sha256 の weak な `ETag`（[内部 cache](f03-sharing.md#読者向けの配信と内部-cache) を参照） で、browser は毎回再検証する。作者の HTML そのものは検索対象にしないため `noindex` と `no-referrer` も付ける。共有 URL の検索表示は F03 の viewer で扱う |
| 所有者の有効な閲覧セッション | 配信。`private, no-store`・`no-referrer`・`noindex` |
| 失効・期限切れのセッション cookie | 401 と、管理画面から開き直す案内 |
| それ以外 | 404。下書きは存在しない deployment と区別しない |

path は `/` と `/dir/` を `index.html` に解決し、`..`・空の segment・`_preview/` を拒否する。宣言されていない SPA fallback は置かない。作者のファイルには `sandbox allow-scripts allow-same-origin; worker-src 'none'; frame-ancestors <祖先>` の CSP を付け、form・popup・service worker を許さない。`<祖先>` は、作者限定で配るファイルでは `<PUBLIC_ORIGIN>`、一般公開のファイルでは `*` である。理由は [ブログへの埋め込みの実装設計](f25-embed.md#作者のファイルを枠に入れられるサイト) に書く。

一般公開・再開では、その deployment の閲覧セッションと未消費の launch token を、公開状態の UPDATE と同じ D1 batch で削除する。停止では deck の全 deployment について削除する。UPDATE は保存ごとに新しい `decks.change_id` を書き、削除はその値と一致する場合だけ効く。同じ遷移を決めた別の要求が先に保存しても、負けた側の削除は効かず、その後に開き直した閲覧を消さない。版を置き換えると旧版は公開 pointer から外れるので、旧版の HTML・asset の直接 URL も次の request から 404 になる。取得済みのデータは回収できない。

## 管理画面

`/slides/:deck` の「公開」の枠に公開の状態の文と、1 つのボタンを置く([画面の枠](f03-sharing.md#画面の枠))。「新しい版」の枠のドロップ枠の下に、版の行を 2 行まで置く。deployment の ID、出どころ、受け取りの状態、ファイルの数、開始の日時は、作者向けの画面に出さない(F02-AC8。運営の画面は変えない)。以前の版へ差し戻す操作は画面にない(F02-AC16。経路と仕組みは残す。決まりは F02 の「決めたこと」)。

- 公開の枠の状態の文は、「公開中」「まだ公開していません」「公開を止めています」の 3 つで、画面に 1 か所だけ出る(F02-AC9)。ボタンは、公開中なら「公開を止める」(説明は F02-AC15)、公開を止めていて再開先があれば「もう一度公開する」(再開)、まだ公開していない(または再開先がない)なら、最新の受け取り済みの版を公開する「公開する」である。受け取り済みの版がなければ、ボタンの代わりに「スライドを置くと、公開できます。」と出す。最新の受け取り済みの版は `readLatestReady`(`src/publication/store.ts`)が読む。並びは、受け取った秒、次に置いた順(SQLite の `rowid`)で決める。ID はランダムで、秒は粗いので、同じ秒に置いた版の新旧を決められない(F02-AC49)。版の行を作る純粋な `versionRows` は、`PointedVersion` の `order` で同じ順に比べる。
- 版の行は、純粋な `versionRows`(`src/publication/version-rows.ts`)が、公開の状態、公開の枠が指す版(公開中の版、または再開先)、最新の受け取り済みの版から決める。公開中なら「読者に見えている版」、最新の版がそれと違えば「まだ公開していない新しい版」を足す(F02-AC10・F02-AC11)。まだ公開していなければ最新の版が「まだ公開していません」、公開を止めていれば再開先の版が「公開を止めています」(その後に、新しい版があれば足す)。各行に、受け取った日(`dayFormats`)と「見る」があり、新しい版と、公開前の行には「この版を公開する」、公開を止めている行には「もう一度公開する」がある(F02-AC12)。公開すると、公開の枠が指す版が入れ替わり、1 行に戻る(F02-AC13・F02-AC14)。
- 「viewer で見る」(題名の横)と行の「見る」は、作者の viewer へのリンクである(`ownerViewerPath`、F02-AC32)。読者に見えている版の行は、読者と同じ `/@handle/slug`、ほかの版の行は `?v=<版>` を付ける(F02-AC40〜F02-AC42)。ハンドルがまだない作者は viewer を持てないので、リンクを出さない(編集の画面だけが残る)。
- 置いた直後(ブラウザのドロップ、MCP)の行き先と、スライドの管理の行の表紙と題名は、作者の viewer である(F22-AC33〜F22-AC37、F23-AC4)。受け取りの応答の `viewUrl`(`src/uploads/api.ts`)が行き先を決め、`public/drop.js` の `getDropDestination` が使う。MCP の `previewUrl` は `/@handle/slug?v=<版>`(ハンドルがない作者は `manageUrl` と同じ)。
- owner session が切れた後の form 送信はログイン画面を返す。
- `CONTENT_ORIGIN` が未設定または不正な間は、「見る」と「viewer で見る」を出さず、配信ドメインが未設定で読者も開けないことを表示する。公開状態の切り替えは記録できる。
- form は `POST /slides/:deck/publication` に表示時の revision を送り、結果を `?result=` 付きで同じ画面に戻して表示する。競合したときは現在の状態を表示し直し、選び直せる。

## 未決事項

- 閲覧セッションの期限切れ時の再認証の動線（管理画面から開き直す）が発表中に十分か。

これらは各操作を実装する PR で確定し、この文書に追記する。
