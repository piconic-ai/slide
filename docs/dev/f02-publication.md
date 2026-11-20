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

`server.tsx` は `CONTENT_ORIGIN` の host とその subdomain への request を、末尾のドットの有無にかかわらず管理 app に渡さない。サービス自身の Static Assets（`public/`）は Worker を先に動かす設定（`run_worker_first`）にし、管理 host でだけ `ASSETS` binding から返す。これがないと、版の origin の `/styles.css` などがサービスのファイルで隠れ、作者のファイルを読めない。deployment の origin は `src/preview/content.ts` の route だけを持ち、apex・それ以外の subdomain・末尾ドット付きの host は 404 にする。scheme・port が設定と違う request も deployment の origin とみなさない。作者限定の応答は `private, no-store`、`Referrer-Policy: no-referrer`、`X-Robots-Tag: noindex, nofollow` を返す。

### 保存するもの

| テーブル | 内容 |
| --- | --- |
| `preview_launches` | 一度限りの launch token の hash、対象 deployment、所有者、期限、消費時刻と開いた session の hash |
| `content_sessions` | 閲覧セッションの hash、対象 deployment、所有者、期限と延長の上限 |

token と session は hash だけを保存する。失効は行の削除で表す。

| 値 | 初期値 | 意味 |
| --- | --- | --- |
| launch token の有効期間 | 60 秒 | 管理画面で発行してから別 origin で消費するまで |
| 閲覧セッションの無操作期限 | 2 時間 | 残りが半分以下の request で 2 時間先まで延長する。最後の利用から少なくとも 1 時間、最大 2 時間で切れる |
| 閲覧セッションの上限 | 12 時間 | 延長してもこれを超えない。発表 1 回分を想定した暫定値 |

値は `src/preview/lifetime.ts` に置き、使いながら見直す。

### viewer で見せる設計

作者が、公開する前のスライドと、まだ公開していない新しい版を、自分の viewer(`/@handle/slug`)の枠で見られるようにする([作者のみ限定公開で発表し、一般公開する](../features/f02-publication.md)の F02-AC18〜F02-AC44。2026-11-20 に決めた)。viewer の枠は、トップレベルの移動ではなく、管理画面(別の site)の中の枠である。下の `SameSite=Lax` の cookie は、枠の中の要求には送られない。そのため、別の仕組みが要る。

#### 条件

- 別のスライドの中から、作者限定の中身を読めないこと。「開く流れ」と `src/preview/cross-deck.browser.test.ts` の守りを弱めない。
- 作者限定の中身を出すための値が、viewer の URL、履歴、Referer、サーバーのアクセスログ、共有 URL に残らないこと。
- 値の期限が短いこと(5 分以内)。公開を止めた後、削除した後、作者が退会した後に使えないこと。
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

1. 作者が、公開する前のスライド、または新しい版の viewer を開くと、サーバーは作者本人であることを確かめ、その版の launch token(60 秒、一度きり。`issueLaunch`)を発行する。
2. viewer のページは、枠(`iframe#deck`)に `name` を付け、`src` を付けない。token は、viewer の markup の中の form の hidden field に置く。form は版の origin の `/_preview/launch` を指し、枠を target にする。`rel="noreferrer"`。`/share.js` が form を送る。token は URL にもヘッダーにも出ない。viewer の CSP の `form-action` は、その版の origin だけを許し、`frame-src` も同じ origin だけにする。枠の `sandbox` と `referrerpolicy` は変えない。viewer の応答は `private, no-store` で、`noindex` を付ける。
3. `/_preview/launch` は、これまでの検査(未使用・期限内・その版宛て・本人・`ready`)に加え、`Sec-Fetch-Dest: iframe` の要求には、`__Host-slide_preview` を `Secure; HttpOnly; SameSite=None; Partitioned` で置く。トップレベルの launch(「作者限定で開く」)は、これまでどおり `SameSite=Lax` で、partition なし。
4. 303 の移動先 `/` は、枠の移動(`Sec-Fetch-Mode: navigate`、`Sec-Fetch-Dest: iframe`、`Sec-Fetch-Site: cross-site`)である。`ownerSessionApplies` は、これを効かせる。枠の中の自分の読み込み(`same-origin`)はこれまでどおり効く。
5. 値が使えなくなる経路は、これまでの session と同じ行(`content_sessions`)である。公開を止める、版を公開する、スライドを削除する、退会する、運営が非表示にするで、行が消えるか、読むときの検査で外れる(「配信の認可と失効」)。cookie の期限は、これまでの session と同じ(無操作 2 時間、上限 12 時間)で、viewer を開き直すたびに新しい launch で置き直す。

#### partition の共有と別のスライド

CHIPS の鍵は最上位の site だけなので、viewer(最上位は `PUBLIC_ORIGIN`)に出た別のスライド T の枠は、作者限定の版 P の枠と同じ partition にいる。T の script が P の origin へ出す要求には、P の cookie が付く。cookie の有無では守れないので、次の 4 つで守る。これは、`SameSite=Lax` の cookie が同じ登録可能ドメインの別の版の要求に付く、いまの状況と同じ立場で、より悪くはならない。

- `ownerSessionApplies`: T からの要求は `Sec-Fetch-Site: same-site`(同じ配信ドメイン)なので、枠の移動を含めて session を効かせない。効かせるのは、`same-origin`、`none`、最上位の移動、そして `cross-site` の枠の移動だけである。`cross-site` の枠の移動は、親が管理画面である viewer の枠(別の site の祖先)であり、T は同じ site なので当たらない。
- `Cross-Origin-Resource-Policy: same-origin`: script・画像・fetch の埋め込みを、Fetch Metadata を送らないブラウザでも止める。
- `frame-ancestors <PUBLIC_ORIGIN>`: 別の site が P を枠に入れても表示しない。別の site の最上位の partition には、cookie がない。
- 作者限定の応答は `private, no-store`。

