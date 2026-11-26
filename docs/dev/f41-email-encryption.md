# メールアドレスの暗号化の実装設計

[メールアドレスを暗号化して持つ](../features/f41-email-encryption.md) を実装するための契約。メールアドレスを持つ列の一覧、暗号文と検索用の値の形、Better Auth との境、列の足し方、書き換えの途中の状態、鍵の状態ごとの動きを扱う。決めた根拠は、第四スコープの指示書の D-80〜D-89 である。

状態: 実装中(第四スコープの作業 C)。鍵を作ること、登録すること、本番の行を書き換えることは、依頼者が行う(手順は [メールアドレスの暗号化の手順](email-encryption-runbook.md))。

## 結論(D-88)

Better Auth の境で、暗号化と復号を `src/db/` の境に収められる(D-82 は成り立つ)。Better Auth は、今までどおりのメールアドレスを読み書きし、D1 には暗号文と検索用の値だけが入る。次の 3 つで確かめた。

- 入れている版(`better-auth` 1.7.18)のソース: `betterAuth({ database })` は、アダプターの関数も受け取る(`dist/db/adapter-base.mjs` の `typeof options.database === "function"`)。アダプターは `create`、`findOne`、`findMany`、`update`、`delete`、`count` など、モデル名(`user`)と項目名(`email`)で呼ばれる。メールアドレスは、`findUserByEmail`(`where` の `email`)、`createUser`(`data.email`)、検索した行の `email`、セッションに結合した `user` の行、の 4 つの道でだけ通る。
- 公式の文書: 検証の識別子の保存は、`verification.storeIdentifier` に自前のハッシュ関数を渡せる。「識別子の全体(用途の接頭辞を含む)をハッシュする」よう勧めている(確かめた日 2026-11-26、[Options](https://www.better-auth.com/docs/reference/options))。アダプターを包む方法は、文書には書かれていない。入れている版のソースと型(`DBAdapterInstance`、`DBAdapter`)で確かめた。Better Auth を上げるときは、`src/db/email-boundary.test.ts` が失敗して知らせる。
- 小さい実装とテスト(`src/db/email-adapter-store.ts`、`src/db/email-boundary.test.ts`): 実物の `createAuth` で、コードを求める、登録する、別の綴りでログインし直す、セッションを読む、を通した。そのあと D1 の全部の表の全部の文字列の列を調べ、メールアドレスが残らないことを確かめた。

## メールアドレスを持つ列の一覧(D-81、F41-AC20)

`migrations/` と `src/` を調べた(2026-11-26)。登録者のメールアドレスを持つ(持ちうる)列は、次のとおり。

| 表.列 | 持つもの | 扱い | 理由と動き |
| --- | --- | --- | --- |
| `auth_user.email` | ログインの識別 | **暗号化する** | 書き換えの後は、`enc1:` と検索用の値(下の「列の足し方」)。暗号文は新しい列 `email_ciphertext` に入る |
| `invited_emails.email` | 招待したメールアドレス(主キー) | **暗号化する** | 同じ。運営の画面の一覧は、復号して表示する(F41-AC5) |
| `auth_verification.identifier` | ログインのコードの行の名前。Better Auth が `sign-in-otp-<メールアドレス>` で作る | **検索用の値だけにする** | 識別子の全体を、検索用の鍵の HMAC にして保存する(`verification.storeIdentifier`)。コードは 10 分で消える行だが、待っている間も平文で残さない |
| `mail_outbox.to_address` | ローカルの送信箱の宛先 | **検索用の値だけにする**(鍵があるとき) | 本番では行が入らない(`MAIL_OUTBOX` を設定しない)。入りうる誤設定でも平文が残らないように、鍵があるときは `enc1:` と検索用の値を宛先に書く。ローカルの確認は、宛先を同じ形に直して引く |
| `mail_outbox.subject`、`body` | ログインのコードの文面 | 持たない(メールアドレスを含まない) | `src/mail/login-code-mail.ts` を読んで確かめた。テストが、文面にメールアドレスが入らないことを見る |
| `login_code_requests.address_hash` | コードの請求の回数を数える記録 | そのまま(すでに検索用の値だけ) | `SHA-256("login-address:" + BETTER_AUTH_SECRET + ":" + メールアドレス)`。メールアドレスは入っていない。秘密を知らなければ、ハッシュからメールアドレスを試せない |
| `auth_user.name` | 利用者の名前 | 持たない | `signInEmailOTP` は `name: ""` で作る(`docs/dev/f28-email-login.md`)。表示名は `profiles.name` で、本人が決める |
| `auth_account` の列 | 外部の認証の写し | 持たない | メールのコードだけでログインする。行を作らない(テストが、登録の後に 0 行であることを見る) |
| `auth_session.ip_address`、`user_agent` | | 持たない | 作るときに空にしている(F28-AC111) |
| `invited_emails.invited_by` | 招待した運営の人のメールアドレス | 対象外 | 運営の人のメールアドレス(D-81) |
| 操作の記録(`takedowns`、`suspensions`、`reports` などの `operator` 系の列) | 運営の人のメールアドレス | 対象外 | 同上 |
| R2 の Gravatar の写し | 利用者の番号で引く | 持たない | メールアドレスも、ハッシュも入っていない |
| Gravatar に送るハッシュ | | **持たない**(D-85、F41-AC17) | `src/profile/gravatar.ts` が表示のときに作る。D1 にも R2 にも保存していない(`profiles` は `use_gravatar` と `gravatar_at` だけ)。テストが、全部の表を調べて確かめる |

メールアドレスで人を引く問い合わせは、次の 7 か所である。

| 場所 | 問い合わせ | 暗号化の後 |
| --- | --- | --- |
| Better Auth(`findUserByEmail`、`createUser`、セッションの結合) | `auth_user` | アダプターの境が読み替える(下) |
| `src/auth/invites-store.ts` の `isInvited`、`addInvite`、`removeInvite`、`listInvites` | `invited_emails` | 保存した形(平文と検索用の値の両方)で引く。一覧は復号する |
| `src/db/invitation-schema.ts` の `invitedUserIds` | `auth_user.email = invited_emails.email` | **変えない。** 2 つの行が同じ状態にあれば、同じ文字列になる(下の「組は 1 つの状態に保つ」) |
| `src/auth/login-routes.ts` の `triesLeft` | `auth_verification.identifier` | 同じ関数で識別子を作る |
| `src/auth/signup-store.ts` の `leaveBeforeSignup` | `auth_verification.identifier` を `auth_user.email` から作る | 利用者の行を読んで復号し、識別子を作って消す |
| `src/profile/store.ts` の `readEmail` | `auth_user.email` | 復号して返す(設定の画面と Gravatar の取り次ぎ) |
| `src/publication/test-support.ts` ほか、テストの種まき | 平文の行を直接入れる | 「鍵を設定する前に登録した人」の再現として、そのまま使う |

メールアドレスをログ、エラー、通知に出しうる場所は、`src/auth/login-routes.ts` の `console.error`(`name` だけ)、Better Auth のログ(`logger`)、`src/mail/mail-client.ts` のエラー(下の「外に出さない」)である。

## 暗号文と検索用の値(D-80)

すべて `src/db/email-cipher.ts`(純粋な関数)にある。

- **正規化**: 前後の空白を取り、小文字にする。`src/mail/address.ts` の `normalizeAddress` と同じ結果にする(Better Auth も、渡されたメールアドレスを小文字にする)。ログインの照合は、変わらない(F28 の決め)。
- **暗号文**: AES-256-GCM。IV は 1 回ごとに 12 バイトの乱数(呼び出し側が引いて渡す。純粋な関数は乱数を使わない)。形は次のとおり。

  ```text
  ec1.<鍵の版>.<IV>.<暗号文>.<認証の値>
  ```

  `ec1` は形の版、鍵の版は 1 以上 9999 以下の整数。IV(12 バイト)、暗号文、認証の値(16 バイト)は、パディングなしの base64url。暗号化するのは正規化したメールアドレス。同じメールアドレスでも、暗号文は毎回違う。
- **検索用の値**: HMAC-SHA-256(鍵は暗号の鍵とは別。`EMAIL_LOOKUP_KEY`)。入力は `address:` と正規化したメールアドレス。出力は小文字の 16 進 64 桁。同じメールアドレスなら、同じ値になる。
- **別の用途の HMAC**: ログインのコードの識別子には、同じ鍵で、`verification:` を付けた入力の HMAC を使う。接頭辞が違うので、メールアドレスの検索用の値とは衝突しない。
- **復号の確かめ**: 復号した結果の検索用の値を作り直して、行の `email`(`enc1:` の後)と比べる。ほかの行の暗号文を持ってきても、ここで断られる(`mismatch`)。
- **エラー**: `EmailCryptoError` は、コード(`not_usable`、`malformed`、`unknown_version`、`auth_failed`、`mismatch`、`inconsistent`、`unsupported_query`)だけを持つ。メールアドレス、暗号文、鍵は、文にもスタックにも入れない(F41-AC15)。

## 鍵(D-83)

3 つの secret。**ローカルと本番は、別の鍵にする。**

| 名前 | 中身 |
| --- | --- |
| `EMAIL_CIPHER_KEYS` | 暗号の鍵を版ごとに。`1:<鍵>,2:<鍵>`。鍵は 32 バイトの乱数の base64url(パディングなし) |
| `EMAIL_CIPHER_CURRENT` | 新しく書く行に使う版。`EMAIL_CIPHER_KEYS` にある版 |
| `EMAIL_LOOKUP_KEY` | 検索用の値の鍵。32 バイト以上の乱数の base64url。暗号の鍵のどれとも違う。**版を持たない。入れ替えない。** |

`src/db/email-cipher.ts` の `parseEmailCrypto` が、3 つを読んで、次のどれかにする。

| 状態 | 条件 | 動き |
| --- | --- | --- |
| `off` | 3 つとも無い(空を含む) | 今までどおり平文で書き、平文を読む(F41-AC13)。運営の画面に「未設定」 |
| `on` | 3 つとも、形が正しい | 暗号化して書く。平文の行も暗号文の行も読む |
| `invalid` | 一部だけ設定、形が違う、現在の版が無い、検索用の鍵が暗号の鍵と同じ | **何も読み書きしない。** `createAuth` が `null` を返し、ログインは 503、セッションは無いものとして扱う。間違いのまま平文で書き始めることを防ぐ(F41-AC14) |

形が正しくても、値が間違っている場合(鍵を取り違えた、検索用の鍵を変えた)は、行を調べるまで分からない。利用者を新しく作る前に、`assertKeysFitData`(`src/db/email-store.ts`)が、暗号文の行を 1 行開いて、検索用の値が一致することを確かめる。

- 検索用の鍵が違う: 開いた結果から作った検索用の値が、行と合わない。断る。確かめないと、登録済みの人が見つからず、**同じ人が 2 人目の利用者になり、2 つ目のアカウントを作れてしまう**。
- 暗号の鍵が違う: 開けない(`auth_failed`)。断る。
- どの暗号文の版の鍵も無い、または鍵が `off` なのに暗号文の行がある: 断る。鍵を失った環境で、平文の行が混ざって増えるのを防ぐ。

暗号文の行が 1 つも無いあいだは、鍵が合うかどうかの根拠が無く、確かめない。最初の登録で、その鍵が「正」になる。検索用の鍵は、後から変えられない(変えると、全員が見つからなくなる)。

## 列の足し方(D-05)

migration は足すだけ。

| 番号 | 内容 |
| --- | --- |
| 0059 | `auth_user.email_ciphertext TEXT`、`invited_emails.email_ciphertext TEXT`(どちらも空を許す)。行の状態を縛る CHECK: 暗号文が空であることと、`email` が `enc1:` で始まらないことが、同じ。 |
| 0060 | まだ書き換えていない行だけを入れる部分索引(`WHERE email_ciphertext IS NULL`)。書き換えの残りの件数を、表の全体を読まずに数える |

- **平文の行**: `email_ciphertext` が空。`email` が、今までどおりのメールアドレス。
- **暗号化した行**: `email_ciphertext` に暗号文。`email` は `enc1:` と検索用の値(例 `enc1:3f9a…`、69 文字、小文字)。メールアドレスには「:」が入れられないので、メールアドレスと取り違えない。
- **一意の制約**: `auth_user.email` の `UNIQUE` と `invited_emails.email` の `PRIMARY KEY`、`CHECK (email = lower(email))`、`length(email) BETWEEN 3 AND 254` は、そのまま残る。暗号化した行の `email` は、検索用の値から作るので、**同じメールアドレスの行は、同じ `email` になる。** 既存の一意の制約が、そのまま「同じメールアドレスで 2 人は登録できない」を保つ(F41-AC3)。新しい索引は要らない。
- **表と列は消さない。** 平文の列の `email` は、そのまま列として残る。

## Better Auth との境(D-82)

`src/db/email-adapter-store.ts` の `emailBoundary` が、`drizzleAdapter` を包む。`src/auth/auth-store.ts`(Better Auth を作る store。もとは `config.ts` にあり、層の決まりのために、定数だけを `config.ts` に残して移した)で、`database` にこれを渡す 1 行が増えるだけで、`src/db/` の外は変わらない。

| Better Auth が出す問い合わせ | 境の動き |
| --- | --- |
| `findOne({ model: 'user', where: [{ field: 'email', value }] })` | `value` を、保存した形の 2 つ(平文と `enc1:` + 検索用の値)にして、`IN` で引く。平文の行も暗号化した行も見つかる。見つけた行は開く |
| `create({ model: 'user', data })` | 作る前に、鍵とデータが合うかを確かめ、平文の招待を暗号化する(下)。`email` を `enc1:` + 検索用の値に、`emailCiphertext` を暗号文にして書く。鍵が `off` なら、平文で書く。返す行は開く |
| `findOne({ model: 'session', join: { user: true } })` など、結合した `user` | 結合した行の `user` を開く |
| `update` で `email` を変える | 同じく 2 つの列に分けて書く(今は使っていない。使うようになっても平文を書かない) |
| `email` で並べる、一部で探す(`contains` など) | 断る(`unsupported_query`)。暗号化した列では、正しく動かないため |
| `verification` の識別子 | 設定 `verification.storeIdentifier.hash` で、全体を HMAC にする。Better Auth の文書にある方法 |

Better Auth が返す利用者には `emailCiphertext` を残さず、メールアドレスは、今までと同じ小文字の綴りである(F41-AC16)。`user.additionalFields.emailCiphertext` を宣言して、アダプターの出入りに暗号文の列を通している。`input: false`、`returned: false` で、Better Auth の入力にも出力にも出ない。

## 書き換えの途中の状態

書き換えの途中、またはキーを設定した後で、平文の行と暗号化した行が混ざる。読む側は、**行を見て見分ける**(`email_ciphertext` の空かどうか)。平文の行は、そのまま読む。暗号化した行は、開いて、検索用の値を確かめる。見分けが合わない行(`enc1:` なのに暗号文が無い、など)は、CHECK で作れない。

### 組は 1 つの状態に保つ

`invitedUserIds` は、`auth_user.email = invited_emails.email` で、招待されている人を決める(アップロード、作者限定の表示、MCP、プレビューのすべてがこの 1 つの条件に従う)。2 つの行が、どちらも暗号化した状態なら `enc1:…` が同じ、どちらも平文なら同じメールアドレスで、一致する。**片方だけ暗号化した状態**だと、一致せず、招待されている人が招待されていない扱いになり、ログインが終わる。そこで、同じメールアドレスの 2 つの行(利用者と招待)は、いつでも同じ状態にする。

| 操作 | 組を保つ方法 |
| --- | --- |
| 初めてのログイン(利用者の行を作る) | 作る前に、平文の招待を暗号化する(`sealInviteFor`)。失敗すると、招待だけが暗号化した状態で残る。利用者の行は無いので、組は壊れない |
| 運営が招待を足す | 同じメールアドレスの平文の利用者がいれば、同じ batch で、利用者も暗号化する。すでに招待がある(どちらの形でも)なら、何も足さない |
| 運営が招待を外す | 2 つの形のどちらも消す |
| 書き換える | メールアドレスごとに 1 つの batch(D1 では 1 つの取引)で、利用者と招待を一緒に暗号化する |
| ログインの前の「招待されているか」 | 2 つの形のどちらでも見つける |

どれにも当てはまらない、鍵を `off` に戻した環境では、暗号化した行が読めないので、利用者を新しく作ることも断る(上の `assertKeysFitData`)。

## 書き換え(D-84、F41-AC8、F41-AC9、F41-AC12)

運営の画面の操作 `POST /operations/email/rewrite`(運営の origin、Cloudflare Access の内側)が、1 回に最大 100 件(設定: `src/db/email-rewrite.ts` の定数)を扱う。

1. 平文の行のメールアドレス(利用者と招待)を、1 回の上限まで集める。
2. メールアドレスごとに 1 つの batch で、利用者の行と招待の行を、`email_ciphertext IS NULL` の条件つきで書き換える。条件があるので、同時に実行しても、二重には書き換えない。
3. 上限が余っていれば、古い版の行(`ec1.<現在の版以外>.`)を、開いて現在の版で封じ直す。更新は、読んだ暗号文と一致するときだけ行う。
4. 1 件が失敗した行は、そのまま残る(平文のまま、または古い版のまま)。ほかの行は進む。次の回に扱われる。
5. 結果は、書き換えた件数、封じ直した件数、失敗した件数、残りの件数(平文、古い版)。

途中で止めても、次の回は残りから続き、何度実行しても、書き換えた行は変わらない。

- **失敗し続ける行**: 書き換える行は、毎回、無作為に引く(`ORDER BY random()`)。書き換えられない行が数件あっても、それらが毎回の枠を占めて、ほかの行が進まなくなることはない(1 回に、上限から、書き換えられない行の数を引いた数以上が進む)。書き換えられない行だけが残ると、残りの件数が減らない。ログ(`email_rewrite` の `failed`)と、手順書の「失敗の見方」で調べる。
- **Workers の 1 回の要求の上限**: 1 回の押下は、メールアドレス 1 件につき D1 の batch を 1 回、そのほかに十数回の問い合わせをする。100 件で、D1 の呼び出しは約 110 回になる。Workers の subrequest の上限は、Free プランで 50、有料プランで 1000 である。**有料プランであることが前提**で、依頼者が本番のプランを確かめる。Free プランなら、`REWRITE_LIMIT` を 40 以下に下げる。
- **例外で止まったとき**: `EmailCryptoError` 以外の例外(D1 の一時的な失敗など)で要求が 500 になっても、書き換えた分は残り、もう一度押すと続きから進む(運営の画面の枠に 1 文で書いてある)。

## 外に出さない(D-86、F41-AC15)

- `EmailCryptoError` は、コードだけを持つ。Better Auth が包んで返すエラーにも、メールアドレスは入らない(メールアドレスを含むエラーを作る道を持たない)。
- 足したコードは、`console.*` を呼ばない。失敗は、コードだけを返し、呼び出した側が、すでにあるログの形(`event` と `name`)で残す。
- 通知(`src/alerts/`)には、件数と運営の画面へのリンクだけを渡す。暗号化の通知は、作らない(D-56 の表に無い)。
- 運営の画面の枠は、メールアドレスも、暗号文も、鍵も出さない。鍵の版の番号と、件数だけを出す。
- テスト `src/db/email-boundary.test.ts` などが、登録の後に D1 の全部の表の全部の文字列の列を調べ、メールアドレスが残らないことを見る。

## 確かめていないこと(人の確認)

- 本番の D1 で、実際の行を書き換えること。
- **書き換える前の backup、D1 の Time Travel、作業 B の R2 への書き出しには、平文のメールアドレスが残る。** 書き換えは、いまの行を暗号化するだけで、すでに取った backup と履歴は変えない。書き換える前の backup の保管先と保持期間(いつ消すか)を、依頼者が決める。D1 の Time Travel は、保持期間のあいだ、書き換え前の状態を戻せるので、そのあいだ履歴に平文が残る。
- 本番のプランが有料であること(上の「Workers の 1 回の要求の上限」)。
- 鍵を作って登録すること。控えの保管。
- Cloudflare の本番の Worker で、Web Crypto の速度が足りること(利用者の行を 1 回読むたびに、AES-GCM の復号と HMAC が 1 回ずつ)。ローカルでは問題なし。

## 招待制をやめるときの注意(作業 R へ)

招待制をやめる作業(R)が、招待、停止名簿、登録の守りを変えるときは、次を守る。

1. **`invitedUserIds` は、利用者と招待が同じ状態のときだけ一致する。** `auth_user.email = invited_emails.email` で決めるので、片方だけ暗号化した状態では、招待されている人が招待されていない扱いになる。R が招待の使い方を変える(開いている間は招待を見ない、など)ときは、この前提を見直す。組を同じ状態に保つ処理(`sealInviteFor`、`addInvite`、書き換えの batch)を通さずに、利用者や招待の行を作らない。
2. **R の停止名簿(HMAC(正規化したメールアドレス))を、`auth_user.email` の列と比べてはいけない。** 平文の行や、鍵が `off` の環境では、列の値が暗号化した形ではなく、すり抜ける。`addressOf` で開いたメールアドレスから、名簿の HMAC を作って比べる。名簿の HMAC には、`address:`(検索用の値)や `verification:`(コードの識別子)と別の接頭辞(`suspension:`)を使い、同じ鍵でも値が衝突しないようにする。
3. **二重登録の防止は、`create` の中の `assertKeysFitData` だけに頼っている。外さない。** 暗号化した行が 0 件のあいだは、鍵が合うかを検査できず、最初の登録で、その鍵が「正」になる。登録を開いて、利用者が急に増える前に、鍵を設定して、1 人目を登録してから開く。
4. **平文の形(`storedForms` の平文の側)は、書き換えが終わるまで残す。** 平文の行は、書き換えが終わるまで、平文のメールアドレスで引かれる。書き換えが終わった後に平文の側を外すかは、別に決める(外すときは、残りが 0 であることを確かめてから)。
