# メールのコードでログインする実装設計

[メールのコードでログインする](../features/f28-email-login.md) のうち、ログイン、利用者の識別子の切り替え、招待の一覧、メールの送り方、守り(F28-AC1〜F28-AC34)を実装するための契約。プロフィールを書く部分とプロフィール画像(F28-AC35〜F28-AC54)は、別の作業で作る。

状態: 実装した(2026-11-22、第二スコープの作業 A1)。本番のメール送信、Turnstile、DNS は、ローカルでは確かめられないので、依頼者の確認が残る(「本番に反映する」)。

## Better Auth の emailOTP を使えるか

使える。使わない部分は、サービスが持つ。

調べたもの: 現行のドキュメント([Email OTP](https://better-auth.com/docs/plugins/email-otp))と、入れている版(`better-auth` 1.7.18)の `plugins/email-otp` のソース。

| 決めたこと(D-20〜D-22) | emailOTP の設定・動作 | 足りるか |
| --- | --- | --- |
| 6 桁 | `otpLength: 6` | 足りる |
| 有効期限は 10 分 | `expiresIn: 600` | 足りる。期限が過ぎたコードは、使うときに消す |
| 入力は 5 回まで | `allowedAttempts: 5`。間違えるたびに、保存した値の末尾の回数を 1 つ上げる。5 回間違えたコードは、次の入力で消え、正しい値でも通らない | 足りる |
| 一度使ったコードは、もう使えない | 検証は、保存した値を取り出すと同時に消す(`consumeVerificationValue`)。二つの要求が同時に同じコードを入れても、通るのは一つ | 足りる |
| コードの保存 | `storeOTP` に `encrypt`・`decrypt` を渡せる。サービスの `BETTER_AUTH_SECRET` から作った鍵で AES-GCM に封じる(`src/auth/code-cipher.ts`)。表だけが漏れても、6 桁のコードは取れない。読み戻せるので、`resendStrategy: 'reuse'` が使える(下の「再請求」) | 足りる |
| 比べ方 | 保存した値との比較は `constantTimeEqual`(時間で中身が分からない) | 足りる |
| 招待されたメールアドレスだけに送る | 組み込みの `disableSignUp` は、すでに利用者がいる場合のためのもので、初めての人を招くには使えない | **足りない。** サービスが、送る前に招待の一覧を見る |
| 送信の回数の上限(メールアドレス・接続元) | 組み込みの回数の制限は、Better Auth の HTTP の入口(handler)でだけ動く。サービスは handler を公開せず、`auth.api` を直接呼ぶので効かない | **足りない。** サービスが数える |
| ボットを防ぐ確認 | `captcha` の plugin はあるが、handler を通る要求にだけ効く | **足りない。** サービスが Turnstile を確かめる |

使い方は次のとおり(`src/auth/config.ts`、`src/auth/login-routes.ts`)。

- コードを作る・送る: `auth.api.sendVerificationOTP({ type: 'sign-in' })`。コードを作って保存したあと、`sendVerificationOTP` の関数(サービスが渡す)を呼ぶ。この関数が、招待の一覧を見て、招待されていれば送信の口にメールを渡す。
- コードを確かめる: まず `auth.api.checkVerificationOTP`(コードの検査だけ。利用者がいないと、コードが正しくても `USER_NOT_FOUND` を返すので、それは「正しい」と読む)。そのあとで招待を確かめ、招待されていれば `auth.api.signInEmailOTP` を呼ぶ。この順にして、招待されていない人・外された人が正しいコードを当てても、`auth_user` と `auth_session` の行を作らない。成功すると、利用者(なければ作る)の session を作る。cookie は、これまでと同じ `__Host-slide_owner`(12 時間)。
- Better Auth の handler は、サービスに載せない。`/auth/email-otp/...` などの経路は、どれも 404 になる(テストで確かめる)。サービスが持つ経路は、`/login`、`/login/code`、`/welcome` と、`/auth/logout`、`/auth/owner`、古い GitHub の経路の移し先だけ。
- 利用者の `name` は空で作られる。表示名は、`/welcome` で決めて `profiles.name` に置く。

## 利用者の識別子(D-04)

利用者の識別子を、GitHub の利用者番号から、Better Auth が作る利用者の id(`auth_user.id`)に切り替えた。

- 識別子を持つ表の列は、もともと文字列(`TEXT`)で、`decks.owner_user_id`、`accounts.user_id`、`follows`、`mutes`、`notifications`、`notification_opt_outs`、`reports.reporter_user_id`、`suspensions.user_id`、`preview_launches`、`content_sessions`、MCP の表がある。型は変わらないので、列を作り直さない。値の意味だけが変わる。
- 既存の行を新しい id に移す処理は書かない(D-07)。本番は、反映の前に D1 と R2 を空にする(依頼者が行う)。
- session の持ち主(`Owner.userId`)は、`auth_user.id`。`Owner.login` は、これまで GitHub のログイン名だった。いまは handle(共有 URL の名前)が入る。名前は変えていない(影響する範囲が広いため)。
- ハンドルは `accounts` に置く。ログインのたびに自動で作っていたのをやめて、`/welcome` で本人が決める。
- GitHub の値を持っていた表と列は、migration で取り除いた。

| migration | 内容 |
| --- | --- |
| `0036_email_login.sql` | `invited_emails`(招待の一覧)、`mail_outbox`(ローカルの送信箱)、`login_code_requests`(送信の回数を数える記録)を足す |
| `0037_profiles_without_github.sql` | `profiles` を作り直す。GitHub の写し(`login`、`avatar_url`、`has_sponsors`、`synced_at`)をやめ、表示名、自己紹介、場所、Web サイトだけにする |
| `0038_remove_github_leftovers.sql` | 読み手のなかった `owner_sessions`(GitHub の利用者番号とログイン名を持つ)を消す。お知らせの種類から `github_followee_joined` をなくして `notifications` を作り直し、その種類の設定(`notification_opt_outs`)を消す |

0039 は使わない(Z で番号を詰める)。データを消す migration は、0037(`profiles`)と 0038(`owner_sessions`、`notifications`、`notification_opt_outs`)である。

## 招待の一覧(D-02)

`invited_emails(email, invited_at, invited_by)`。`email` は正規化した綴り(下)で、主キー。

- 運営の画面(`src/operator/`、Cloudflare Access の内側)の「招待するメールアドレス」で、足す・外す・一覧する。外すときのメールアドレスは、path ではなく本文で送る(ログに残らないように)。
- 招待の判定は、2 か所で使う。
  1. コードを送る前(`isInvited`)。
  2. 作者としての操作のたび。session の持ち主の `auth_user.email` が、いまの一覧にいるかを、SQL の条件で確かめる(`invitedUserIds`)。ログイン、アップロード、作者限定の表示、MCP のすべてが、この一つの条件に従う。
- 外された人は、次の操作で session が消える(`owner-session.ts`。消したあと、その request の間は「招待から外された人」として扱い、アップロードの経路が「いまは招待制」と伝えられるようにする)。公開済みのスライドは残る(F22-AC41)。
- `AUTHOR_GITHUB_IDS` を読む処理は、すべて取り除いた。`wrangler.jsonc` の値は、権限の値なので触れていない。使われなくなった値として、最後の報告に挙げる。

### メールアドレスの正規化

前後の空白を取り、小文字にする(`src/mail/address.ts`)。`+` つきのアドレスは、元のアドレスと同じ人としては扱わない。運営は、人が入力するとおりのアドレスを招待する。同じ人が `+` のあるアドレスで入ると、招待されていない人として扱われる。表の主キーは、この綴りに `CHECK (email = lower(email))` で縛る。

### 退会したあとの招待

退会は、招待の一覧に触れない。退会した人は、同じメールアドレスで、もう一度ログインして、新しいハンドルで始められる。一覧から外すかどうかは、仕様の未決事項で、決まっていない(最後の報告に挙げる)。

停止中の人の退会では、`auth_user` の行(メールアドレスと id)を残す。同じメールアドレスで入り直したときに、同じ id になり、停止が続く(F17-AC30)ためである。停止の対象を何の値で持つかは仕様の未決事項で、これは決まるまでの暫定の実装である。

## 送信の口とローカルの送信箱(D-03)

`Mailer = (mail) => Promise<void>`。メールは、プレーンテキストで、本文にコードとサービス名だけを入れる。HTML、リンク、画像、追跡はない(F28-AC2。`src/mail/login-code-mail.ts`)。

選ぶ実装は、環境の値で決まる(`mailerOf`)。

| 値 | 送り方 |
| --- | --- |
| `MAIL_API_TOKEN`、`MAIL_ACCOUNT_ID`、`MAIL_FROM` がそろっている | Cloudflare Email Service の REST API(`POST /accounts/{id}/email/sending/send`)で送る(`src/mail/mail-client.ts`)。差出人の表示名は `slide.community`(`src/mail/mail.ts` の `SENDER_NAME`。F28-AC92) |
| `MAIL_OUTBOX` が `on` | 送らずに、`mail_outbox` に書く(ローカルとテスト)。24 時間たった行は、書くときに消す |
| どちらでもない | 送れない。コードを求める要求に、すべての宛先で同じように 503 を返す |

`mail_outbox` には、コードがそのまま入る。本番で `MAIL_OUTBOX` を `on` にしてはいけない(本番の値は設定しない)。

送信が失敗しても、画面は同じ「コードを送りました」で、ログには失敗の種類(`login_code_unsent`)だけを書く。宛先は書かない(D-27)。

### 本番の送信サービスの候補

調べた日: 2026-11-22。料金と上限は変わるので、決めるときに公式のページで確かめ直す。

| 候補 | Workers からの送り方 | 料金・上限 | 向き・向かないところ |
| --- | --- | --- | --- |
| Cloudflare Email Service([料金](https://developers.cloudflare.com/email-service/platform/pricing/)、[上限](https://developers.cloudflare.com/email-service/platform/limits/)) | `send_email` binding、または REST API。このサービスは REST API を使う(binding は `wrangler.jsonc` の変更が要るため) | Workers Paid が要る。月 3,000 通まで含み、超えると 1,000 通あたり 0.35 ドル。新しいアカウントは、1 日の送信数が控えめに始まり、評判に応じて増える | すでに Cloudflare を使っていて、SPF・DKIM をダッシュボードで設定できる。1 日の上限の引き上げを頼める。招待制の少人数なら、含まれる通数で足りる |
| Resend | REST API(`fetch`) | 無料のプランがある(月の通数と 1 日の上限は、公式のページで確かめる)。有料のプランがある | 送信の画面が見やすい。外部のサービスなので、API key と DNS の設定が別に要る。通数の上限が小さい無料のプランでは、登録が増えると足りなくなる |
| Amazon SES | REST API(要求に SigV4 の署名が要る。Workers では自分で署名するか、署名のライブラリを足す) | 通数あたりの料金が安い。新しいアカウントは sandbox で、本番に出す申請が要る | 通数が増えたときに安い。署名を足す実装と、申請の手間がかかる |

このサービスが先に実装したのは、Cloudflare Email Service である。理由: 追加の契約が要らず、Workers の中から呼べ、少人数の招待制では通数の中に収まるため。サービスを変えるときは、`Mailer` の実装を一つ足せばよい(`src/mail/mail-client.ts`)。

## 守り(D-22、D-23)

### 再請求で本人のコードを無効にさせない

`resendStrategy: 'reuse'` を使う。有効なコードがあるあいだの再請求は、コードを作り直さず、同じコードを再送する(期限は延びるが、入力の回数は引き継ぐ)。他人のアドレスを入れて請求しても、その人のコードは無効にならない。入力が 5 回に達したコードだけが、作り直される。

残る弱さと、決めたこと:

- 他人のアドレスで請求を繰り返すと、そのアドレスの送信の上限(1 時間 5 通)を使い切り、本人が新しく請求できなくなる(最長 1 時間)。すでに持っているコードは、使い続けられる。請求者の側は、接続元ごとの上限(1 時間 20 通)で抑える。アドレスの上限は、招待された人の数が少ない間は、このままにする。上限を増やすかは、運用で見て決める(`LOGIN_CODE_LIMITS`)。
- 他人のアドレスに、間違ったコードを入れ続けると、そのアドレスの 1 つのコードの入力回数(5 回)を使い切らせられる。コードが無効になるが、本人は請求し直せる(作り直される)。アドレスごとの入力の回数の上限(下)が、これを 1 時間に 10 回までに抑える。

### 送信の回数の上限(F28-AC13〜F28-AC15)

| 範囲 | 既定 | 数える対象 |
| --- | --- | --- |
| メールアドレスごと | 1 時間に 5 通 | 正規化したメールアドレスの HMAC |
| 接続元ごと | 1 時間に 20 通 | `CF-Connecting-IP`(IPv6 は /64 を 1 つ) の HMAC |

- 数えるのは、招待の有無にかかわらずすべての要求(F28-AC9 のため)。`login_code_requests` に、ハッシュと時刻だけを残す。メールアドレスも IP アドレスも、そのままは残さない。古い行と、期限が切れた `auth_verification` の行は、書くときに同じ batch で消す。
- 数えることと記録することは、1 つの条件つき `INSERT ... SELECT ... WHERE (件数) < 上限` で行う(`tryRecordRequest`)。同時に来た要求が、1 つしか入らない枠に全部通ることはない。通らなかったときだけ、解ける時刻を読む。
- コードの入力は、アドレスごとに 1 時間に 10 回まで(`attemptsPerAddress`。正しくても数える)。超えたら、正しいコードでも通さない。接続元では数えない(ここで制限すると、同じ接続元の別の人まで止まるため)。
- 値は、環境の値 `LOGIN_CODE_LIMITS`(`{"perAddress":5,"perSource":20,"windowSeconds":3600}`)で変える。誤った値は、既定に戻す(広げない)。
- 上限を超えた要求は 429 と `Retry-After` を返し、画面に「いつ以降にもう一度」を出す。時刻は、上限の数だけ新しい要求を数えて、その中でいちばん古いものが窓から出る時刻。
- ローカルの接続元(`CF-Connecting-IP` がない)は、1 つの接続元として数える。

### Turnstile(F28-AC16)

`TURNSTILE_SITE_KEY`(公開の値)と `TURNSTILE_SECRET`(secret)が両方あるとき、`/login` に widget を出し、送信の前に Cloudflare の `siteverify` で確かめる。token が空、確認に失敗、Cloudflare が答えない、のどれでも、コードは送らない。secret も site key もなく、実際のメール送信も使わないときだけ、確認は通る(ローカル)。**実際のメール送信を使うのに `TURNSTILE_SECRET` か `TURNSTILE_SITE_KEY` がない、あるいはどちらか一方しかない構成は、誤りとして、コードを求める要求に 503 を返す**(確認を黙って外さない)。

コードの画面の「コードを送り直す」にも、同じ widget を付ける。widget を使うときだけ、`/login` と `/welcome` の CSP が、`script-src`・`connect-src`・`frame-src` に `https://challenges.cloudflare.com` を許す。ほかの画面の CSP は変えない。

### 招待の有無を知られない(F28-AC7〜F28-AC9)

- 応答は、招待の有無にかかわらず、同じ画面(「コードを送りました」)、同じ状態にする。違うのは、メールを送るかどうかだけ。
- コードを作る処理(保存と、そのための書き込み)は、招待されていないアドレスにも同じように行う。送る処理(送信の口に渡す)は、`waitUntil` で応答のあとに回す(Workers では)。応答までの間に、招待の有無で違う仕事がない。
- 招待されていないアドレスの検証も、同じ経路を通す。コードが保存されているので、回数の数え方も、「残り」の出方も、同じになる。招待の有無によって、「残り 3 回」が出たり出なかったりすることはない。
- コードの検査のあと、session を作る前に、招待の一覧を確かめる(コードが送られたあとで外された人を通さないため。このとき `auth_user`・`auth_session` の行は作らない)。
- 応答までの時間は、ローカルでは測っていない(テストは、同じ書き込みが起きることを確かめる)。本番での時間の差は、人の確認として残る。

### コードの入力の画面

間違えたときは、入力欄の下に、残りの回数を出す(「コードが違います。もう一度入力してください。残り 3 回です。」)。残りがない、期限が過ぎた、コードを求めていない、のどれも「このコードは使えなくなりました。コードを送り直してください。」と出し、理由は言い分けない。

## ハンドルの決まりと予約語(D-26)

`src/auth/handle-rules.ts` の `checkHandle` が、ハンドルを検証する。

- 英小文字、数字、`-` だけで、1〜39 文字、`-` で始まらない(いまの `accounts` の制約を保つ)。大文字は、直さずに断る(理由を出す)。
- 予約語(選べない語)。すべて小文字:
  - 経路の先頭の語: `account`、`api`、`auth`、`blocks`、`communities`、`contact`、`covers`、`embed`、`events`、`follows`、`help`、`login`、`mcp`、`mutes`、`notifications`、`oauth`、`oembed`、`operator`、`privacy`、`reports`、`settings`、`slides`、`start`、`terms`、`uploads`、`welcome`。`_preview` は、`_` を含み、そもそも通らない。
  - `/@handle/` のあとに来る語: `cited`、`citing`、`followers`、`following`(第二スコープの引用の経路のため)。
  - 紛らわしい語: `admin`、`administrator`、`abuse`、`official`、`root`、`security`、`slide`、`staff`、`support`、`me`、`system`。
  - コミュニティのページの語: `edit`(`/@ハンドル/edit`。第三スコープ。[人とコミュニティが分け合うハンドルの実装設計](f30-handles.md#予約語))。
- 予約語は 4 つの一覧に分けてある(`ROUTE_HANDLES`、`AFTER_HANDLE_WORDS`、`COMMUNITY_PAGE_WORDS`、紛らわしい語)。`handle-rules.test.ts` が、アプリの経路の一覧(`app.routes`)の先頭の語と `ROUTE_HANDLES` が一致することを確かめる。経路を足して予約語を足し忘れても、経路のない語が残っても、このテストが落ちる(第三スコープの後の作業が経路を足す `events`・`communities`・`blocks` と、別の host の `operator` だけが例外で、テストに書いてある)。`AFTER_HANDLE_WORDS` は共有 URL の一覧の語(`src/share/path.ts` の `PEOPLE_LISTS`、`CITATION_LISTS`)と一致することも確かめる。
- ハンドルは、一度決めたら変えられない。`/welcome` は、ハンドルを持つ人には、何も書かずに戻り先へ送る。ハンドルを変える経路は、作っていない。
- ハンドルが取られているときは、送信のあとに「すでに使われています」を出す。入力欄の `pattern` 属性で、使えない文字は、ブラウザが送信の前に止める。入力のあいだの確認(スクリプト)は、まだ作っていない。

## `/welcome` までの流れ(D-25)

1. `/login` でメールアドレスを入れる。`/login/code` でコードを入れる。session ができる。
2. ハンドルがない人は、`/welcome` に送られる。画面には、ハンドル、表示名、利用規約とプライバシーポリシーへの同意のチェック欄(F28-AC59。`public/welcome.js` が、チェックがないあいだ「はじめる」を disabled にする。script がなくても、サーバーが同意のない送信を 400 で断る)と、「登録せずに終了する」がある。`GET` の画面は、ハンドルがない人の session があるときだけ出る。ハンドルのある人は、戻り先へ、招待から外された人と未ログインの人は `/login` へ送る。
3. ハンドルがない人が、ほかの画面(`GET`/`HEAD`)を開くと、`/welcome` へ送る(`welcome-middleware.ts`)。session の cookie のある request だけが、確かめる。`/login`、`/welcome`、`/auth/`、`/api/`、`/oauth/`、`/mcp`、`/covers/` は通す。ログアウトはできる。
4. ハンドルのない人は、作者としては扱われない(`currentOwner` は null)。API は 401 になる。
5. 同意して「はじめる」を押すと、`createAccount` が `accounts` の行(ハンドル、同意した日時 `terms_accepted_at`。作成の時刻と同じ値)と `profiles` の行を 1 つの batch で作る。どちらも `auth_user` の行があるときだけ入る(`INSERT ... SELECT ... WHERE EXISTS`)ので、終了や掃除との競合で、ユーザーのいないアカウントはできない(F28-AC75)。同意した日時の置き場は `accounts` にした。アカウントと同意が同じ行で、アカウントがなければ同意もない、と一つの事実になり、別の表にすると片方だけが残る状態を許してしまうため。migration は 0044(`ALTER TABLE accounts ADD COLUMN terms_accepted_at INTEGER`。既存の行は NULL)。規約の版は残さない。

### 登録せずに終了する(F28-AC76、F28-AC63〜F28-AC66)

`POST /welcome/leave`(csrf)。押した人の session の利用者がアカウントを持たないときだけ、1 つの batch で、`auth_verification`(identifier が `sign-in-otp-<アドレス>` の行)、`auth_session`、`auth_user` を消し(`leaveBeforeSignup`。どの文にも「アカウントの行がない」条件が付く)、cookie を消してトップへ 303 で送る。運営の招待(`invited_emails`)と、ハッシュだけの `login_code_requests` は消さない。停止中の人は、`auth_user` の行を残す(F17-AC30 の暫定を壊さない)。

### 掃除(F28-AC67〜F28-AC69)

既存の `scheduled`(毎時)が `sweepSignups` を呼ぶ。期限切れの `auth_verification` を消し、アカウントがなく、最後のサインインから 24 時間以上たった `auth_user` を、同じ `leaveBeforeSignup` で消す(1 回に 100 人まで。残りは次の回)。最後のサインインは、`auth_user` の作成・更新と、その人の `auth_session` の作成・更新のうち、いちばん新しい時刻にした。作成からの時間だと、サインインし直して `/welcome` に入力している人が、入力の途中で消えるため。有効な session を持つ人を除く案は、session が 12 時間で切れたあとの扱いが別に要るので採らなかった。何を消すかの判断(`staleSignups`、24 時間ちょうどを含む、アカウントのある人と停止中の人は除く)は純粋な関数(`signup-sweep.ts`)で、読み書きは `signup-store.ts` にある。新しい trigger は足していない。

### 同意の前に Gravatar へ問い合わせない(F28-AC70)

`/avatars/:userId` は、`accounts` の行がない人には、Gravatar にも R2 にも触れず 404 を返す(もともとの順序。テストで見張る)。「Gravatar の画像を使う」の既定は入のまま。同意の前の人のアドレスのハッシュが Gravatar に届くことはない。

戻り先は、`/login` と `/welcome` に `to` と `drop` の query(フォームでは隠しの欄)で運ぶ。受け付ける値は、これまでと同じ `landingOf` が決める(`top`、`agent`、`settings`、共有 URL の path だけ。ほかは `/slides`)。ほかの origin の URL も、`//host` も、`/slides` に戻る(F28-AC6)。

## 入口の切り替え

| 入口 | 行き先 |
| --- | --- |
| ヘッダーの「ログイン」(`public/share.js`) | `/login`。いまの画面がトップなら `?to=top`、設定なら `?to=settings`、共有 URL なら `?to=<path>`。それ以外の画面は戻り先を付けない |
| トップの「ログインして続ける」 | `/login?to=top&drop=<token>`(`src/drops/stash.ts`) |
| フォロー・ミュート・通報を促すモーダル | `/login?to=<共有 URL の path>`(`src/site/login-prompt.ts` ほか) |
| MCP の許可(`/oauth/authorize`) | `/login?to=agent`。戻ると、許可の画面が出る(D-29) |
| `/auth/github`、`/auth/github/callback`、`/auth/invitation-only`、`/auth/handle-taken` | `404`(経路を取り除いた。互換のための転送は残さない。F28-AC91) |

## GitHub の取り除き

取り除いたもの: GitHub のログイン(`/auth/github`、callback、client)、GitHub からのプロフィールの同期と、Sponsors の確認、GitHub でフォローしている人が参加したお知らせ(種類、設定の項目、文言、`notifyJoined`)、GitHub のプロフィール画像と、CSP の `https://avatars.githubusercontent.com`(`img-src` は `'self'` になった)、設定の「GitHub から同期し直す」、`AUTHOR_GITHUB_IDS` を読む処理。

残したもの: フッターの GitHub のリポジトリへのリンク(ログインとは関係がない)。

プロフィール画像は、プロフィールの作業(F28-AC41〜F28-AC52)が、サービスから配る形で作る。それまで、ヘッダー・プロフィール・viewer の作者は、頭文字で出る(画像の差し込み口は残してあり、値は null)。

## ローカルでの確かめ方

- ローカルでは、`.dev.vars` に `MAIL_OUTBOX=on` を書く。コードを求めると、`mail_outbox` に行が入る。
- コードは、`wrangler d1 execute slide --local --command "SELECT subject FROM mail_outbox WHERE to_address = '<address>' ORDER BY rowid DESC LIMIT 1"` で読める(件名にコードが入る)。
- 招待は、運営の画面の代わりに、`INSERT INTO invited_emails (email, invited_at, invited_by) VALUES ('<address>', unixepoch(), 'local')` で足せる。
- 手で動かす script(`scripts/demo-citations.mjs`、`scripts/verify-upload.mjs`)は、ログインの画面を通さず、local の D1 に利用者・招待・session の行を作る(`scripts/owner-cookie.mjs`)。

## 本番に反映する前に、依頼者が行うこと

次は、ローカルでは確かめられない。最後の報告の「人の確認」にも挙げる。

1. 送信サービスの登録(Cloudflare Email Service のときは、Workers Paid、送信するドメインの登録)。SPF、DKIM、DMARC の DNS。
2. secret と値の設定(実際のメール送信を使うときは、`TURNSTILE_SITE_KEY` と `TURNSTILE_SECRET` も両方要る): `MAIL_API_TOKEN`(secret。Email Sending の権限のある API token)、`MAIL_ACCOUNT_ID`、`MAIL_FROM`、`TURNSTILE_SITE_KEY`、`TURNSTILE_SECRET`。`MAIL_OUTBOX` は設定しない。
3. Turnstile の widget の作成(ホスト名は本番のもの)。
4. 反映の順番: いまの GitHub でのログインで退会する → 本番の D1 と R2 を空にする → 反映 → 招待の一覧に自分のアドレスを入れて、新しい方法で登録し直す。

## 検証

| 受け入れ条件 | テスト |
| --- | --- |
| F28-AC1〜F28-AC17、F28-AC20、F28-AC102、F28-AC22、F28-AC23、F28-AC26〜F28-AC31、F28-AC33 | `src/auth/login-routes.test.ts` |
| F28-AC10〜F28-AC15 の純粋な部分 | `src/auth/login-policy.pure.test.ts` |
| F28-AC4(表示名の検証) | `src/auth/display-name.pure.test.ts`(空、全角の空白だけ、50 文字、絵文字) |
| F28-AC18、F28-AC19 | `src/auth/handle-rules.pure.test.ts`、`login-routes.test.ts` |
| F28-AC2 | `src/mail/login-code-mail.pure.test.ts` |
| F28-AC24、F28-AC25、F28-AC26 | `src/operator/invites.test.ts`、`src/auth/invited-authors.test.ts` |
| F28-AC28、F28-AC32 | `src/db/email-login-migration.test.ts` |
| F28-AC54(メールアドレスと hash が設定のほかに出ない) | `src/site/no-email-leak.test.ts` |
| F28-AC19(予約語と経路の一致) | `src/auth/handle-rules.test.ts` |
| 空の D1 に最初から最後まで適用できること、データを消す migration | `src/db/email-login-migration.test.ts`、`src/db/destructive-migrations.test.ts` |
| F28-AC31(ヘッダー) | `src/site/account-link.browser.test.ts` |
| F28-AC34 | `src/decks/account-deletion.test.ts` |
| F22-AC38〜F22-AC42 | `src/uploads/invited-authors.test.ts`、`src/drops/send.test.ts`、`src/auth/login-routes.test.ts`(F28-AC29) |
| F21-AC61 | `src/follows/routes.test.ts`、`src/site/login-prompt.browser.test.ts` |

## 退会のあとのページ(F28-AC77、F28-AC80〜F28-AC84)

`POST /account/delete` が成功すると、cookie を消してから `/goodbye` へ 303 で送る(`src/decks/account-routes.ts`)。`/goodbye`(`src/site/goodbye-page.ts`)は、読み書きをしない静的なページで、ほかの静的なページ(規約など)と同じように、メンテナンス中も開け、同じ CSP(`PLAIN_PAGE_POLICY`)、request の上限なし、`noindexPrivate` の対象(検索には載らない)にした。ハンドルの予約語に `goodbye` を足した(`ROUTE_HANDLES`)。

削除したものは、列挙しない(F28-AC84)。理由: 列挙すると、消すものが増えたときに、書き忘れて、事実と合わなくなる。「退会の手続きが完了しました」と言えば、退会できたことは伝わる。運営の招待と、ハッシュだけの送信の記録が残ることも書かない(依頼者の判断)。停止中の人は、`auth_user` の行が残る(F17-AC30 の暫定)が、本文は「手続きが完了した」ことだけを言うので、その人にも正確である。