テストは、`cross-deck.browser.test.ts` に、いまの 3 つの経路(自分の origin、別の版の origin、viewer の中の別のスライド)に加え、viewer で作者限定の版を開いた同じブラウザの中で、別のスライドから script・fetch・iframe・画像・form で P を読み込む場合を、Chromium と Firefox で足す。WebKit は、cookie をテストに見せないので、対象から外す(その確認は実機の `verify-slide` に残る)。

#### 限界

- CHIPS に対応しないブラウザ(Safari 26.2 より前など)では、cookie が置かれず、枠に開き直しの案内が出る。第一スコープでは、対応外として扱う。
- viewer の枠の中で、作者の JS が `document.cookie` を読むことはない(`HttpOnly`)。
- launch の応答を、枠でなく最上位で開くと、これまでの cookie になる。

### 開く流れ

1. 管理画面の form が `POST /slides/:deck/deployments/:id/preview` を送る（所有者の session と CSRF 対策が必要）。所有者の deck の `ready` な deployment なら launch token を発行する。
2. 応答は token を hidden field に持つ form を deployment の origin の `/_preview/launch` へ自動送信するページ。token を URL・履歴・Referer に残さない。CSP の `form-action` はその origin だけを許す。
3. `/_preview/launch` は token が未使用・期限内・その deployment 宛て・許可した本人のもので、deployment がまだ所有者の `ready` かを確かめ、消費と session の作成を一つの D1 batch で行う。同じ token を同時に使っても session は一つしかできない。
4. host-only の `__Host-slide_preview` cookie（`Secure`・`HttpOnly`・`SameSite=Lax`・`Path=/`）を設定し、`/` へ 303 で移る。cookie は deployment の origin にしか送られず、管理 API の認証には使わない。

作者限定の session は、その deployment 自身の request と、トップレベルの移動にだけ効く(`src/preview/fetch-site.ts`)。deployment の origin は版ごとに違うが、どれも同じ登録可能ドメインの下にあるので、ブラウザは `SameSite=Lax` の cookie を、別の deployment のページが出す request にも付ける。別のスライドが作者限定のファイルを script として読み込むと、その中身が別のスライドの中で動いてしまう。そのため、`Sec-Fetch-Site` が `same-origin` でも `none` でもなく、トップレベルの移動(`Sec-Fetch-Mode: navigate` かつ `Sec-Fetch-Dest: document`)でもない request は、session がないものとして扱う。匿名の読者と同じ応答になる。

| request | session |
| --- | --- |
| deployment 自身のファイルの読み込み(`same-origin`) | 効く |
| 作者がアドレスを開く、launch のあとの redirect(トップレベルの移動) | 効く |
| 別の deployment やほかのサイトからの script・画像・fetch・iframe | 効かない |
| 別の deployment のページが、先読みさせたページ(`Sec-Purpose` が付く) | 効かない |
| Fetch Metadata を送らない client | 効く(これまでどおり) |

作者限定で配るファイルには、`Cross-Origin-Resource-Policy: same-origin` も付ける。Fetch Metadata を送らないブラウザでも、別の origin が埋め込めないようにするためである。

これは `src/preview/cross-deck.browser.test.ts` が、Chromium と Firefox で確かめる。Firefox は、自分が送る cookie と Fetch Metadata を、テストにそのまま見せる。Chromium は、cookie を付けるかどうかは自分で決めるが、Fetch Metadata をテストに見せないので、ネットワークに出る値をテストが補う。WebKit は、cookie をテストに見せないので、対象から外している。


使えない token は 403 と、管理画面から開き直す案内を返す。期限切れの launch token と session は定期処理で消す。

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

> 第一スコープの見直し(2026-11-20)で変える(W2。F02-AC8〜F02-AC16)。次の「版の履歴」「受領完了の版ごと」「更新か差し戻しか」「この版を一般公開する」「作者限定で開く」の記述は、いまの実装の説明である。変えた後は、読者に見えている版と、まだ公開していない新しい版の 2 行(「見る」と「この版を公開する」)、公開の状態の文 1 か所、差し戻しの操作なしに書き直す。「見る」の行き先は、作者限定の viewer(F02-AC32)の設計で決める。

`/slides/:deck` の「公開」の枠に公開状態を、「版の履歴」の枠に受領完了の版ごとの操作を並べる([画面の枠](f03-sharing.md#画面の枠))。

- 現在の状態（下書き・一般公開中の版・停止中と再開で戻す版）を表示し、停止・再開の form を置く。版は deployment の ID で呼ぶ。公開の方式は手動だけで、方式の切り替えはない(F02-AC6)。
- 受領完了の版ごとに「作者限定で開く」（別 tab）と「この版を一般公開する」を置く。公開中の版があるときは、公開中の版からの更新か差し戻しかと、置き換えでその URL が開けなくなることを操作の横に表示する。停止中は、その操作が停止を解除して公開することを表示する。公開中・再開先の版は表示中の履歴ページに無くても別に読む。
- owner session が切れた後の form 送信はログイン画面を返す。
- `CONTENT_ORIGIN` が未設定または不正な間は、作者限定で開く操作を出さず、配信ドメインが未設定で読者も開けないことを表示する。公開状態の切り替えは記録できる。
- form は `POST /slides/:deck/publication` に表示時の revision を送り、結果を `?result=` 付きで同じ画面に戻して表示する。競合したときは現在の状態を表示し直し、選び直せる。

## 未決事項

- 閲覧セッションの期限切れ時の再認証の動線（管理画面から開き直す）が発表中に十分か。

これらは各操作を実装する PR で確定し、この文書に追記する。
