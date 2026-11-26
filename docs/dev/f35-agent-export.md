# AI エージェントからの書き出しの実装設計

[データを書き出す](../features/f35-data-export.md)のうち、AI エージェントから書き出す部分(F35-AC32〜F35-AC42)と、[AI エージェントから置く](../features/f23-agent-upload.md)の F23-AC46〜F23-AC51(作業 G)の設計。画面から書き出す部分と、集め方、zip の作り方は [データの書き出しの実装設計](f35-export.md)(作業 E)にある。ここでは、それを使って MCP の道具を足す。MCP の経路と認可の設計は [AI エージェントから置くための実装設計](f23-agent-upload.md)。

状態は、実装済み(第四スコープ。統合ブランチ `scope4` に積み、本番にはまだ反映しない)。3 本の PR に分けて積んだ。段階は、下の「実装の段階」に書く。実際の AI エージェントでの通しと、本番の Workers Logs は、人の確認が残る。

## 作るもの

| 何を | どこから | 形 |
| --- | --- | --- |
| `export_account` | MCP の道具 | 入力なし。アカウントの情報(`account.json` と同じ値)と、すべてのスライドの短い一覧 |
| `get_slide_files` | MCP の道具 | 入力 `slide`、`cursor`(省略できる)。公開中の版と準備済みの版のファイルごとの、パス、大きさ、SHA-256、取り出すための URL |
| 取り出すための URL | `GET /mcp/files/<値>` | 1 つのファイルの、置いたままのバイト。認可は URL の値だけ |
| 許可の範囲 `slides:export` | OAuth | 接続の許可の画面に 1 行。古い接続は持たない |
| `get_article_draft` の足し | MCP の道具 | 公開中の本文と関連リンクを足す。新しい記事の道具は作らない |

道具は 2 つだけ足す(D-37)。ファイルの中身は、道具の応答に入れない(F35-AC35)。zip を返す道具、他人のスライドを読む道具は作らない(F23-AC51)。

## 許可の範囲と、古い接続(F23-AC46〜F23-AC49)

### 範囲の持ち方

これまでの接続は、範囲を 1 つ(`slides:upload`)だけ持ち、行には何も書いていなかった。足した道具を使えるかどうかは、接続ごとに覚えておく必要がある。時刻で「これより前」と決めると、反映の時刻を持ち込むことになり、更新した接続との区別があいまいになる。そこで、接続の行に範囲を書く。

- 範囲の言葉は 2 つ。`slides:upload`(置く、差し替える、記事を書く)と `slides:export`(読んで取り出す)。純粋な処理は `src/mcp/scope.ts`。保存した文字列は、知っている言葉だけを読む(`parseScopes`)。後の版が書いた知らない言葉は、読んでも何も許さない。
- migration `0070_mcp_scope.sql` で、`mcp_grants` と `mcp_codes` に `scope TEXT NOT NULL DEFAULT 'slides:upload'` を足す。足すだけで、既存の行は書き換えない。いまある行は、すべて足した道具より前に作られたので、「置く」の 1 語になる。表の作り直しも、データを消す文もない(D-05、D-09)。番号は、はじめ 0070 だったが、使われなかった番号を詰め、`main` の 0059 が入ったあとに、統合の作業で 0070 に付け替えた(中身は変えていない。第四スコープの migration はまだ本番に適用されていない)。
- 許可の画面で「許可する」を押すと、画面に並べたすべての範囲を許す(`GRANTED_SCOPES`)。要求の `scope` は、これまでどおり読まない(F23 の設計の「許可の要求の検査」)。画面が言うことと、許した範囲が食い違わないようにするためである。
- 画面の形は、画面に出した範囲を、隠しの欄 `shown_scope` に持たせる。「許可する」の答えが来たとき、その値が、いまの `GRANTED_SCOPES` と違えば(反映をはさんで古い画面が答えた、欄がない古い形)、何も許さず、画面を出し直す(「許可しない」は、そのまま答える)。画面に出していない範囲を許さないため。
- 許可の `code` に、許した範囲を持たせる(`mcp_codes.scope`)。`code` の命は 60 秒だが、反映をはさんで、古い画面で許した `code` が新しい版で交換されることがある。そのとき、画面で見せていない範囲が足されないようにする。
- トークンの交換の応答の `scope` は、その接続の範囲を、空白で区切って返す。更新(refresh)は範囲を広げない。古い接続を更新しても、新しい token は「置く」だけのままである(F23-AC48)。
- 保護された資源の metadata の `scopes_supported`、401 の `WWW-Authenticate` の `scope` には、2 つを並べる。クライアントが、つなぎ直すときに両方を求められるようにする。

