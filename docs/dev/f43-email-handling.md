# メールアドレスに触れる場所を限る実装設計

[メールアドレスに触れる場所を限る](../features/f43-email-handling.md)(第四スコープ。F43-AC1〜F43-AC16)を実装するための契約。メールアドレスを持つ場所、読んでよいファイル、出てよい場所を 1 つのデータに宣言し、テスト、ヘルプの記事、表を除いて書き出す手段が同じ宣言を読む形にした。データベースの中での暗号化は、やめた(仕様の「決めたこと」)。

状態: 実装済み。反映の順番にも、人の確認にも、増えるものは無い(新しい binding も secret も var も足していない)。

## 宣言

`src/privacy/email-exposure.ts` に、データだけを置く。実行時に何も読み込まない(`scripts/*.mjs` が、そのまま読み込める)。層の名前は純粋で、`src/help/` の記事も読んでよい(アーキテクチャの決まりのとおり、HTML の部品の `hono/html` を除いて、何にも触れない)。

| 宣言 | 中身 | 理由 |
| --- | --- | --- |
| `ADDRESS_COLUMNS` | 表と列、種類、理由。種類は `subscriber`(登録者のメールアドレス。drizzle での書き方も持つ)、`operator`(運営の人のメールアドレス)、`keyed-hash`(鍵つきのハッシュ)、`not-an-address`(名前が似ているだけ) | AC1。列の名前に `email`、`mail`、`address`、`_by`(だれがしたか。運営の人のメールアドレスが入る)を含むものは、すべてここに載せる |
| `ADDRESS_READERS` | 読んでよい、または書いてよいファイルと、触れるもの(列の `表.列`、または `.email`)と、理由 1 文 | AC2、AC3、AC5 |
| `ADDRESS_ACCESSORS` | アドレスを返す関数(いまは `readEmail`)。import すると、その関数が読む列に触れたと数える | 別のファイルの関数経由の読み取りも、読み取りと数えるため |
| `IGNORED_RECEIVERS` | `.email` を読んでも登録者のアドレスではない名前(`operator`、`payload`、`z`、`t`)と理由 | 偽陽性を、名前を挙げて外す |
| `ADDRESS_EXPOSURES` | 登録者のアドレスが出てよい場所(6 つ)。経路かツールかメール、理由 1 文、利用者向けの場面の文(日本語と英語) | AC6、AC13 |

宣言に足すことは、禁じない。足すときは、理由を 1 文書く(AC3)。読む場所が増えたことが、宣言の差分に出る。

## 宣言の最初の中身

いまのソースを調べて、実際に触れているものから作った。

- **列(14)。** 登録者のメールアドレス 4: `auth_user.email`、`invited_emails.email`、`mail_outbox.to_address`、`auth_verification.identifier`(Better Auth が、ログインのコードの行を `sign-in-otp-` とメールアドレスで名づける。名前に `email` は無いが、アドレスが入るので載せた)。鍵つきのハッシュ 1: `login_code_requests.address_hash`。運営の人のメールアドレス 6: `invited_emails.invited_by`、`decks.hidden_by`、`suspensions.suspended_by`、`picture_removals.removed_by`、`signup_pause_events.changed_by`、`events.named_by`。名前が似ているだけ 3: `auth_user.email_verified`、`auth_session.ip_address`、`alerts.mailed_at`。
- **読んでよいファイル(18)。** 認証の側 6(`auth-store`、`invites-store`、`login-pages`、`login-routes`、`registered-store`、`signup-store`)、招待の照合の問い合わせ 1(`db/invitation-schema`)、退会 1(`decks/deletion-store`)、書き出し 2(`exports/account-export-store`、`account-info`)、ローカルの送信箱 1(`mail/outbox-store`)、運営の画面 2(`operator/pages`、`routes`)、プロフィールの側 2(`profile/face-routes`、`store`)、設定 3(`site/settings-account-frame`、`settings-pages`、`settings-routes`)。
- **出てよい場所(6)。** 本人の設定(`GET /settings`)、本人の書き出し(画面は `GET /account/export/account.json`、AI エージェントは `export_account`)、ログインの画面(本人が入れた値の表示。`POST /login`)、ログインのメールの宛先、運営の画面の招待の一覧(運営のホストの `GET /`)。

## テストの調べ方

調べる側は `scripts/` に置く(`scripts/layers.mjs` と同じ作り)。判断は、データを受け取って文を返す純粋な関数にし、本物のソースと経路を渡すテストと、作った入力を渡すテストに分けた。

