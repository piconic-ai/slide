# 公開管理の実装設計

[作者のみ限定公開で確認し、一般公開する](../features/f02-publication.md) を scope1 で実装するための契約。全体の方針は [公開の競合](design.md#公開の競合) と [作者のみ限定公開](design.md#作者のみ限定公開) を参照する。

## 公開状態

アップロード状態（deployment の `state`）と公開状態（deck の列）を分ける。F01 の `ready` 確定だけでは公開状態は変わらない。

| 状態 | 保存する列 | 匿名配信 |
| --- | --- | --- |
| 下書き `draft` | `public_deployment_id` と `paused_at` が NULL | しない |
| 一般公開 `public` | `public_deployment_id` に一つの deployment | その deployment だけ |
| 停止 `paused` | `paused_at` と、再開で戻す `resume_deployment_id`（任意） | しない |

`public_deployment_id` は一般公開中だけ値を持つ。停止中に公開 pointer が残って漏れることはない。外部キーでは「同じ deck の」「`ready` の」deployment であることまでは保証できない。pointer を書く更新はこの二つを同じ文の条件に含め、配信の認可も pointer と deployment の `deck_id`・`state` を合わせて確かめる。`resume_deployment_id` も同じ。版ごとの配信許可はこの pointer から導出する。版を置き換えると旧版の匿名配信は止まる。購入者向けの現行版は後続 scope で別の列として持つ。

型は `src/publication/state.ts` の `Publication` で表し、矛盾する組み合わせは D1 の CHECK 制約と `parseDeckPublication` の両方で拒否する。

## revision と CI の順序

| 値 | 意味 |
| --- | --- |
| `decks.revision` | 公開状態・モードが変わるたびに 1 進む。作者の操作は表示時の revision を送り、一致したときだけ反映する |
| `decks.author_revision` | 最後の作者操作の revision。CI はこれより前に開始していれば反映しない |
| `decks.ci_run_id`・`ci_run_attempt` | repository モードで最後に公開を変えた GitHub Actions の run。GitHub の run ID は一意で時間とともに増えるので、run ID・attempt の順で新旧を比べる。repository の連携を変えても値は残す |
| `deployments.start_revision` | アップロード開始時の deck の revision。開始の INSERT と同じ文で読む。0006 より前の deployment は NULL で、CI の反映対象にしない |
| `deployments.publish_intent` | workflow が求めた公開。`published`・`unpublished`・NULL（指定なし） |

遷移は `src/publication/transitions.ts` の純粋関数で決める。保存側は判断時の revision を条件にした更新で確定し、条件が外れたら読み直す。

### 作者の操作

`decideAuthor(deck, command, expectedRevision)` は次を返す。revision が違えば `conflict` で、現在の状態を変えない。ただし停止は配信を止める方向にしか働かないので revision を照合せず、その時点の状態に適用する。作者が判断している間に CI や別の tab が公開した版も止まる。

| 操作 | 結果 | 失効させる作者限定セッション |
| --- | --- | --- |
| `publish`（公開・更新反映・差し戻し） | 指定した deployment を一般公開。停止中でも明示操作として停止を終える | その deployment |
| `pause` | 停止。一般公開中だった deployment を再開用に覚える | deck の全 deployment |
| `resume` | 覚えた deployment を一般公開、なければ下書き。停止中でなければ `not_paused` | 一般公開に戻す deployment |
| `set_mode` | モードだけを変える。停止は維持 | なし |

同じ状態への操作は `unchanged` で、revision を進めない。対象 deployment が所有者のものか、`ready` かは保存時の条件付き更新で確かめる。

### repository モードの CI

`decideCi(deck, ci)` は ready になった deployment を受け取り、次の順で反映しない理由を判定する。

1. 手動モード、または workflow が公開を指定していない。
2. 停止中。停止中に開始した CI も含む。
3. 開始時 revision が `author_revision` より古い、deck の revision より新しい、または NULL（0006 より前）。停止後の再開や手動の差し戻しを、それより前に始まった CI が上書きしない。
4. すでに反映した run より古い。
5. 記録済みの run・attempt と同じ。同じ attempt が別の inventory で作った deployment も含め、最初に反映した結果を変えない。

`published` は一般公開に、`unpublished` は下書きに戻す。新しい run の結果が現在と同じでも run は記録するので、後から完了した古い run が上書きしない。反映しなかった deployment は下書きとして残り、作者が手動で公開できる。CI の反映は `author_revision` を進めないため、新旧の CI が逆順に完了しても新しい run が勝つ。

### CI からの公開の指定

manifest の `publication.published` に当たる値を、アップロード開始の本文に任意の `publication: { "published": true | false }` として送る。公式 Action では `published` 入力（`true`・`false`・空）、uploader では `SLIDE_PUBLISHED` で指定する。空なら送らない。manifest ファイル自体の受け取りは F01 の後続で扱う。

値は deployment の `publish_intent` に保存する。同じ run・attempt・inventory の開始を別の指定で再送すると `intent_conflict` の 409 にする。finalize は `ready` になった応答のたびに `applyCiPublication` を呼び、`decideCi` の結果を `publication: { applied, reason? }` として返す。ready の確定と公開の反映の間で失敗しても、finalize の再送で反映し直せる。記録済みの run は `recorded_run` で反映しないので、再送で二重に変わらない。最初の応答が失われて再送した場合でも、deck がこの run の結果を表していれば `applied: true` を返す。同時に走った finalize も同じ結果を返す。Action の出力 `publication-applied` はこの `applied` を返す。公開の指定は開始時に保存されるため、credential の失効で再認証するときに `SLIDE_PUBLISHED` を変えると `intent_conflict` で止まる。

## 作者の公開 API

所有者の session cookie で認証する。`POST` は CSRF 対策を通し、応答は `Cache-Control: no-store`。他人の deck と存在しない deck は同じ 404 にする。

| API | 内容 |
| --- | --- |
| `GET /api/decks/:deck/publication` | `{ publication }`。`mode`・`publication`・`revision` などを返す |
| `POST /api/decks/:deck/publication` | 本文の `action` で操作を選び、表示時の `expectedRevision` を送る |

| `action` | 追加の項目 |
| --- | --- |
| `publish` | `deploymentId`。公開・更新反映・差し戻しに共通 |
| `pause` | なし。`expectedRevision` は送るが照合しない |
| `resume` | なし |
| `set_mode` | `mode`（`manual` または `repository`） |

| 結果 | status | 本文 |
| --- | --- | --- |
| 反映した・変化なし | 200 | `{ result: "applied" \| "unchanged", publication }` |
| revision の競合 | 409 | `{ code: "conflict", publication }`。現在の状態を見て選び直す |
| 停止中でない deck の再開 | 409 | `{ code: "not_paused", publication }` |
| 同じ deck の `ready` でない deployment | 422 | `{ code: "not_publishable", publication }` |
| 本文の不正 | 400 | `{ error }` |

判定は revision の照合を先に行い、古い表示からの操作は対象 deployment の状態にかかわらず `conflict` にする。

保存は `src/publication/store.ts` の `saveTransition` が、判断時の revision、deck の所有者、一般公開にする deployment（同じ deck・`ready`）を同じ UPDATE の条件にして確定する。停止とモード変更は一般公開にする版がないので、覚えている版が `ready` でなくなっていても止められる。条件が外れたら読み直し、revision が進んでいれば `conflict`、進んでいなければ `not_publishable` を返す。停止だけは、保存までの間に公開が割り込んでも読み直して最大 3 回まで適用し直す。

## 作者限定の閲覧

### コンテンツ origin

作者の HTML は管理画面と別の origin で開く。`CONTENT_ORIGIN`（例 `https://slideusercontent.example`）を設定すると、deployment ごとに `https://d-<deployment ID>.<CONTENT_ORIGIN の host>` を割り当てる。未設定の間は作者限定の閲覧と配信を無効にする。本番のドメインは [サービス名とドメインを決める](https://github.com/piconic-ai/slide/issues/14) で決めるため、`wrangler.jsonc` にはまだ書かず、`src/env.d.ts` で任意の設定として宣言している。`CONTENT_ORIGIN` は `PUBLIC_ORIGIN` と末尾 2 ラベルが異なる host でなければ設定エラーとし（同じ site の host は必ず末尾 2 ラベルが一致する。`co.jp` のような複数ラベルの public suffix では別 site でも拒否されるが、安全側に倒している）、末尾ドット付きの値も拒否する。その場合も管理画面は止めずにコンテンツ配信だけを無効にする。ローカルでは `.dev.vars` に `CONTENT_ORIGIN=http://localhost:8794` を置き、`d-<ID>.localhost:8794` で開く。`wrangler dev` は既定で routes の host に request を書き換えるため、`pnpm dev` は `--infer-origin-from-routes=false` を付けて実際の host を保つ。

`server.tsx` は `CONTENT_ORIGIN` の host とその subdomain への request を、末尾のドットの有無にかかわらず管理 app に渡さない。deployment の origin は `src/preview/content.ts` の route だけを持ち、apex・それ以外の subdomain・末尾ドット付きの host は 404 にする。scheme・port が設定と違う request も deployment の origin とみなさない。作者限定の応答は `private, no-store`、`Referrer-Policy: no-referrer`、`X-Robots-Tag: noindex, nofollow` を返す。

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

### 開く流れ

1. 管理画面の form が `POST /decks/:deck/deployments/:id/preview` を送る（所有者の session と CSRF 対策が必要）。所有者の deck の `ready` な deployment なら launch token を発行する。
2. 応答は token を hidden field に持つ form を deployment の origin の `/_preview/launch` へ自動送信するページ。token を URL・履歴・Referer に残さない。CSP の `form-action` はその origin だけを許す。
3. `/_preview/launch` は token が未使用・期限内・その deployment 宛て・許可した本人のもので、deployment がまだ所有者の `ready` かを確かめ、消費と session の作成を一つの D1 batch で行う。同じ token を同時に使っても session は一つしかできない。
4. host-only の `__Host-slide_preview` cookie（`Secure`・`HttpOnly`・`SameSite=Lax`・`Path=/`）を設定し、`/` へ 303 で移る。cookie は deployment の origin にしか送られず、管理 API の認証には使わない。

使えない token は 403 と、管理画面から開き直す案内を返す。期限切れの launch token と session は定期処理で消す。

## 配信の認可と失効

deployment の origin への `GET` は、毎回 D1 の現在の状態で認可してから R2 を読む。cache や purge の成否には依存しない。判定は `src/preview/access.ts` の `decideAccess` が行う。

| 状態 | 応答 |
| --- | --- |
| deck の `public_deployment_id` がこの deployment で `ready` | 匿名で配信。`Cache-Control: no-cache` と sha256 の `ETag` で、browser は毎回再検証する。作者の HTML そのものは検索対象にしないため `noindex` と `no-referrer` も付ける。共有 URL の検索表示は F03 の viewer で扱う |
| 所有者の有効な閲覧セッション | 配信。`private, no-store`・`no-referrer`・`noindex` |
| 失効・期限切れのセッション cookie | 401 と、管理画面から開き直す案内 |
| それ以外 | 404。下書きは存在しない deployment と区別しない |

path は `/` と `/dir/` を `index.html` に解決し、`..`・空の segment・`_preview/` を拒否する。宣言されていない SPA fallback は置かない。作者のファイルには `sandbox allow-scripts allow-same-origin; worker-src 'none'; frame-ancestors <PUBLIC_ORIGIN>` の CSP を付け、form・popup・service worker を許さない。

一般公開・CI による公開・再開では、その deployment の閲覧セッションと未消費の launch token を、公開状態の UPDATE と同じ D1 batch で削除する。停止では deck の全 deployment について削除する。UPDATE は保存ごとに新しい `decks.change_id` を書き、削除はその値と一致する場合だけ効く。同じ遷移を決めた別の要求が先に保存しても、負けた側の削除は効かず、その後に開き直した閲覧を消さない。版を置き換えると旧版は公開 pointer から外れるので、旧版の HTML・asset の直接 URL も次の request から 404 になる。取得済みのデータは回収できない。

## 未決事項

- 閲覧セッションの期限切れ時の再認証の動線（管理画面から開き直す）が発表中に十分か。

これらは各操作を実装する PR で確定し、この文書に追記する。
