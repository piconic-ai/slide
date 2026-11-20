# 運営による非表示の実装設計

[知らない人のスライドも、安心して開ける](../features/f17-safe-viewing.md) のうち、運営がスライドを非表示にする部分を実装するための契約。公開状態は [公開管理の実装設計](f02-publication.md)、共有 URL と配信は [共有 URL と配信の実装設計](f03-sharing.md) を使い、ここでは非表示の状態、運営の画面、その守り方を扱う。

## 非表示の状態

運営による非表示は、作者の公開状態とは別に持つ。`decks` の `hidden_at`、`hidden_reason`、`hidden_by` の 3 列で、3 つとも入っているときが非表示、3 つとも `NULL` のときが通常である。一部だけが入った行は、読み取りで不正として拒否する。

公開状態の列(`public_deployment_id` など)は、非表示にしても変えない。解除すると、非表示にしたときの公開状態にそのまま戻る。そのために、非表示の間は公開状態を変える操作をすべて拒否する。

| 操作 | 非表示の間の結果 |
| --- | --- |
| 作者の公開・再開・停止・公開方法の変更 | `hidden`(409)。公開状態は変わらない |
| CI の公開と公開の取り下げ | 理由 `hidden` で見送る。版は下書きとして残る |
| 運営がもう一度非表示にする | 変わらない。最初の理由・日時・操作者を保つ |

判定は `src/publication/takedown.ts` の純粋な関数で行う。保存は `src/publication/takedown-store.ts` が行い、判定のもとにした状態と一致するときだけ更新する。公開状態の保存(`saveTransition`)は、条件に「非表示でないこと」を含む。読み取りと保存の間に非表示になっても、公開状態は変わらない。

## 読者に見せない

非表示のスライドは、誰にも見せない。作者も開けない。読者向けの query は、すべて `takedown-store.ts` の条件 `notHidden` を付ける。この条件は、持ち主のアカウントが停止中でないことも含む([アカウントの停止の実装設計](f17-suspension.md))。

- 共有 URL、公開スライドの一覧(トップ、プロフィール)、表紙
- 引用と被引用の一覧
- 配信の許可(匿名の読者と、作者限定の session の両方)、作者限定の表示を開く操作

トップページの「最近公開されたスライド」は、一覧の API(`/api/public/slides`)から取得する。この API は `Cache-Control: public, max-age=60` を付けているので、ブラウザが一覧を取得し直すとき、最長 60 秒は古い応答を使い回すことがある。その間は、非表示にしたスライドが一覧に残る。cache はそのままにすると決めた(2026-11-17)。開いたままのページの一覧は、読み込み直すまで変わらない。一覧からスライドを開いても、共有 URL と配信は、非表示にした直後から拒否する。

配信は、保存したファイルを読む前に許可を判定する。内部の cache が温まっていても、非表示にした直後の request から拒否する。cache の中身は消さない。

`src/share/takedown-readers.test.ts` は、`public_deployment_id` を読む source のうち、作者側のファイル以外が `notHidden` を使っていなければ失敗する。読者向けの query を足すときは、条件を付ける。作者側のファイルを足すときは、テストの一覧に足し、読者に何も見せないことを確かめる。

## 運営の画面

運営の画面は、管理画面とは別の host(`OPERATOR_ORIGIN`、本番は `https://admin.slide.community`)に置く。この host に来た request には、運営の app(`src/operator/routes.ts`)だけが答える。管理画面や配信の経路は、この host には出ない。運営の経路は、ほかの host にはない。

| 経路 | 内容 |
| --- | --- |
| `GET /` | 非表示にする form、通報されたスライドの一覧([通報の実装設計](f17-reports.md#運営の画面の一覧))、非表示にしているスライドの一覧(理由・日時・操作者)。非表示の一覧は新しい順に 50 件ずつで、`?page=2` のように続きを開く。件数を上に出す |
| `POST /takedowns` | 共有 URL、または `@handle/slug` で指したスライドを、理由を付けて非表示にする |
| `POST /takedowns/:deck/release` | 非表示を解除する |
| `POST /suspensions`、`POST /suspensions/:user/release` | アカウントの停止と解除([アカウントの停止の実装設計](f17-suspension.md#運営の画面)) |
| `GET /robots.txt` | すべての path を拒否する。token なしで読める |

すべての応答に `X-Robots-Tag: noindex, nofollow` と `Cache-Control: no-store` を付ける。公開側のページと sitemap から、この host へリンクしない。これは検索に載せないための対処で、守りは次の節の検証に置く。

運営の画面の応答には `Referrer-Policy: same-origin` を付ける。管理画面と同じ `no-referrer` にすると、ブラウザは form の `POST` に `Origin: null` を付けるので、次の検査を通らない。

`POST` は、`Origin` がこの origin と一致するものだけを受ける。本文の種類や、`Sec-Fetch-Site` などのほかの header では判断しない。一致しなければ 403 を返す。

作者の管理画面(`/slides/:deck`)には、運営が非表示にしていることと、理由と日時を出す。操作者は出さない。

## 運営だけに開く

誰が運営かは、Cloudflare Access の policy で決める。アプリの設定やコードには、運営の一覧を持たない。設定を変える PR で運営を増やせないようにするためである。Access の application と policy は、infra リポジトリ(非公開。Cloudflare の資源を Pulumi で宣言している)に書く。

Access は、通した request に `Cf-Access-Jwt-Assertion` を付ける。Worker は、すべての request でこの token を検証する(`src/operator/access.ts`)。Access を通らない経路から届いた request を通さないためである。

- 署名を、team の公開鍵で確かめる。算法は RS256 だけを受ける。
- 発行元が `ACCESS_TEAM_DOMAIN`、audience が `ACCESS_AUD` と一致する。
- 期限が切れていない。
- 本人の email がある。email のない token(service token など)は、操作者を記録できないので拒否する。

検証できない request には、存在しないページと同じ応答(404)を返す。`ACCESS_TEAM_DOMAIN` と `ACCESS_AUD` がそろっていない間、また形が正しくない間は、この host のすべての request が 404 になる。

公開鍵は、team の `/cdn-cgi/access/certs` から取得する(`src/operator/access-client.ts`)。Access は鍵を定期的に替えるので、設定には写さない。

ローカルとテストでは、テストごとに作る鍵で署名した token を使う(`src/operator/test-support.ts`)。検証を飛ばす設定は作らない。そのため、運営の画面をローカルのブラウザで開く手段はない。画面の内容は route のテストで確かめ、ブラウザでの確認は本番で行う。

## 設定

| 名前 | 置き場所 | 内容 |
| --- | --- | --- |
| `OPERATOR_ORIGIN` | `wrangler.jsonc` の vars | 運営の画面の origin。未設定なら、運営の host はない |
| `ACCESS_TEAM_DOMAIN` | `wrangler.jsonc` の vars | `https://<team>.cloudflareaccess.com` |
| `ACCESS_AUD` | `wrangler.jsonc` の vars | Access の application の audience tag(64 文字の 16 進) |

`ACCESS_TEAM_DOMAIN` と `ACCESS_AUD` は秘密ではない。これらを書き換えても、運営を増やすことはできない。Access の policy を通った本人の token が要るためである。ただし、別の team の値に書き換えると、その team の policy が運営を決めることになる。この 2 つを変える PR は、依頼者が確かめてから merge する。