| 何を | どう調べるか | テスト |
| --- | --- | --- |
| ソースが触れるアドレス | `scripts/email-touches.mjs`。`src/**/*.ts(x)`(テストと `test-*.ts` を除く)を TypeScript の parser で読み、次の 4 つを数える。(1) 宣言の drizzle の書き方(`authUser.email`、`invitedEmails.email`、`mailOutbox.to_address`、`authVerification.identifier`)を、import した名前で引いたもの。(2) 文字列とテンプレートの中の、表の名前と列の名前の両方を含む SQL。(3) 任意の値の `.email` の読みと、`{ email }` の取り出し(Better Auth が返す利用者、招待の記録、フォーム)。(4) `ADDRESS_ACCESSORS` の関数の import | `scripts/email-touches.pure.test.mjs` |
| 列の分類(AC1) | `getTableConfig` で、schema の全部の表と列を読み、名前に当たる列がすべて宣言にあるか、宣言の列が実在するか、drizzle の書き方が実際の export と合うかを見る | `scripts/email-exposure.test.mjs`、`scripts/email-exposure-check.pure.test.mjs` |
| 読んでよいファイル(AC2、AC5) | 宣言に無いファイルが触れると失敗する。宣言のファイルが、もう触れていない、触れるものが減った、ファイルが無いときも失敗する(宣言が実態より広がらない) | 同上 |
| 理由(AC3) | 列、ファイル、場所、名前のすべてに、1 文の理由があるか。場所には、日本語と英語の場面の文もあるか | 同上 |
| 失敗の文(AC4) | 触れたファイルと列、宣言のファイルの場所、足す前に確かめること(出てよい場所の外に出さないこと、利用者の番号や鍵つきのハッシュで足りないか)を含む | `scripts/email-exposure-check.pure.test.mjs` |
| GET の経路(AC9) | 本体と運営のホストの Hono の `routes` から GET の経路を取り、`src/site/test-no-email-pages.ts` の確かめる対象の道のどれかに当たるか、宣言の出てよい場所に載っているかを見る。出てよい場所の経路が、確かめる対象にも入っていると失敗する | `scripts/email-exposure.test.mjs` |

失敗の文の例は、PR の本文にある。

実際に動かすテスト(`src/site/no-email-leak.test.ts`、`src/auth/email-traces.test.ts`)は、宣言から回す。

- AC6: 宣言の `ADDRESS_EXPOSURES` の 1 つごとに、動かし方(`PROBES`)があり、本人のアドレスが出ることを確かめる。動かし方の一覧と、宣言の一覧が、同じ id でなければ失敗する。本人にだけ出る場所に、ほかの人のアドレスが出ないことも確かめる。
- AC7: 出てよい場所のほかのすべての画面、応答、ヘッダー、書き出し、AI エージェントの道具の答えに、どの人のアドレスも、その MD5、SHA-256、Gravatar のハッシュも出ない。本人、ほかの人、ログインしていない人の 3 通りで開く。
- AC8: ログイン、断られたログイン、エラー、cron のすべての処理、すべての種類の通知を動かして、ログ、運営への通知、計測の記録を調べる(いままでのテストを残した)。

## 偽陽性と偽陰性

静的な調べ方なので、網の目は粗い。通ることは、守っている証明にならない。

**偽陽性(誤って見つける)。**

- `z.email()`(zod の検証)や `t.email`(画面の「メールアドレス」という見出しの言葉)のような、アドレスの値ではない `.email`。`IGNORED_RECEIVERS` に、名前と理由を書いて外す。`t` を外さないと、画面の見出しの `t.email` が、同じファイルの `account.email` の読み取りを隠してしまう(宣言のファイルから読みをなくす、というミューテーションで見つけた)。
- ソースの中のコメントと、表の名前だけ、列の名前だけを含む文字列は、数えない。

**偽陰性(見つけられない)。**

- `user[key]` のような、計算した名前の読み取り、別名に入れてから渡した値、関数の引数として渡されて別のファイルで使われるアドレス(`login-code-mail.ts` の宛先、`mail-client.ts` の `mail.to` など)。
- 動的な `import()`。ライブラリの中で起きる読み取り(Better Auth が、drizzle のアダプター経由で `auth_user` を読むこと)。
- `select().from(authUser)` で全列を読み、`row.email` を読まずに全体を別の場所へ渡すこと。
- 運営の人のメールアドレスは、`operator` の名前の `.email` として外している。列の分類(`ADDRESS_COLUMNS`)には載せるが、読む場所の検査の対象にしない(仕様の「決めたこと」)。

偽陰性のうち、出る側(ページ、応答、ログ、通知、計測)は、実際に動かすテストが、アドレスの文字列そのものを探して補う。

## ハッシュの決まり(AC10、AC11)