### 古い接続が足した道具を呼んだとき(F23-AC47、F23-AC48)

- 道具の一覧は、接続によって変えない(どの接続にも 2 つが見える)。呼んだときに、接続の範囲を見る。
- `slides:export` を持たない接続は、道具の結果として、理由の区分 `reconnect_required` と、エージェントが利用者にそのまま伝えられる文を返す。結果は `isError`。何も読まない。

  > This connection was made before slide.community could export data, so it is not allowed to read your slides out. Nothing was read. Ask the author to disconnect this agent under “Put slides up from an AI agent” in the slide.community settings and connect it again, allowing the new permission on the screen that appears; then call this tool again.

  文は英語で書く(道具の説明と同じ。エージェントが利用者の言葉に直して伝える)。設定の名前は、画面の文言(日本語は「AI エージェントから置く」)と合わせる。
- 前からある道具は、範囲を見ない。これまでどおり使える(F23-AC48)。
- つなぎ直すと、同じ `client_id` のまま、新しい接続(2 語)に置き換わる(`insertGrant` は同じ client と作者の古い行を消す)。作者が先に取り消す必要はない。

### 利用を止められている人(F23-AC49)

すべての道具は、呼ばれるたびに `mayAct`(登録された作者で、停止されていない)を確かめる。2 つの道具も、同じ入口(`guarded`)を通る。停止と範囲のどちらにも当たるときは、停止の答え(`not_allowed`)を先に返す。取り出すための URL の経路も、取り出すたびに同じ確かめをする(下)。

### 許可の画面(F23-AC46、02-PAGES 11)

「できること」を一覧にして、「あなたのスライドを置く、差し替える」と「自分のスライドと記事を読み、取り出す」の 2 行を並べる。その下に「公開はできません。」を残す。日本語と英語の両方を出す。ほかの要素と順番は変えない。

## `export_account`(F35-AC32、F35-AC35)

入力はない。応答は 1 つの JSON(`structuredContent`)。