- 鍵なしのハッシュ(MD5、SHA-1、SHA-256)は、D1 にも R2 にも保存しない。Gravatar に送る値は、顔写真を出すたびに作る(`src/profile/gravatar.ts`)。D1 の全部の表と R2 の全部の物を調べる(`src/auth/email-traces.test.ts`)。
- 保存してよい、アドレスから作った値は、ログインのコードの請求を数える `login_code_requests.address_hash` だけである。`src/auth/login-keys.ts`(もとは `login-routes.ts` の `keysOf`)が、`login-address:` と `BETTER_AUTH_SECRET` とアドレスを SHA-256 にかけて作る。同じ鍵と同じアドレスは同じ値、鍵が違えば違う値になる。鍵を知らなければ、アドレスから値は作れない。鍵を替えると、数えていた回数が 1 時間ぶんだけ初めに戻る(害は無い)。

## 本番のデータを写すときの手段(AC14、AC15)

`scripts/db-export-without-email.mjs` が、ローカルの D1 を、宣言の `subscriber` の列を持つ表(`auth_user`、`invited_emails`、`mail_outbox`、`auth_verification`)を除いて、SQL に書き出す。除く表は宣言から決まる。宣言に `subscriber` の列を足すと、その表も除かれる。

- `wrangler d1 export --local --table ...` を使う(`--table` に、除く表以外の全部を渡す)。本番を指す `--remote` は受け付けず、断る(終了コード 2)。通信しない。
- 書き出したあとに、除く表が写しに入っていないかをもう一度見て、入っていたら、写しを消して失敗にする。
- 写しの置き場所は、リポジトリの外か、`.wrangler/` の下だけである(リポジトリに commit しない)。ほかを指定すると断る。
- `--list` は、写しに入れる表を 1 行ずつ出す。本番の写しが要るときに、依頼者が `wrangler d1 export --remote --table ...` に渡すための表である(エージェントは本番に触れない)。手順は [本番に反映する](deploy.md#本番のデータを手元に写すときの決まり) にある。
- 書き出した SQL は、除いた表を参照する外部キーを持つ表(`auth_session`、`accounts`)の行を含む。外部キーを確かめない読み取り(`sqlite3` で眺める、など)に使う。D1 に戻して使うものではない。

## 試験と demo のデータ(AC16)

`scripts/fixture-addresses.mjs` が、テキストの中のメールアドレスを探し、ドメインが予約済み(`example.com`、`example.org`、`example.net` とその下、`.example`、`.test`、`.invalid`)でないものを返す。URL の `user:pass@host` は、アドレスではないので外す。`scripts/fixture-addresses.test.mjs` が、`scripts/load/`、`scripts/demo-*.mjs`、`scripts/**/*.test.*`、`src/**/*.test.*`、`src/**/test-*.ts` を調べる。見つかった 5 か所(`a@x.jp`、`A@B.COM`、`noreply@slide.community`、`foo.bar@example.co.jp`、`contact@slide.community`)は直した。サービス自身の問い合わせ先 `contact@slide.community`(`src/site/legal-pages.ts` の `CONTACT_ADDRESS`)は、製品の定数なので、そのままである。

## ヘルプの記事(AC13)

`safety/data-we-keep` の「メールアドレスを使う場面」は、`ADDRESS_EXPOSURES` の各行の `scene`(日本語と英語)を、その順に並べる。宣言に足すと記事にも出る。記事の本文に場面の文を書き込んでいないことも、テストで確かめる(`src/help/email-scenes.pure.test.ts`)。場面の文は、画面と同じ言葉で引用する。`src/help/screen-words.test.ts` は、記事が引用した画面の言葉が、本当に画面のソースにあるかを見る。宣言の中の場面は、記事の言葉なので、そのテストでは「画面のソース」に数えない(記事自身を数えないのと同じ)。

## 本番の設定(AC12)

`wrangler.jsonc` に `MAIL_OUTBOX` が無いことを、`src/mail/outbox-store.test.ts` が確かめる(`vars` にも、`env` の下にも、コメントにも無い)。権限に関わる値も、binding も変えていない。送信箱の行が 1 日で消えることは、同じファイルのテストにある。

## 作らなかったもの

仕様の「作らないこと」のとおり。加えて、次は確かめていない、または作っていない。

- `auth_session.ip_address`(IP アドレス)と、利用者の名前は、メールアドレスではないので、写しから除かない。
- Gravatar へ送るハッシュ(顔写真を出すたびに作る)は、「出てよい場所」に数えていない。送る相手が外部であることは、「外部への送信」の規約の文面にある。
- 実物の Cloudflare の D1 に対する `--remote` の書き出しは行っていない(本番に触れない)。