| 項目 | 内容 |
| --- | --- |
| `account` | [アカウントの情報](f35-export.md#アカウントの情報accountjsond-34)(`account.json`)と同じ値。スライドの一覧(`slides`)も含む。メールアドレスは本人のものを平文で含む(D-34) |
| `slides` | すべてのスライドの短い一覧。1 本につき `slide`(URL の名前)、`title`(題名か `null`)、`state`(`draft`、`public`、`paused`)、`hiddenByOperator`。限定公開、非公開、運営が非表示にしたものを含む |
| `next` | 次にすることを 1 文で。`get_slide_files` と `get_article_draft` をスライドごとに呼ぶ |

- 集め方は E の `readAccountInfo` をそのまま呼ぶ(画面と同じ関数。他人のものが混ざらないことは、そこで守っている)。`slides` は `readAccountInfo` の `slides` から作り、2 度引かない。
- `account` を、そのまま `account.json` として書けば、画面から受け取るものと同じになる。道具の応答の JSON は 2 字下げにしない(`toolResult` の既定は 2 字下げで、E の `jsonText` とは違うので、手元に書くときは `account` を `JSON.stringify` し直す)。
- アカウントがない人(ハンドルを選んでいない)は、`unknown_account` で断る。
- メールアドレスは、画面の書き出しと同じ読み方(`readEmail`、`src/profile/store.ts`)で読み、本人のアドレスが返る。
- プロフィール画像は入れない。道具の範囲外で、画面の「プロフィール画像」から受け取る。バイナリを返す口を足さないため。
- 応答は、ログに出さない(下の「ログに残さないもの」)。

## `get_slide_files`(F35-AC33、F35-AC34、F35-AC40)

入力は `slide`(URL の名前、`list_slides` の `slide`)と、省略できる `cursor`。

```json
{
  "slide": "my-talk",
  "versions": [
    {
      "status": "listed",
      "role": "published",
      "deploymentId": "3f2b9c1e-…",
      "receivedAt": "2026-11-02T00:00:00.000Z",
      "fileCount": 3,
      "totalBytes": 12345,
      "files": [
        {
          "path": "index.html",
          "size": 120,
          "sha256": "…64 桁の小文字の 16 進…",
          "mediaType": "text/html; charset=utf-8",
          "url": "https://slide.community/mcp/files/…"
        }
      ]
    }
  ],
  "urlsExpireAt": "2026-11-26T10:00:00.000Z",
  "nextCursor": null,
  "next": "…"
}
```

- 書き出す版は、E の `exportVersions`(D-31)で決める。公開中の版(`published`)、それより新しい準備済みの版(`prepared`)。残している過去の版は出さない。どちらもなければ、`versions` は空で、書き出すファイルがないことを `next` で伝える。
- 版の並びは `published`、`prepared`。ファイルは、版の中でパスの昇順。
- ファイルの一覧は、E の `readVersionFiles` を呼ぶ。持ち主、スライド、版を 1 つの条件にして引くので、他人のスライドの版は何も返らない。`slide` が無い、他人の、削除待ちのときは、どれも `unknown_slide`(`get_status` などと同じ)。
- 限定公開、非公開、運営が非表示にしたスライドも取り出せる(F35-AC40、D-30)。本人の接続だからである。
- 返すのは、置いたときの 3 つ(パス、大きさ、SHA-256)と、置いたときに受け取ったメディアタイプ。R2 のキー、配信のために足すものは出さない。
- `path` は、そのままエージェントが手元に書く名前になる。保存されたパスはアップロードの検査を通っているが、手元に書くときのために、`next` に「`..` や絶対パスを含むパスは書かない」と添える。E の `zipNameProblem` で調べ、問題があるパスを含む版(または保存されていないファイルを含む版)は、その版だけを、一部のファイルを出さずに外す。応答の `versions` には、その版を `status: "unavailable"`、`reason`(`unsafe_path`、`file_not_stored`)、エージェントが利用者に伝えられる `message` つきで載せ、ファイルも URL も付けない。問題のないもう一方の版は、そのまま返す(版ごとの判定。道具全体は断らない)。

### ファイルが多いとき(F35-AC34)

- 1 回の応答は、ファイルを 100 個までにする(`FILES_PAGE_SIZE`)。1 つの版は多くて 500 ファイル(`MAX_ZIP_FILES`)なので、2 つの版で多くて 10 回。署名と応答の大きさ(1 ファイルあたり 400 バイトほどの URL を含む)を抑えるためである。
- 続きは `cursor` で取る。形は不透明な文字列(base64url の JSON)で、中に `role`、`deploymentId`、その版の中で最後に返したパスを持つ。パスは文字列の順番で比べず、一致で探す(UTF-8 と UTF-16 で並びが違う文字があるため)。並びが「版、パス」なので、続きは「その版のそのパスより後」から数える(位置の番号ではなく、パスで切る。ファイルは版ごとに不変なので、数え直す必要がない)。
- 続きを取るとき、その `role` の版の `deploymentId` が、いまの版と違えば(間に新しい版が置かれた)、`stale_cursor` で断り、最初から取り直すように伝える。`cursor` が読めない、長すぎる(1,500 字まで。512 バイトのパスでも収まる)ときは `invalid_cursor`。
- `nextCursor` が `null` のとき、すべて返した。各版の `fileCount` と `totalBytes` は、ページをまたいでも版全体の値。エージェントは、数が合うかを確かめられる。
- URL は、応答のたびに作り直す。有効なのは、その応答を作ってから 1 時間(`urlsExpireAt`)。続きを取るたびに、そのページの分の URL が新しくなる。

## 取り出すための URL(F35-AC36〜F35-AC39、F35-AC41、D-38)

### 方式の選択(署名と、1 回ごとの値)

| | 署名した URL | 1 回ごとの値を D1 に持つ |
| --- | --- | --- |
| 持つもの | 何も持たない(URL に入れる) | 表(migration)を足し、期限の切れた行を掃除する |
| 推測できない値 | HMAC | 乱数 |
| 取り消し | 接続を取り消した後も、署名は有効。そこで、取り出すときに接続の行を引く | 行を消せば効かなくなる |
| 新しい secret | 要る(下で、使い回せるか見る) | 要らない |
| 取り出す 1 回あたりの D1 | 接続、ファイルの 2 つ | 値、ファイルの 2 つ |

署名した URL を採る。理由は、1 ファイルにつき 1 行を足す(最大 500 行、10 万本なら大きい)表と掃除を作らなくてすむこと。署名だけだと接続を取り消しても URL が生きるが、取り出すたびに接続の行を引くので、取り消し、停止、範囲の欠けが、1 時間を待たずにすぐ効く(下)。

### secret

新しい secret は足さない。既存の `BETTER_AUTH_SECRET`(32 文字以上)から、用途を分けた鍵を作る。

- `authSecret(env)` が使える秘密を返す(32 文字未満、無いときは `null`)。ログインの session と、保存したログインのコードの鍵に使っている。
- そのまま HMAC の鍵に使うと、ほかの用途と鍵が同じになる。HKDF-SHA256(`info` は `slide/mcp-export-file-url/v1`)で、この用途だけの HMAC-SHA256 の鍵を導く。ほかの用途で作った値を、この経路の URL として使えない。この `info` を変えれば、出した URL を一斉に無効にできる。
- `authSecret(env)` が `null` のとき(secret がない環境。D-08)は、`get_slide_files` が理由の区分 `unavailable` と「このサービスでは、いまファイルを取り出す URL を作れません。運営に知らせてください」の文を返す。ほかの道具(`export_account` を含む)は、今までどおり動く。取り出すための経路も、同じときは何も返さない(404)。
- 秘密を変えると、出してある URL はすべて無効になる(1 時間以内に出したものだけが対象で、道具をもう一度呼べば足りる)。ログインの session も切れる(これまでと同じ)。

### 形

`https://<PUBLIC_ORIGIN>/mcp/files/<値>`。値は、`<本体>.<署名>`。

- 本体は、`["v1", <接続の ID>, <版の ID>, <ファイルの ID>, <期限(秒)>]` の JSON を base64url にしたもの。署名は、本体の文字列の HMAC-SHA256 を base64url にしたもの(43 文字)。
- ファイルの ID は `upload_files.id`(版の中で一意)。パスは入れない(URL に載るパスを短く、読めなくするため)。
- 期限は、URL を作った時刻に 1 時間(3,600 秒、`FILE_URL_SECONDS`)を足した値。
- 値の長さは 600 字までとし(実際の値は 230 字ほど)、それを超えるものは署名を見ずに断る。署名と本体は、書き直したときに同じ文字になる(正規の base64url)ものだけを読む。同じバイトに読める別の綴り(最後の文字の余りのビット)も、別の値として断る。値を 1 文字でも変えると開かない、を、文字の位置ごとに確かめるため。

### 取り出すときの検査(順番)

`GET /mcp/files/:値` は、cookie を読まない(MCP の経路と同じ)。`GET` だけ。ほかの方法は 405。

1. 頻度の上限(`/mcp` と同じ `uploads` の組。1 ファイルにつき 1 要求なので、置くときと同じ大きさの枠を使う。管理 origin の枠(1 分に 120)では、数百のファイルを取り出せない)。
2. 値の形を調べる(2 つの部分、base64url、長さ)。合わなければ `404`。
3. 署名を確かめる(`crypto.subtle.verify`。定数時間の比較)。合わなければ `404`。署名が合わない値からは、何も分からせない。値を 1 文字でも書き換えると、ここで止まる(F35-AC39)。
4. 期限を見る。切れていれば `410` と、もう一度 `get_slide_files` を呼ぶように伝える JSON。署名が合った値だけがここに来るので、期限が切れたことを伝えても、何も漏れない(F35-AC37)。
5. 接続の行を引く(接続の ID で、更新の期限が切れていないもの)。ないとき(取り消された、期限切れ、掃除された)は `404`。範囲に `slides:export` がなければ `404`(接続は、つなぎ直しで範囲が変わらない。署名を作った後で、範囲がなくなることはないが、念のため)。
6. 持ち主を確かめる(`mayAct`)。登録の取り消し、停止のときは `404`(F23-AC49)。
7. ファイルを、持ち主、版、ファイルの ID の 1 つの条件で引く(`readVersionFile`)。持ち主は、4 で得た接続の持ち主。別の人の接続の ID で署名した値を作れたとしても、他人のファイルは引けない(F35-AC38)。無い、削除待ち、準備済みでない版は `404`。
8. R2 のキーが、その版の接頭辞(`<版の ID>/`)の下にあるものだけを読む(E の `r2Opener` と同じ考え方)。行が別のキー(他人の版、プロフィール画像)を指していても、読まない。`404`。
9. 応答。本体は R2 の流れをそのまま。置いたままのバイトで、足すものはない(F35-AC36)。

失敗の答えは、`404` と本文のない応答に揃える(`410` を除く)。接続がない、停止、他人のファイル、ファイルがない、を区別させない。

### 応答のヘッダー

E の `downloadHeaders` を使う。`Content-Type` は `application/octet-stream`(置いたときのメディアタイプは `get_slide_files` が伝える。作者が置いた HTML を、サービスの origin で表示させない)、`Content-Disposition: attachment`、`Cache-Control: no-store`、`X-Content-Type-Options: nosniff`、`Content-Security-Policy: default-src 'none'; sandbox`、`Referrer-Policy: no-referrer`。`Vary: Cookie` も付く(cookie は読まないので、あっても害はない)。`Content-Length` は、R2 のオブジェクトの大きさ。

### ログに残さないもの(F35-AC41)

- サービスのコードは、取り出すための URL(値)も、`get_slide_files` の応答も、ログに出さない。応答のログ(`src/alerts/response-log.ts`)は、もともとパスを持たない。
- 経路は、中で起きた例外を自分で受け、`{event: 'export_file_error', name}`(例外の種類だけ)を 1 行ログに出して、本文のない 500 を返す。アプリの共通のエラー処理(`onError`)は、パスをログに出すが、そこへ届く前に止めるため、値は出ない。それでも届いたときのために、`onError` のログのパスは、この経路を `/mcp/files/:value` と書く(`loggedPath`)。
- テストは、取り出すための経路を、成功、期限切れ、書き換え、接続がない、R2 が失敗する、のすべてで動かし、`console` の全部の呼び出しと、応答の本文を集めて、値が一度も含まれないことを確かめる。
- Cloudflare の Workers Logs が、呼び出しの記録(invocation logs)に要求の URL を残すかどうかは、公式の文書(2026-11-26 に確認。[Workers Logs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/))に書いていない。「要求の URL を含む」と読める。この Worker は `observability.enabled` が真なので、取り出すための URL(値)が、Workers Logs に 7 日ほど残る可能性がある。サービスのコードでは防げない。次の備えをする。
  - 値は 1 時間で使えなくなる。接続の取り消しですぐ使えなくなる。署名は 1 ファイル、1 版に限られ、ほかのファイルに使えない。
  - 依頼者が決めること(人の確認に挙げる): `wrangler.jsonc` の `observability.logs.invocation_logs` と `observability.traces` をどうするか。M の 5xx アラートの条件に使うログの項目(`src/alerts/response-log.ts` が出す `http_5xx` などの行。パスを持たない)に影響しないかを確かめた上で決める。この PR は、`wrangler.jsonc` の設定を変えない。

### 残るリスク(コードでは直せないもの)

取り出すための URL の値(`/mcp/files/<値>`)は、サービスの外の記録に、次の形で残りうる。

| 場所 | 残りうるもの | 確かめたこと(2026-11-26) |
| --- | --- | --- |
| Workers Logs の呼び出しの記録(`observability.logs`) | 要求の URL。最長 7 日 | 公式の文書は「要求の URL を含む」と読め、伏せる仕組みを書いていない。`invocation_logs = false` で止められる |
| Workers の traces(`wrangler.jsonc` に `traces: { enabled: true }`) | fetch の span の URL の属性 | 公式の文書([Traces](https://developers.cloudflare.com/workers/observability/traces/))は、fetch の処理の span にどの属性が付くかを、このページに書いていない。別のページ([Spans and attributes](https://developers.cloudflare.com/workers/observability/traces/spans-and-attributes/)。2026-11-26 に読んだ)の一覧に、fetch の属性として `url.full`、`url.path`、`url.query` が載っている。伏せる記載は見つからなかった。実際の値が残るかは、本番で確かめていない。入る前提で扱う。止めるには `traces.enabled` を外すか、`head_sampling_rate` で減らす |
| Cloudflare の zone 側のリクエストの記録(Logpush の `http_requests` など) | `ClientRequestURI`(パスとクエリを含む)、`ClientRequestPath` | 公式の文書([HTTP requests のフィールド](https://developers.cloudflare.com/logs/reference/log-fields/zone/http_requests/))に、2 つのフィールドがある。伏せる設定は書いていない。Logpush を設定していなければ、運営の側では残らない |
| Workers の traces(上と同じ設定)に残る、Discord の webhook の URL | 通知を送る `fetch`(`src/alerts/discord-client.ts`)の span の URL の属性。`https://discord.com/api/webhooks/<数字>/<トークン>` の、パスにトークンが入っている | 取り出すための URL と同じ。fetch の span の属性に `url.full`、`url.path` が載っていると読めるが、伏せる記載は見つからず、実際の値が残るかは、本番で確かめていない。入る前提で扱う。URL を自分のログとエラーに出さないことと、基盤の traces が URL を記録することは、別の話である |
| 依頼者の手元の記録(エージェントの会話の記録、シェルの履歴) | 道具の答えに入った URL | エージェント側のもの。道具の説明で、URL を利用者に見せない、ログに書かないよう伝えている |

どれも、値が 1 時間で切れ、1 つのファイルにしか使えず、接続の取り消しですぐ止まる(上)ことで、残った記録からの被害を小さくしている。決めてほしいのは、`invocation_logs` と `traces`(と、zone の Logpush を使っているなら、その `ClientRequestURI`)をどうするか。**Discord の webhook の URL も同じである。** traces と `invocation_logs` の判断は、取り出すための URL と webhook を合わせて行う。webhook のトークンが記録に残ったら、webhook を作り直す([手順](alerts-runbook.md#discord-webhook-の-url-が記録に残ったとき))。
  - 値をヘッダー(`Authorization`)に移す案は採らない。D-38 と F35-AC39 が URL に値を含むとしていること、URL だけで取れるほうが、エージェントの道具(`curl`、ブラウザの取得)を選ばずに動くため。

### 守りの確認(F35-AC36〜F35-AC39)

| 確かめること | 作り方 |
| --- | --- |
| 置いたままの中身で、SHA-256 が一致する(F35-AC36) | 道具が返した URL を取り、`sha256` と比べる。バイナリ(PNG)も |
| 1 時間を過ぎると使えない(F35-AC37) | 時刻を進めて(期限の値を過去にして)、`410` |
| 別の人のファイルを返さない(F35-AC38) | 別の人の接続の ID と、持ち主の版で署名した値は、`404`。別の人の接続は、持ち主の `get_slide_files` を `unknown_slide` で断られる |
| 値を変えると何も返さない(F35-AC39) | 本体の 1 文字、署名の 1 文字、署名の欠け、本体だけ、を、それぞれ `404`。ファイルの ID を別の人の版のものに書き換えても署名が合わず `404` |
| 接続を取り消すと効かない | `revokeConnection` の後で `404` |
| 利用の停止で効かない(F23-AC49) | 停止の後で `404` |

## 記事(F35-AC42)

`get_article_draft` は、下書きと、公開中の記事の編集中の下書きを `body` で返している。書き出しに足りないのは、次の 2 つ。

- 公開中の本文(`publishedBody`)。公開中の記事に編集中の下書きがあるとき、`body` は下書きで、公開中の本文は返っていない。書き出しは、読者が見ているものも要る。`state` が `published` か `published_with_changes` のとき、公開中の本文を入れる。それ以外は `null`。
- 関連リンク(`relatedLinks`)。種類、URL、題名。ブラウザの「関連リンク」と同じ並び。`add_related_link` が返す形と合わせ、取り除くための `id` も含める。

どちらも項目を足すだけで、いまの項目は変えない。新しい道具は作らない。記事の公開の状態と最後の更新は、すでに `state` と `revision` で伝えている。

## 道具の説明と順番(F23-AC50)

`SERVER_INSTRUCTIONS` と、`export_account`、`get_slide_files` の説明に、全部を書き出すときの順番を書く。

1. `export_account` を呼び、`account` を手元に `account.json` として書く。
2. `slides` のスライドごとに(`list_slides` でも同じ一覧を取れる)、
   1. `get_slide_files` を呼ぶ。`nextCursor` があれば、なくなるまで呼ぶ。
   2. 各ファイルの `url` を取り(認証のヘッダーは要らない)、`<スライドの名前>/<role>/<path>` に書く。取ったバイトの SHA-256 が `sha256` と合うかを確かめる。
   3. `get_article_draft` を呼び、`state` が `none` でなければ `body`(と、あれば `publishedBody`)を `<スライドの名前>/article.md` に、`relatedLinks` を `<スライドの名前>/links.json` に書く。
3. 取り出すための URL は 1 時間で使えなくなる。切れたら、`get_slide_files` をもう一度呼ぶ。

これらは、エージェントが説明だけを読んで通しでできるように書く。道具の説明には、URL を取るときに秘密として扱う(利用者に見せない、記録に残さない)ことも書く。

## 計測の口(8)

道具の呼び出しを、`guarded` の中で 1 行、`recordToolUse` に渡す。渡すのは、道具の名前と、結果の区分(`ok`、または断った理由の区分)だけ。スライドの名前、題名、パス、メールアドレス、利用者の番号は、型の上で渡せない。作業 A の `src/metrics/` はまだ `scope4` にない。`src/mcp/tool-use.ts` の `recordToolUse` は、それまでは何もしない口で、A が中身(Analytics Engine への書き込み)を入れる。取り出すための URL の経路は、何も渡さない(1 ファイルごとの 1 行は、道具の呼び出しの数に足せるものがなく、使われた数は `get_slide_files` の呼び出しで分かる。必要になれば A が決める)。

## 他人のデータが出ない作り

| 守るもの | 守り方 |
| --- | --- |
| 他人のスライド、版、ファイル | 持ち主を、接続の行(接続の ID で引く)から得て、すべての問い合わせの条件に含める。`slide` の名前を、別の人の名前に変えても、`unknown_slide` |
| 他人の R2 のオブジェクト | R2 のキーが、その版の接頭辞の下にあるものだけ読む |
| 他人のアカウントの情報 | `readAccountInfo` は本人の行から引く(E の設計) |
| メールアドレス | `export_account` の `account` だけに、本人のアドレスが平文で入る(D-34)。ほかの道具には出ない。`no-email-leak.test.ts` が、本人のものだけが入ることを確かめる |
| 取り出すための URL の盗み見 | 値は 1 時間。ログに出さない。取り出すたびに、接続と停止を確かめる。ファイル 1 つにしか使えない |
| 作者が置いた HTML をサービスの origin で表示 | `application/octet-stream`、`attachment`、`nosniff`、`sandbox` の CSP |
| 古い接続の使い回し | 範囲を行に持ち、呼ぶたびに見る。つなぎ直しで置き換わる |

## 人の確認として残るもの

- 実際の AI エージェント(Claude Code、Claude のアプリなど)が、道具の説明だけで、通しの書き出しを終えられること。道具の説明を読ませ、`export_account` から順に呼ばせて確かめる(エージェントごとの登録の手順は F23 の未決事項)。
- 本番の Workers Logs、traces、zone 側のリクエストの記録に、取り出すための URL が残るか。残るなら、`invocation_logs` と `traces` をどうするか(M の 5xx アラートの条件に使うログの項目に影響しないかを確かめた上で。上の「残るリスク」)。
- 本番の Worker で、数百ファイルの版を `get_slide_files` で取り出し、取り出すための URL で取れること(subrequest の上限、R2 の応答の遅さ)。
- 古い接続を持つ利用者が、答えの文でつなぎ直せること。

## ヘルプの記事を書く作業(H2)へ

設定の「データを書き出す」の枠(`src/site/settings-export-frame.ts`)の `EXPORT_AGENT_HELP_PATH`(いまは `/help/agent`)を、ヘルプの記事「AI エージェントで書き出す方法」の URL に差し替える。記事に書けること:

| 項目 | 内容 |
| --- | --- |
| 前提 | AI エージェントをつないでいること(設定の「AI エージェントから置く」)。この変更より前につないだ接続は、取り消して、つなぎ直す(許可の画面に「自分のスライドと記事を読み、取り出す」が出る) |
| 頼み方 | 「slide.community のスライドと記事と、アカウントの情報を、すべてこのフォルダに書き出して」のように頼む |
| 使われる道具(名前のとおり) | `export_account`、`list_slides`、`get_slide_files`、`get_article_draft` |
| 手順 | 上の「道具の説明と順番」の 1〜3 |
| 手元に残るもの | `account.json`、スライドごとに `<名前>/published/…`、`<名前>/prepared/…`(あれば)、`<名前>/article.md`、`<名前>/links.json` |
| 取り出すための URL | 1 時間で使えなくなる。切れたら、エージェントが `get_slide_files` をもう一度呼ぶ。利用者に見せる必要はない |
| うまくいかないとき | 「つなぎ直してください」の答えが出たら接続を取り直す。利用を止められている人は、お問い合わせへ(F35 の「作らないこと」) |
| 画面から書き出す方法 | zip で受け取る(1 本の管理の「ダウンロード」、設定の「データを書き出す」)。エージェントの書き出しは、置いたままのファイルを 1 つずつ書く形で、zip にはならない |

画面の文言を引くときは、かぎ括弧で囲み、画面と同じ言葉にする(05-UI-RULES.md)。道具の名前と説明は、`src/mcp/tools.ts` の `TOOL_DESCRIPTIONS` が正しい。

## 実装の段階

作業 G は、受け入れ条件ごとに 3 本に分けて積む。

| PR | 中身 | 受け入れ条件 |
| --- | --- | --- |
| 1 | この設計、許可の範囲、migration、許可の画面の 1 行 | F23-AC46 |
| 2 | `export_account`、記事の足し、古い接続と停止の答え、計測の口 | F35-AC32、F35-AC35(`export_account` の分)、F35-AC42、F23-AC47〜F23-AC49、F23-AC51 |
| 3 | `get_slide_files`、取り出すための URL、道具の説明の順番 | F35-AC33〜F35-AC41、F35-AC35(`get_slide_files` の分)、F23-AC50 |

## 読んだ文書

- Cloudflare の Workers Logs(2026-11-26 に確認): <https://developers.cloudflare.com/workers/observability/logs/workers-logs/>。呼び出しの記録は要求の URL を含むと読める。`observability.logs.invocation_logs` で止められる。要求のヘッダーを記録するかは、書いていない。
- Cloudflare の Tail Workers(2026-11-26 に確認): <https://developers.cloudflare.com/workers/observability/logs/tail-workers/>。`event.request.url` を含む。ヘッダーを伏せるかは、書いていない。
