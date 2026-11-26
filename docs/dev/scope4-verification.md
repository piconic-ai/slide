# 第四スコープの通しの確認

第四スコープ(`scope4`)の先頭 `983561e5`(`origin/main` の取り込み済み)に、作業 Z の「通す」(Z2b)を行った記録である。第四スコープの指示書の 06-DONE.md の「通しの確認」の 1〜16 を、それぞれ、(a) 確かめる文面の各点をテストと実物の操作に対応づけ、(b) テストファイルを 1 つずつ実行して終了コードを確かめ、(c) テストでは確かめられない点をローカルの Worker で確かめた。

ローカルでは、マシンの負荷のため、全件とカバレッジは測らず、変更に関わるテストファイルを 1 つずつ動かした。全件とカバレッジは CI で確かめる。ローカルの Worker(`wrangler dev --local`)は 1 つだけ動かし、使い終わって止めた。サービスから外への通信は、どの確認でも実際には出していない(送り先は模擬)。

この記録のあと(2026-11-26)、メールアドレスの暗号化(作業 C)を、依頼者の判断で仕組みごと外した([第四スコープの統合の記録](scope4-integration.md#作業-c-は依頼者の判断で仕組みごと外した))。この文書は、次のように直してある。

- 項目 11 は「作らないことにした(外した)」にした。外したあとに確かめたことは、下の「11. メールアドレスの暗号化」にある。
- 第四スコープの migration は、C の 2 本を消して番号を詰め、`main` の 0059〜0061(#614 の Luma の配信先、#627 のコミュニティのお知らせ、#629 の Luma のイベントの別名)が入ったので、0062〜0070 の 9 本である(記録したときは 0059〜0069 の 11 本)。下の表の番号は、いまの番号に直した。記録したときの実物の出力には、その旨を書いた。
- 外したことでテストの数が変わったファイル(項目 4、5、11、14)は、外したあとに、そのファイルだけをもう一度実行した結果に直した。ほかの行は、記録したとき(`983561e5`)のままである。

## 結果

| 項目 | 結果 | 根拠 | 確かめていないこと |
| --- | --- | --- | --- |
| 1. migration | 通った | `src/db/scope4-migrations.test.ts`(D-09: 番号が 0062〜0070 で隙間なし、消す文なし、0058 までのデータに `main` の 0059〜0061 と第四スコープの 0062〜0070 を足して人・スライド・コミュニティ・フォローが残る)。`src/db/migration-numbers.test.ts`、`src/db/destructive-migrations.test.ts`(数は増えていない)、`src/db/migrations.test.ts`。実物: 空の D1 に `wrangler d1 migrations apply slide --local` で 0001〜0070 がすべて成功(出力の最後の行が `0070_mcp_scope.sql ✅`。作業 C の 2 本を消して番号を詰めたあとに、やり直した結果。記録したときは 0001〜0069 で、最後の行は `0069_mcp_scope.sql ✅` だった)。 | 本番の D1 への適用(依頼者が、バックアップのあとに行う)。 |
| 2. 規約のページ | 通った | `src/legal/handed-over.test.ts`(F34-AC1〜AC3、AC6: 写しが `legal/` の文面と 1 字も違わない)、`src/legal/document.pure.test.ts`(D-22、F34-AC10: 決まっていない値の印が残る文面は失敗)、`src/legal/documents.pure.test.ts`、`src/site/legal-pages-dated.test.ts`(施行日ありで表示が外れ、検索に載る)、`src/site/footer.pure.test.ts`(F34-AC22: kobaken が `https://x.com/kfly8`)。実物: `/terms`、`/privacy`、`/privacy/external` が 200、`X-Robots-Tag: noindex, nofollow`、題名が「利用規約(下書き)」、本文に「下書きです。正式な内容は、施行日を入れて公開します。」、フッターが `運営者: <a href="https://x.com/kfly8">`。`Accept-Language: en-US` で日本語の文面に「This page is available in Japanese only.」が付く。 | 規約とプライバシーポリシーの文面の仕上げと施行日(依頼者)。 |
| 3. 1 本の書き出しと置き直し | 通った | `src/exports/slide-export.test.ts`(F35-AC3〜AC9、AC24〜AC29)、`src/exports/zip-interop.test.ts`(別の実装で zip を開ける)、`slide-info.pure.test.ts`、`article-text.pure.test.ts`、`versions.pure.test.ts`。実物(`$O` はローカルの Worker): 持ち主の cookie で `published.zip` 200、`prepared.zip` は準備済みの版を足したあと 200、`slide.json` 200。zip の `index.html` の SHA-256 が `slide.json` の値と一致し、置いたファイル(`examples/static/index.html`)の SHA-256 `bcf9ff15…a17a1d5` とも一致。zip の中身は `index.html` だけでサービスが足したものはない。展開した zip をそのまま `scripts/upload.mjs` で置き直すと、同じ SHA-256 の版ができた。ほかの人のスライド(`demo-reader` の `citing-demo`)の書き出しは `published.zip`、`article.md`、`slide.json` のどれも 404。cookie なしは 303 で `/login`。 | 記事のあるスライドの書き出し(実物では記事を作っていない。`article.md` はテストで確認)。 |
| 4. まとめての書き出し | 通った | `src/exports/export-screens.test.ts`(F35-AC1、AC2、AC14〜AC17、F28-AC115: 退会の確認からのリンクと、停止中の人の扱い)、`src/exports/info-export.test.ts`(F35-AC17〜AC27: D-34 の項目)、`lease-store.test.ts`(同時に 1 つ)、`links.pure.test.ts`。実物: `/settings` に「退会の前に、データを書き出せます。」と `/settings#export` へのリンク、`#export` にスライドごとの `published.zip` `prepared.zip` `slide.json` と `/account/export/account.json`。`account.json` のキーは `account`(handle, email, createdAt, termsAcceptedAt)、`profile`、`following`、`followingCommunities`、`muted`、`blocked`、`managedCommunities`、`aiAgents`、`slides`。 | 限定公開・非公開のスライドを含む件数が多い場合の長い一覧(実物のデータは 1 本のため。テストで確認)。 |
| 5. AI エージェントからの書き出し | 通った(実物の接続は通していない) | `src/mcp/export-account.test.ts`(F23-AC47〜AC51、F35-AC32、AC35、AC42)、`src/mcp/slide-files.test.ts`(F35-AC33〜AC41: SHA-256 の一致、取り出す URL)、`src/mcp/file-url.pure.test.ts`(F35-AC36〜AC39: 1 時間で切れる、別の人では取れない)、`src/mcp/grant-scope.test.ts`(F23-AC46〜AC48: 変更より前の接続は足した道具を使えず、つなぎ直すように答える)、`src/mcp/article-api.test.ts`(記事を読む道具)。テストは、MCP のクライアントを OAuth でつなぎ(`src/mcp/test-connect.ts`)、Worker にその道具を呼ばせる形で、D1 と R2 は `getPlatformProxy` のローカルのものである。 | 実物の AI エージェント(OAuth でつないだ接続)での操作。ローカルの起動では通していない。依頼者が、つなぎ直した接続で一度試す。 |
| 6. ヘルプ | 通った | `src/help/routes.test.ts`(F36-AC1〜AC28)、`src/help/search.pure.test.ts`(F36-AC14〜AC21、AC49: 0 件)、`src/help/moved-content.pure.test.ts`(F36-AC10、AC11: 第三スコープまでの内容が記事にある)、`src/help/fourth-scope-articles.pure.test.ts`、`src/help/links.test.ts`・`src/site/settings-help-links.pure.test.ts`・`src/drops/help-place.pure.test.ts`・`src/auth/login-help-links.pure.test.ts`(設定、置けなかった理由、ログインなどからの記事へのリンク)、`src/site/help-bot-page.pure.test.ts`(F33-AC18/19: `/help/bot`)、`scripts/help-registry.test.mjs`、`src/help/help.browser.test.ts`(Chromium)。実物: `/help` 200 で検索の欄と 8 つの狙い、`/help?lang=en` も 200、`/help?q=zip` は 6 件(`/help/account/export-all`、`/help/slides/accepted-files` など)、`/help?q=zzqqxx` は「zzqqxxに合う記事は見つかりませんでした。」、`/help/bot` と `/help/slides` が 200。`src/` に `/help#` の形のリンクは残っていない(grep)。 | 英語の全記事を目で読むこと。 |
| 7. 通知 | 通った | `src/alerts/login-mail.test.ts`(F39-AC1、AC2: 1 時間に 3 回失敗で 1 回だけ。F39-AC10: webhook 未設定のときは送らず記録)、`src/alerts/digest.test.ts`(F39-AC3、AC7、AC8: 翌日のメール 1 通に両方、知らせることが無い日は出ない)、`notify.test.ts`、`counts.test.ts`、`notice.pure.test.ts`・`notice-text.pure.test.ts`・`digest-text.pure.test.ts`(D-56 の表と、本文に `@` も IP も入らない F39-AC9)、`src/app/cron-events.test.ts`・`cron-routes.test.ts`・`src/app/response-log.test.ts`(D-62)。送り先はすべて模擬(`fetch` を差し替えたもの)。実物: 秘密の値が無いローカルの起動で毎時と日次(19、20、22、23 時 UTC)の cron を起こすと、`cron_task` が `ok` で、`alert_digest` は `{"rows":0,"sent":false}`(メールが出ない)。 | 実物の Discord の webhook、実物のメール、Cloudflare のアラート(依頼者が、通知ごとに、わざと失敗を起こして届くことを確かめる)。 |
| 8. 見張り | 通った | `watcher/src/watch-step.pure.test.ts`・`watch-run.pure.test.ts`・`watch-state.pure.test.ts`(F39-AC13〜AC15: 失敗 1 回では知らせず、2 回続くと知らせ、戻ると 1 回知らせる)、`watch-maintenance.pure.test.ts`・`observe.test.ts`・`src/maintenance/maintenance-watcher.test.ts`(F38-AC23、AC25、AC26: メンテナンス中の応答では開けないことの通知を出さない)、`index.test.ts`(模擬の応答で見張りの Worker を動かす)、`independence.test.ts`(サービスのコードを共有しない)。 | 見張りの Worker を本番へ deploy することと、実物の Discord への通知(依頼者)。 |
| 9. バックアップ | 通った | `src/backups/backup-run.test.ts`(F39-AC25〜AC27、AC29、AC30: 新しいファイルが写る、写し直さない、消したファイルが残る、途中で止めても続きから、バケットが無い設定では何もしない)、`backup-retention.test.ts`(F39-AC27、AC28、AC31: 31 日進めると消える、失敗の通知)、`run-plan.pure.test.ts` ほか純粋な処理、`backup-frame.test.ts`・`backup-frame.browser.test.ts`(運営の画面)。バケットは `getPlatformProxy` のローカルの 2 つ。実物: バケットの無いローカルの起動で `cron_task backup outcome ok count 0`(何もせず終わる)。 | 本番のバックアップのバケットを作ることと、戻し方を一度試すこと(依頼者)。 |
| 10. 計測 | 通った | `src/metrics/record.test.ts`(F40-AC1、AC15、AC22、AC24: 束縛が無ければ何もしない)、`events.pure.test.ts`(F40-AC10〜AC15: 記録の中身)、`referrer.pure.test.ts`・`help-referrer.pure.test.ts`(参照元はホスト名だけ)、`sites.test.ts`(スライドを置く、公開する、開く、ヘルプの 0 件の検索の各経路が記録する)、`daily.test.ts`・`analytics-client.test.ts`(日ごとの集計)、`page.test.ts`・`weeks.pure.test.ts`・`csv.pure.test.ts`(運営の画面の週の表と CSV。F40-AC18〜AC21)、`page.browser.test.ts`(Chromium)、`src/site/no-email-leak.test.ts`(F40-AC15: 記録にメールアドレスなし)。 | 実物の Analytics Engine への書き込みと、SQL API からの読み取り(束縛と読み取り用のトークンが必要。ローカルの起動では束縛が無く、何もしない経路だけを確かめた)。 |
| 11. メールアドレスの暗号化 | 作らないことにした(外した) | 依頼者の判断(2026-11-26)で、仕組みごと外した。記録したときは、暗号と書き換えのテスト(`src/db/email-*.test.ts`、`src/operator/operations-email*.test.ts`)が通っていたが、どれもファイルごと消した。外したあとに、メールアドレスを平文で持つ形で、ログイン、招待、設定、書き出し、送信箱、メールアドレスを外に出さないことが今までどおり動くことを、下の「11. メールアドレスの暗号化」のテストで確かめた。 | 無い(鍵の登録も、既存の行の書き換えも、行わない)。 |
| 12. 保存した版 | 通った | `src/offline/viewer-offline.browser.test.ts`(F37-AC1、AC3〜AC5、AC7〜AC11、AC13、AC16、AC17、D-121: 開く、つながらない/429/503 で保存した版と帯、404/410/403 では出ない、通信が戻ると帯が消える、21 本目で最古が消える、1 日で切れる)、`version-offline.browser.test.ts`(F37-AC12、AC18)、`frame-support.browser.test.ts`(D-95)を、`BROWSER=chromium`、`firefox`、`webkit` の 3 つで 1 ファイルずつ実行した。結果は下の詳細の表のとおり、すべて終了コード 0。`policy.pure.test.ts`、`records.pure.test.ts`、`limits.pure.test.ts`、`viewer-worker.pure.test.ts`、`version-worker.pure.test.ts`、`viewer-routes.test.ts`、`version-routes.test.ts`。 | 実機のブラウザ(iOS の Safari を含む)での確認(依頼者)。Playwright の Chromium・Firefox・WebKit で通っただけである。 |
| 13. メンテナンス | 通った | `src/maintenance/notice.test.ts`・`notice.pure.test.ts`(F38-AC1〜AC8: 予定を入れると全ページに予告の帯)、`maintenance.test.ts`・`switch.pure.test.ts`(F38-AC13〜AC18、AC23: 見込みと理由、`Retry-After`、値 `on`、規約・ヘルプ・robots.txt が読める、D1 を外しても開く)、`maintenance-page.pure.test.ts`、`entrance.test.ts`・`pass-token.pure.test.ts`(F38-AC19〜AC22: 運営の入口を通ると管理 origin が開き、通らないと 503)、`src/app/cron-routes.test.ts`(F38-AC15、AC22: メンテナンス中は足した処理も止まる)。実物: `MAINTENANCE=on;until=2026-12-30T03:00:00Z;reason=database` で起動すると、`/my/slides` と `/@kfly8/try-static` が 503、`Retry-After: 86400`(上限の 1 日)、`X-Slide-Maintenance: on;until=…`、本文に「2026年12月30日 12:00 (日本時間。2026-12-30 03:00 UTC)ごろに終わる見込みです。データベースの保守のため、サービスを止めています。」。`/terms`、`/help`、`/robots.txt` は 200。cron を起こすと `scheduled_skipped_maintenance`。 | 実物の Access を通る運営の入口(テストでは、Access の鍵を模擬の組に差し替えて確かめた)。メンテナンス中に D1 を外した実物の起動(テストで束縛を外して確認)。 |
| 14. 登録を開く | 通った | `src/auth/open-signup.test.ts`(F42-AC1〜AC5: 招待制のあいだは招待の無いアドレスに送らず、開くとコードが送られ、規約に同意して登録できる)、`signup-pause.test.ts`・`signup-mode.pure.test.ts`・`src/operator/operations-signups.test.ts`(F42-AC12〜AC15: 「新しい登録を止める」。新しいアドレスには送られず、登録している人はログインでき、表示がアドレスによって変わらない)、`src/alerts/signup-notices.pure.test.ts`・`thresholds.pure.test.ts`(F42-AC27、AC29、AC10、AC22: 全体の上限を設定したときの 80% の通知、設定しない(既定)ときは通知が出ないこと、急増の通知)。実物: `OPEN_SIGNUP` を外した起動で招待の無いアドレスの `POST /login` は 200 で `mail_outbox` に 0 行、`OPEN_SIGNUP=on` の起動では 1 行。**登録から 7 日以内の人の本数(F42-AC17、AC18)**: 「1 日」は直近 24 時間と決まり(2026-11-26、依頼者の判断)、`src/uploads/new-author.test.ts` が、ローカルの D1 と HTTP で、3 本は置け、4 本目は 429 の `new_author_limit` と `availableAt`(いちばん古い始めの 24 時間後)で断られ、24 時間を過ぎると置けること、同時に 50 本始めても 3 本までしかできないこと(`WHERE` の条件を外すと 20 本できて落ちる)、AI エージェント(`put_slide`。`src/mcp/put-slide.test.ts`)にも同じ理由と時刻が出ることを確かめる。ドロップの画面の文は `src/drops/text.pure.test.ts`・`src/drops/send.test.ts`、ヘルプの記事は `src/help/fourth-scope-articles.pure.test.ts`(F36-AC37)が確かめる。 | 全体の上限は、既定で無効にした(2026-11-26、依頼者の決定。F42-AC25〜AC29)ので、数の決定は要らない。実物のメールの送信。ドロップの画面の断りの文を、実物のブラウザで見ること(下の「確かめていないこと」)。 |
| 15. 反映の仕組み | 通った | `scripts/release-flow.test.mjs`(REL-AC1〜AC5: `.tagpr` と workflow、`release` を進める job が `needs.tagpr.outputs.tag != ''` のときだけ動く)、`scripts/release-deploy.test.mjs`・`release-steps.pure.test.mjs`・`release-options.pure.test.mjs`・`release-source.pure.test.mjs`・`release-fetch.test.mjs`(REL-AC6〜AC12: 記録、migration、deploy、確認の順に呼び、途中の失敗で止まって通知を呼ぶ。コマンドを差し替えて動かす)、`scripts/post-deploy-checks.pure.test.mjs`、`scripts/distribution.test.mjs`、`src/operator/wrangler-config.test.ts`(設定を読み込むと今までと同じ名前、D1、R2、経路で、環境が足されていない)、`scripts/load/guard.pure.test.mjs`・`run.test.mjs`(COST-AC4、AC5: 試験の台本は本番の origin を断る)。実行: `gh actions-lock --verify` は「All 3 workflows valid」で終了コード 0、`actionlint .github/workflows/*.yml` も終了コード 0。 | Workers Builds を本番の Worker につなぐこと、main と release のブランチの保護、実際の tagpr のリリース PR を merge しての反映(依頼者)。 |
| 16. 外へ出ていない | 通った | `src/app/outbound-fetch.test.ts`(`fetch` を差し替え、送り先が Discord の webhook、Cloudflare の API、見張りの Worker が確かめる自分のサービスの URL だけで、設定の値が無いと止まる)、`src/app/scope4-unset.test.ts`・`src/env-optional.pure.test.ts`(D-08: 足した binding と secret を全部外しても動く)、`src/app/scope4-routes.test.ts`、`src/site/no-email-leak.test.ts`。実物: 起動時の記録として、1〜15 の実物の操作(cron の毎時と日次、書き出し、ヘルプ、規約、メンテナンス、登録)の間、Worker のプロセス(`workerd`)の TCP の接続を `lsof` で調べると、自分の待ち受け(`127.0.0.1:8871`、`[::1]:8871`)と wrangler の検査口(`127.0.0.1:9235`)への localhost の接続だけで、外部のアドレスへの接続は 0 本。 | 本番の構成での外への通信(Discord、Cloudflare の API)。ローカルの起動では、秘密の値と束縛を足していないため、外へ出る経路そのものが動いていない(送り先の模擬のテストで確かめた)。 |

14 の最後の 1 文(登録から 7 日以内の人の 1 日の本数の制限)は、「1 日」の数え方が決まった(直近 24 時間。2026-11-26)あとに足し、通った(F42-AC17、AC18)。通らなかった項目は、いまは無い。

## この確認で直したもの

通しの確認の途中で、次の 4 つが落ちた、または確かめきれなかったので、直した。

| 何が | 原因 | 直し方 |
| --- | --- | --- |
| `src/app/response-log.test.ts` の「login not set up → 503」が 500 で落ちる(クリーンな `origin/scope4` でも落ちる) | ログインの画面が、メールの送り口を調べる前に `signup_pause_events`(migration 0066。記録したときの番号は 0065)を読む。テストの D1 に migration を当てていなかったので、表が無く 500 になった。本番では migration を先に当てる(反映の順番の 1 つ目)ので、この組み合わせは本番では起きない | テストの D1 に `applyMigrations` を当てた(`src/app/response-log.test.ts`)。D-08 は「束縛や secret が無い環境」の決まりで、migration 前の D1 まで動くことは求めていない |
| `src/db/email-login-migration.test.ts` の「invited_emails の列が Drizzle の表と合う」が落ちる | 作業 C の migration が `ADD COLUMN` で足した列は、保存された表では最後の列になる。`src/db/schema.ts` は 2 番目に宣言していた | その列の宣言を最後に移した。作業 C を外したので、いまは列も migration も無く、`invited_emails` は第三スコープまでの 3 列である。`pnpm db:er:check` は通る |
| `src/offline/frame-support.browser.test.ts` の D-95 の 1 つ目が、Chromium で 3 回に 2 回落ちる | 最初の読み込みで「まだ worker が枠を支配していない」ことを確かめていたが、`skipWaiting` と `clients.claim` が動くので、支配が間に合うかは競争である | 最初の読み込みの `controlled: false` の確認を外し、「再読み込みのあとは支配される」だけを確かめる。4 回続けて通った |
| `src/db/scope4-migrations.test.ts` が、コメントでは「コミュニティ」と書いていながら、コミュニティを入れていなかった(06-DONE の 1 は「コミュニティ、フォロー」が残ること) | 書き忘れ | `communities`、`community_admins`、`community_follows` に行を入れ、0062 以降を足したあとも残ることを確かめる |

## 実物で確かめた手順(ローカルの Worker)

`.agents/skills/verify-slide/launch.sh` と同じ変数で、`--test-scheduled` を足して起動した(`PUBLIC_ORIGIN` と `CONTENT_ORIGIN` は `http://localhost:8871`、`BETTER_AUTH_SECRET` はローカル専用の値、`MAIL_OUTBOX=on`)。D1 と R2 の置き場は、空から migration を、記録したときの 0001 から 0069 まで当てたものである(作業 C の 2 本を含む。鍵は設定していないので、メールアドレスは平文のまま動いた)。`scripts/demo-citations.mjs` で、持ち主 `kfly8` の `try-static` と、別の人 `demo-reader` の `citing-demo` を置いた。

| 手順 | 結果 |
| --- | --- |
| `wrangler d1 migrations apply slide --local --persist-to <空の置き場>` | 記録したときは 0001〜0069 がすべて ✅。作業 C を外して番号を詰めたあとに、空の置き場でやり直し、0001〜0067 がすべて ✅。そのあと `main` の 0059〜0061 が入って 0070 までになったので、もう一度やり直し、0001〜0070 がすべて ✅(項目 1) |
| `curl -i /terms`、`/privacy`、`/privacy/external` | 200、`X-Robots-Tag: noindex, nofollow`、「(下書き)」、下書きの注記、フッターの kobaken(項目 2) |
| `curl -b <持ち主の cookie> /my/slides/try-static/export/{published.zip,prepared.zip,slide.json}` と、`scripts/upload.mjs` で置き直し | 200、zip の SHA-256 が置いたファイルと `slide.json` に一致、置き直しで同じ SHA-256(項目 3) |
| `curl -b <持ち主の cookie> /my/slides/citing-demo/export/*` | 404(項目 3) |
| `/settings`、`/account/export/account.json` | 書き出しの一覧、D-34 の項目(項目 4) |
| `/help`、`/help?q=zip`、`/help?q=zzqqxx`、`/help/bot`、`/help?lang=en` | 8 つの狙い、6 件、0 件の表示、200、英語(項目 6) |
| `/cdn-cgi/handler/scheduled` を毎時、19、20、22、23 時 UTC で起こす | `cron_task` がすべて `ok`、通知のメールは出ない(項目 7、9、16) |
| `MAINTENANCE=on;until=2026-12-30T03:00:00Z;reason=database` で再起動 | 503、`Retry-After: 86400`、見込みと理由、規約・ヘルプ・robots.txt は 200、cron は `scheduled_skipped_maintenance`(項目 13) |
| `OPEN_SIGNUP` なしと `OPEN_SIGNUP=on` で、招待の無いアドレスに `POST /login` | `mail_outbox` に 0 行と 1 行(項目 14) |
| `lsof -a -p <workerd の pid> -i` | localhost 以外への接続 0 本(項目 16) |

## 項目ごとのテストの実行

各行は、そのファイルだけを `pnpm test <ファイル>` で実行した結果である(終了コード、Vitest の Tests の行)。ブラウザの種類を書いた行は `BROWSER=<名前>` で実行した。「テスト名の受け入れ条件の ID」は、ファイルの中のテスト名に現れる ID である。同じファイルが 2 つの項目に出るものは、それぞれの項目で実行した。

### 1. migration

| テストファイル | テスト名の ID | ブラウザ | 終了コード | 結果 |
| --- | --- | --- | --- | --- |
| `src/db/scope4-migrations.test.ts` | D-09 |  | 0 | Tests  3 passed (3) |
| `src/db/migration-numbers.test.ts` |  |  | 0 | Tests  1 passed (1) |
| `src/db/destructive-migrations.test.ts` |  |  | 0 | Tests  2 passed (2) |
| `src/db/migrations.test.ts` |  |  | 0 | Tests  2 passed (2) |
| `src/db/metrics-migration.test.ts` | F40-AC15, F40-AC17 |  | 0 | Tests  14 passed (14) |
| `src/db/backups-migration.test.ts` | F39-AC26, F39-AC29 |  | 0 | Tests  3 passed (3) |

### 2. 規約のページ

| テストファイル | テスト名の ID | ブラウザ | 終了コード | 結果 |
| --- | --- | --- | --- | --- |
| `src/legal/handed-over.test.ts` | F34-AC1, F34-AC2, F34-AC3, F34-AC6 |  | 0 | Tests  6 passed (6) |
| `src/legal/document.pure.test.ts` | D-22, F34-AC7, F34-AC10, F34-AC13, F34-AC14 |  | 0 | Tests  46 passed (46) |
| `src/legal/documents.pure.test.ts` | D-23, F34-AC9, F34-AC11, F34-AC12, F34-AC24 |  | 0 | Tests  7 passed (7) |
| `src/legal/document-pages.pure.test.ts` | F34-AC3, F34-AC4, F34-AC5, F34-AC6, F34-AC7, F34-AC10, F34-AC15, F34-AC16, F34-AC17, F34-AC18 |  | 0 | Tests  15 passed (15) |
| `src/site/legal-pages.test.ts` | F34-AC1, F34-AC2, F34-AC3, F34-AC4, F34-AC7, F34-AC8, F34-AC9, F34-AC10, F34-AC11, F34-AC15, F34-AC16, F34-AC17, F34-AC18, F34-AC23, F17-AC24, F34-AC24, F34-AC25, F34-AC26, F34-AC27 |  | 0 | Tests  32 passed (32) |
| `src/site/legal-pages-dated.test.ts` | F34-AC10, F34-AC11, F34-AC12 |  | 0 | Tests  3 passed (3) |
| `src/site/footer.pure.test.ts` | F34-AC21, F34-AC22, F03-AC92, F03-AC93, F03-AC95 |  | 0 | Tests  8 passed (8) |
| `src/site/footer-github.browser.test.ts` | F03-AC92, F03-AC93, F03-AC94, F03-AC95 | chromium | 0 | Tests  11 passed (11) |
| `src/legal/pull-request-template.test.ts` | F34-AC28 |  | 0 | Tests  2 passed (2) |

### 3. 1 本の書き出しと置き直し

| テストファイル | テスト名の ID | ブラウザ | 終了コード | 結果 |
| --- | --- | --- | --- | --- |
| `src/exports/slide-export.test.ts` | F35-AC3, F35-AC4, F35-AC5, F35-AC6, F35-AC7, F35-AC8, F35-AC9, F35-AC24, F35-AC25, F35-AC26, F35-AC27, F35-AC29 |  | 0 | Tests  41 passed (41) |
| `src/exports/zip-interop.test.ts` | F35-AC3, F35-AC8 |  | 0 | Tests  3 passed (3) |
| `src/exports/zip.pure.test.ts` |  |  | 0 | Tests  25 passed (25) |
| `src/exports/slide-info.pure.test.ts` | F35-AC12, F35-AC13 |  | 0 | Tests  5 passed (5) |
| `src/exports/article-text.pure.test.ts` | F35-AC11 |  | 0 | Tests  3 passed (3) |
| `src/exports/versions.pure.test.ts` | F35-AC4, F35-AC5 |  | 0 | Tests  10 passed (10) |

### 4. まとめての書き出し

| テストファイル | テスト名の ID | ブラウザ | 終了コード | 結果 |
| --- | --- | --- | --- | --- |
| `src/exports/export-screens.test.ts` | F35-AC1, F35-AC2, F35-AC4, F35-AC5, F35-AC11, F35-AC14, F35-AC15, F35-AC16, F35-AC17, F35-AC26, F35-AC30, F35-AC31, F36-AC42, F28-AC115 |  | 0 | Tests  23 passed (23) |
| `src/exports/info-export.test.ts` | F28-AC4, F35-AC11, F35-AC12, F35-AC13, F35-AC17, F35-AC18, F35-AC19, F35-AC20, F35-AC21, F35-AC22, F35-AC23, F35-AC24, F35-AC25, F35-AC26, F35-AC27 |  | 0 | Tests  13 passed (13) |
| `src/exports/lease-store.test.ts` | F35-AC29 |  | 0 | Tests  9 passed (9) |
| `src/exports/links.pure.test.ts` | F35-AC4, F35-AC5, F35-AC11, F35-AC17 |  | 0 | Tests  7 passed (7) |

### 5. AI エージェントからの書き出し

| テストファイル | テスト名の ID | ブラウザ | 終了コード | 結果 |
| --- | --- | --- | --- | --- |
| `src/mcp/export-account.test.ts` | F35-AC32, F35-AC35, F35-AC42, F36-AC47, F23-AC47, F23-AC48, F23-AC49, F23-AC51 |  | 0 | Tests  12 passed (12) |
| `src/mcp/slide-files.test.ts` | D-08, F35-AC27, F35-AC33, F35-AC34, F35-AC35, F35-AC36, F35-AC37, F35-AC38, F35-AC39, F35-AC40, F35-AC41, F23-AC47, F23-AC49, F23-AC50 |  | 0 | Tests  25 passed (25) |
| `src/mcp/grant-scope.test.ts` | F23-AC46, F23-AC47, F23-AC48 |  | 0 | Tests  9 passed (9) |
| `src/mcp/article-api.test.ts` | F23-AC15, F23-AC16, F23-AC17, F23-AC18, F23-AC19, F23-AC20, F23-AC21, F23-AC22, F23-AC23, F23-AC25, F23-AC26, F23-AC27, F23-AC28, F23-AC29, F23-AC30, F23-AC31, F23-AC32, F23-AC33, F23-AC34, F23-AC35, F27-AC36, F23-AC36, F23-AC37, F23-AC38, F23-AC39, F23-AC40, F23-AC41, F27-AC41, F26-AC88, F26-AC95 |  | 0 | Tests  66 passed (66) |
| `src/mcp/file-url.pure.test.ts` | F35-AC36, F35-AC37, F35-AC38, F35-AC39 |  | 0 | Tests  24 passed (24) |
| `src/mcp/files.pure.test.ts` | F23-AC6, F23-AC24 |  | 0 | Tests  23 passed (23) |
| `src/mcp/refusal.pure.test.ts` | F23-AC7, F23-AC10 |  | 0 | Tests  18 passed (18) |
| `src/mcp/scope.pure.test.ts` | F23-AC46, F23-AC47 |  | 0 | Tests  9 passed (9) |

### 6. ヘルプ

| テストファイル | テスト名の ID | ブラウザ | 終了コード | 結果 |
| --- | --- | --- | --- | --- |
| `src/help/routes.test.ts` | F36-AC1, F36-AC2, F36-AC6, F36-AC13, F36-AC14, F36-AC16, F36-AC18, F36-AC19, F36-AC20, F36-AC21, F36-AC22, F36-AC23, F36-AC24, F36-AC25, F36-AC27, F36-AC28 |  | 0 | Tests  183 passed (183) |
| `src/help/links.test.ts` | F36-AC26, F36-AC48 |  | 0 | Tests  3 passed (3) |
| `src/help/screen-words.test.ts` | F36-AC9 |  | 0 | Tests  116 passed (116) |
| `src/help/moved-content.pure.test.ts` | F36-AC10, F36-AC11, F26-AC23, F26-AC24 |  | 0 | Tests  21 passed (21) |
| `src/help/search.pure.test.ts` | F36-AC14, F36-AC15, F36-AC16, F36-AC17, F36-AC18, F36-AC19, F36-AC20, F36-AC21, F36-AC49 |  | 0 | Tests  91 passed (91) |
| `src/help/fourth-scope-articles.pure.test.ts` | F36-AC11, F36-AC30, F36-AC31, F36-AC32, F36-AC33, F36-AC34, F36-AC35, F36-AC36, F36-AC37, F36-AC38 |  | 0 | Tests  24 passed (24) |
| `src/help/frame-links.pure.test.ts` | F36-AC41, F36-AC48 |  | 0 | Tests  22 passed (22) |
| `src/help/open-signup.test.ts` | F42-AC5 |  | 0 | Tests  4 passed (4) |
| `src/site/help-bot-page.pure.test.ts` | F33-AC18, F33-AC19 |  | 0 | Tests  6 passed (6) |
| `src/site/settings-help-links.pure.test.ts` | F36-AC40, F36-AC41, F36-AC45 |  | 0 | Tests  5 passed (5) |
| `src/drops/help-place.pure.test.ts` | F36-AC46 |  | 0 | Tests  23 passed (23) |
| `src/auth/login-help-links.pure.test.ts` | F36-AC46 |  | 0 | Tests  13 passed (13) |
| `scripts/help-registry.test.mjs` | F36-AC12 |  | 0 | Tests  3 passed (3) |
| `src/help/help.browser.test.ts` | F36-AC1, F36-AC6, F36-AC29, F36-AC41 | chromium | 0 | Tests  17 passed (17) |

### 7. 通知

| テストファイル | テスト名の ID | ブラウザ | 終了コード | 結果 |
| --- | --- | --- | --- | --- |
| `src/alerts/login-mail.test.ts` | F39-AC1, F39-AC2, F39-AC10, F39-AC16 |  | 0 | Tests  7 passed (7) |
| `src/alerts/digest.test.ts` | F39-AC3, F39-AC7, F39-AC8, F39-AC9 |  | 0 | Tests  10 passed (10) |
| `src/alerts/notify.test.ts` | D-120, F39-AC1, F39-AC2, F39-AC3, F39-AC7, F39-AC10, F39-AC16 |  | 0 | Tests  27 passed (27) |
| `src/alerts/counts.test.ts` | F39-AC1, F39-AC4, F39-AC5, F39-AC6, F39-AC7, F39-AC16, F39-AC18 |  | 0 | Tests  14 passed (14) |
| `src/alerts/frame.test.ts` | F39-AC11, F39-AC20 |  | 0 | Tests  5 passed (5) |
| `src/alerts/notice.pure.test.ts` | D-56, D-120, F39-AC9 |  | 0 | Tests  91 passed (91) |
| `src/alerts/notice-text.pure.test.ts` | D-120, F39-AC9 |  | 0 | Tests  32 passed (32) |
| `src/alerts/digest-text.pure.test.ts` | F39-AC3, F39-AC4, F39-AC5, F39-AC6, F39-AC7, F39-AC9 |  | 0 | Tests  22 passed (22) |
| `src/alerts/counted-notices.pure.test.ts` | F39-AC1, F39-AC4, F39-AC5, F39-AC6, F39-AC7, F39-AC16 |  | 0 | Tests  15 passed (15) |
| `src/alerts/signup-notices.pure.test.ts` | F42-AC27, F42-AC29, F42-AC10, F42-AC22 |  | 0 | Tests  23 passed (23) |
| `src/alerts/webhook-url.pure.test.ts` | F39-AC10 |  | 0 | Tests  22 passed (22) |
| `src/alerts/thresholds.pure.test.ts` | D-56, F39-AC16, F42-AC22 |  | 0 | Tests  19 passed (19) |
| `src/alerts/response-log.pure.test.ts` | D-62 |  | 0 | Tests  28 passed (28) |
| `src/app/response-log.test.ts` | D-62 |  | 0 | Tests  6 passed (6) |
| `src/app/cron-events.test.ts` | F39-AC3, F39-AC17, F39-AC18 |  | 0 | Tests  10 passed (10) |
| `src/app/cron-routes.test.ts` | F39-AC3, F38-AC15, F39-AC17, F39-AC18, F38-AC22 |  | 0 | Tests  20 passed (20) |
| `scripts/discord-notice.pure.test.mjs` | REL-AC7 |  | 0 | Tests  9 passed (9) |

### 8. 見張り

| テストファイル | テスト名の ID | ブラウザ | 終了コード | 結果 |
| --- | --- | --- | --- | --- |
| `watcher/src/watch-step.pure.test.ts` | D-120, F39-AC13, F39-AC14, F39-AC15, F39-AC16 |  | 0 | Tests  16 passed (16) |
| `watcher/src/watch-run.pure.test.ts` | D-120, F39-AC10, F39-AC12, F39-AC13, F39-AC14, F39-AC15, F38-AC24, F38-AC25, F38-AC26 |  | 0 | Tests  17 passed (17) |
| `watcher/src/watch-state.pure.test.ts` | D-120, F39-AC14, F39-AC15, F38-AC25, F38-AC26 |  | 0 | Tests  25 passed (25) |
| `watcher/src/watch-maintenance.pure.test.ts` | F38-AC25, F38-AC26 |  | 0 | Tests  22 passed (22) |
| `watcher/src/watch-text.pure.test.ts` | D-58, F39-AC14, F39-AC15, F38-AC25, F38-AC26 |  | 0 | Tests  11 passed (11) |
| `watcher/src/watch-config.pure.test.ts` | D-57, D-58, D-120, F39-AC12, F39-AC16, F38-AC26 |  | 0 | Tests  26 passed (26) |
| `watcher/src/observe.test.ts` | D-120, F39-AC12, F38-AC26 |  | 0 | Tests  29 passed (29) |
| `watcher/src/index.test.ts` | F39-AC10, F39-AC12, F39-AC13, F39-AC14, F39-AC15, F38-AC24, F38-AC25, F38-AC26 |  | 0 | Tests  9 passed (9) |
| `watcher/src/independence.test.ts` | F39-AC12, F39-AC23 |  | 0 | Tests  4 passed (4) |
| `watcher/src/webhook-url.pure.test.ts` | F39-AC10 |  | 0 | Tests  13 passed (13) |
| `src/maintenance/maintenance-watcher.test.ts` | F38-AC23, F38-AC25, F38-AC26 |  | 0 | Tests  4 passed (4) |

### 9. バックアップ

| テストファイル | テスト名の ID | ブラウザ | 終了コード | 結果 |
| --- | --- | --- | --- | --- |
| `src/backups/backup-run.test.ts` | F39-AC25, F39-AC26, F39-AC27, F39-AC29, F39-AC30 |  | 0 | Tests  17 passed (17) |
| `src/backups/backup-retention.test.ts` | F39-AC27, F39-AC28, F39-AC31 |  | 0 | Tests  12 passed (12) |
| `src/backups/backup-frame.test.ts` | F39-AC30, F39-AC32 |  | 0 | Tests  4 passed (4) |
| `src/backups/run-plan.pure.test.ts` | F39-AC25, F39-AC26, F39-AC29 |  | 0 | Tests  8 passed (8) |
| `src/backups/run-plan-tell.pure.test.ts` | F39-AC28, F39-AC31 |  | 0 | Tests  9 passed (9) |
| `src/backups/page-plan.pure.test.ts` | F39-AC25, F39-AC26, F39-AC27 |  | 0 | Tests  9 passed (9) |
| `src/backups/keys.pure.test.ts` | F39-AC25 |  | 0 | Tests  7 passed (7) |
| `src/backups/limits.pure.test.ts` | F39-AC29 |  | 0 | Tests  9 passed (9) |
| `src/backups/backup-frame.browser.test.ts` | F39-AC30, F39-AC32 | chromium | 0 | Tests  2 passed (2) |

### 10. 計測

| テストファイル | テスト名の ID | ブラウザ | 終了コード | 結果 |
| --- | --- | --- | --- | --- |
| `src/metrics/record.test.ts` | F40-AC1, F40-AC15, F40-AC22, F40-AC24 |  | 0 | Tests  6 passed (6) |
| `src/metrics/events.pure.test.ts` | F40-AC7, F40-AC10, F40-AC12, F40-AC13, F40-AC14, F40-AC15 |  | 0 | Tests  25 passed (25) |
| `src/metrics/referrer.pure.test.ts` | F40-AC10, F40-AC15 |  | 0 | Tests  25 passed (25) |
| `src/metrics/help-referrer.pure.test.ts` | F40-AC13 |  | 0 | Tests  15 passed (15) |
| `src/metrics/daily.test.ts` | F40-AC17, F40-AC22, F40-AC23 |  | 0 | Tests  19 passed (19) |
| `src/metrics/analytics-client.test.ts` | F40-AC17, F40-AC23 |  | 0 | Tests  15 passed (15) |
| `src/metrics/page.test.ts` | D-72, F40-AC15, F40-AC18, F40-AC19, F40-AC20, F40-AC21, F40-AC22, F40-AC23 |  | 0 | Tests  14 passed (14) |
| `src/metrics/csv.pure.test.ts` | F40-AC19, F40-AC20 |  | 0 | Tests  17 passed (17) |
| `src/metrics/sites.test.ts` | F40-AC1, F40-AC2, F40-AC3, F40-AC4, F40-AC5, F40-AC6, F40-AC7, F40-AC8, F40-AC9, F40-AC10, F40-AC11, F40-AC12, F40-AC13, F40-AC14, F40-AC15, F40-AC22, F40-AC24 |  | 0 | Tests  33 passed (33) |
| `src/metrics/weeks.pure.test.ts` | F40-AC18 |  | 0 | Tests  11 passed (11) |
| `src/metrics/page.browser.test.ts` | F40-AC19, F40-AC25 | chromium | 0 | Tests  3 passed (3) |

### 11. メールアドレスの暗号化

作らないことにした(外した)。記録したときに実行した `src/db/email-boundary.test.ts`、`email-cipher.pure.test.ts`、`email-rewrite-store.test.ts`、`email-migration.test.ts`、`src/operator/operations-email.test.ts`、`operations-email-frame.pure.test.ts`、`src/auth/login-routes-sealed.test.ts` は、機能といっしょに消した。

外したあとに、メールアドレスを平文で持つ形で、関わる動きが今までどおりであることを、次のファイルを 1 つずつ実行して確かめた(2026-11-26)。

| テストファイル | テスト名の ID | ブラウザ | 終了コード | 結果 |
| --- | --- | --- | --- | --- |
| `src/auth/login-routes.test.ts` | F17-AC30, F22-AC42, F28-AC1, F28-AC3, F28-AC5, F28-AC7, F28-AC8, F28-AC9, F28-AC10, F28-AC11, F28-AC12, F28-AC13, F28-AC14, F28-AC15, F28-AC16, F28-AC18, F28-AC20, F28-AC22, F28-AC23, F28-AC26, F28-AC29, F28-AC30, F28-AC31, F28-AC33, F28-AC56, F28-AC58, F28-AC59, F28-AC60, F28-AC63, F28-AC64, F28-AC65, F28-AC66, F28-AC73, F28-AC75, F28-AC113, F30-AC2, F30-AC3 |  | 0 | Tests  87 passed (87) |
| `src/auth/invited-authors.test.ts` | F22-AC23, F22-AC39, F22-AC40, F22-AC41 |  | 0 | Tests  17 passed (17) |
| `src/auth/mail-total.test.ts` | F42-AC25, F42-AC26, F42-AC27, F42-AC28, F42-AC29, F42-AC10 |  | 0 | Tests  21 passed (21) |
| `src/auth/signup-store.test.ts` | F28-AC67, F28-AC69, F28-AC71, F28-AC72, F28-AC74, F28-AC111 |  | 0 | Tests  6 passed (6) |
| `src/operator/invites.test.ts` | F28-AC24, F28-AC25, F28-AC26 |  | 0 | Tests  10 passed (10) |
| `src/operator/routes.test.ts` | F17-AC12, F17-AC19, F17-AC20, F17-AC21 |  | 0 | Tests  11 passed (11) |
| `src/operator/operations-pages.pure.test.ts` | (ID なし。「運用」の枠が 4 つで、決めた順に並ぶ) |  | 0 | Tests  2 passed (2) |
| `src/operator/places.browser.test.ts` | (ID なし。「運用」の見出しが 4 つ) | chromium | 0 | Tests  4 passed (4) |
| `src/auth/email-traces.test.ts` | F43-AC8, F43-AC10(作業 C のテストから、鍵に関わらない守りを残したもの) |  | 0 | Tests  4 passed (4) |
| `src/mail/login-code-mail.pure.test.ts` | F28-AC2(と、件名と本文に宛先のアドレスが入らないこと) |  | 0 | Tests  4 passed (4) |
| `src/mail/outbox-store.test.ts` | F43-AC12(ローカルの送信箱: アドレスで読める、24 時間で消える、本番の設定で入らない) |  | 0 | Tests  4 passed (4) |
| `src/db/email-login-migration.test.ts` | F28-AC28, F28-AC32 |  | 0 | Tests  12 passed (12) |
| `src/profile/settings-profile.test.ts` | D-27, F21-AC57, F21-AC58, F21-AC59, F21-AC60, F28-AC35, F28-AC36, F28-AC37, F28-AC38, F28-AC39, F28-AC40, F28-AC53, F28-AC54 |  | 0 | Tests  17 passed (17) |
| `src/profile/gravatar-face.test.ts` | D-33, F28-AC46, F28-AC47, F28-AC48, F28-AC49, F28-AC50, F28-AC70, F28-AC101 |  | 0 | Tests  19 passed (19) |
| `src/site/no-email-leak.test.ts` | F39-AC9, F40-AC15, F35-AC32, F28-AC54 |  | 0 | Tests  10 passed (10) |
| `src/app/scope4-unset.test.ts` | D-08 |  | 0 | Tests  5 passed (5) |

### 12. 保存した版

| テストファイル | テスト名の ID | ブラウザ | 終了コード | 結果 |
| --- | --- | --- | --- | --- |
| `src/offline/viewer-routes.test.ts` | F37-AC2, F37-AC7, F37-AC14, F03-AC63 |  | 0 | Tests  11 passed (11) |
| `src/offline/version-routes.test.ts` | F37-AC7, F37-AC18 |  | 0 | Tests  10 passed (10) |
| `src/offline/policy.pure.test.ts` | F37-AC3, F37-AC7, F37-AC10 |  | 0 | Tests  64 passed (64) |
| `src/offline/records.pure.test.ts` | F37-AC10, F37-AC11 |  | 0 | Tests  23 passed (23) |
| `src/offline/limits.pure.test.ts` | F37-AC18 |  | 0 | Tests  38 passed (38) |
| `src/offline/viewer-worker.pure.test.ts` | F37-AC1, F37-AC5, F37-AC7, F37-AC10 |  | 0 | Tests  40 passed (40) |
| `src/offline/version-worker.pure.test.ts` | F37-AC1, F37-AC5, F37-AC7, F37-AC10, F37-AC12, F37-AC17 |  | 0 | Tests  48 passed (48) |
| `src/offline/frame-support.browser.test.ts` | D-95 | chromium | 0 | Tests  3 passed | 1 skipped (4) |
| `src/offline/viewer-offline.browser.test.ts` | D-121, F37-AC1, F37-AC3, F37-AC4, F37-AC5, F37-AC7, F37-AC8, F37-AC9, F37-AC10, F37-AC11, F37-AC13, F37-AC16, F37-AC17 | chromium | 0 | Tests  13 passed (13) |
| `src/offline/version-offline.browser.test.ts` | F37-AC1, F37-AC3, F37-AC4, F37-AC5, F37-AC7, F37-AC8, F37-AC9, F37-AC10, F37-AC12, F37-AC17, F37-AC18 | chromium | 0 | Tests  12 passed (12) |
| `src/offline/frame-support.browser.test.ts` |  | firefox | 0 | Tests  4 passed (4) |
| `src/offline/viewer-offline.browser.test.ts` |  | firefox | 0 | Tests  13 passed (13) |
| `src/offline/version-offline.browser.test.ts` |  | firefox | 0 | Tests  12 passed (12) |
| `src/offline/frame-support.browser.test.ts` |  | webkit | 0 | Tests  3 passed | 1 skipped (4) |
| `src/offline/viewer-offline.browser.test.ts` |  | webkit | 0 | Tests  13 passed (13) |
| `src/offline/version-offline.browser.test.ts` |  | webkit | 0 | Tests  12 passed (12) |

### 13. メンテナンス

| テストファイル | テスト名の ID | ブラウザ | 終了コード | 結果 |
| --- | --- | --- | --- | --- |
| `src/maintenance/maintenance.test.ts` | F38-AC9, F38-AC13, F38-AC14, F38-AC15, F38-AC16, F38-AC17, F38-AC18, F38-AC23, F38-AC28 |  | 0 | Tests  22 passed (22) |
| `src/maintenance/notice.test.ts` | F38-AC1, F38-AC2, F38-AC4, F38-AC5, F38-AC6, F38-AC7, F38-AC8, F17-AC12 |  | 0 | Tests  29 passed (29) |
| `src/maintenance/entrance.test.ts` | F38-AC19, F38-AC20, F38-AC21, F38-AC22 |  | 0 | Tests  20 passed (20) |
| `src/maintenance/switch.pure.test.ts` | F38-AC13, F38-AC14, F38-AC15, F38-AC16, F38-AC23 |  | 0 | Tests  55 passed (55) |
| `src/maintenance/notice.pure.test.ts` | F38-AC1, F38-AC4, F38-AC6, F38-AC7 |  | 0 | Tests  43 passed (43) |
| `src/maintenance/pass-token.pure.test.ts` | F38-AC19 |  | 0 | Tests  29 passed (29) |
| `src/maintenance/maintenance-page.pure.test.ts` | F38-AC9, F38-AC10, F38-AC12, F38-AC28 |  | 0 | Tests  6 passed (6) |
| `src/operator/operations-maintenance-frame.pure.test.ts` | F38-AC1, F38-AC7, F38-AC8, F38-AC19 |  | 0 | Tests  15 passed (15) |

### 14. 登録を開く

| テストファイル | テスト名の ID | ブラウザ | 終了コード | 結果 |
| --- | --- | --- | --- | --- |
| `src/auth/open-signup.test.ts` | F42-AC1, F42-AC2, F42-AC3, F42-AC4, F42-AC5 |  | 0 | Tests  24 passed (24) |
| `src/auth/signup-pause.test.ts` | F42-AC12, F42-AC13, F42-AC14, F42-AC15 |  | 0 | Tests  15 passed (15) |
| `src/auth/signup-store.test.ts` | F28-AC67, F28-AC69, F28-AC71, F28-AC72, F28-AC74, F28-AC111 |  | 0 | Tests  6 passed (6) |
| `src/auth/signup-mode.pure.test.ts` | F42-AC1, F42-AC2, F42-AC4, F42-AC12, F42-AC13 |  | 0 | Tests  39 passed (39) |
| `src/auth/signup-sweep.pure.test.ts` | F28-AC69, F28-AC71, F28-AC74 |  | 0 | Tests  4 passed (4) |
| `src/operator/operations-signups.test.ts` | F42-AC11, F42-AC12, F42-AC15 |  | 0 | Tests  5 passed (5) |
| `src/operator/operations-signups-frame.pure.test.ts` | F42-AC11, F42-AC12, F42-AC15, F42-AC16 |  | 0 | Tests  6 passed (6) |
| `src/uploads/new-author.test.ts` | F42-AC17, F42-AC18, F42-AC19, F42-AC20, F42-AC21, F42-AC22 |  | 0 | Tests  13 passed (13) |
| `src/uploads/new-author-limits.pure.test.ts` | D-130, F42-AC17, F42-AC18, F42-AC19, F42-AC21, F42-AC22 |  | 0 | Tests  30 passed (30) |
| `src/drops/text.pure.test.ts` | F22-AC6, F22-AC38, F42-AC18 |  | 0 | Tests  34 passed (34) |
| `src/drops/send.test.ts` | F22-AC6, F22-AC17, F22-AC33, F22-AC38, F42-AC18 |  | 0 | Tests  24 passed (24) |
| `src/mcp/refusal.pure.test.ts` | F23-AC10, F42-AC20 |  | 0 | Tests  25 passed (25) |
| `src/mcp/put-slide.test.ts` | F23-AC10, F42-AC20 |  | 0 | Tests  11 passed (11) |
| `src/alerts/signup-notices.pure.test.ts` | F42-AC27, F42-AC29, F42-AC10, F42-AC22 |  | 0 | Tests  23 passed (23) |

### 15. 反映の仕組み

| テストファイル | テスト名の ID | ブラウザ | 終了コード | 結果 |
| --- | --- | --- | --- | --- |
| `scripts/release-flow.test.mjs` | REL-AC1, REL-AC2, REL-AC3, REL-AC4, REL-AC5 |  | 0 | Tests  29 passed (29) |
| `scripts/release-deploy.test.mjs` | REL-AC6, REL-AC7, REL-AC8, REL-AC9, REL-AC10, REL-AC11, REL-AC12 |  | 0 | Tests  27 passed (27) |
| `scripts/release-fetch.test.mjs` | REL-AC8 |  | 0 | Tests  2 passed (2) |
| `scripts/release-steps.pure.test.mjs` | REL-AC6, REL-AC7, REL-AC8 |  | 0 | Tests  21 passed (21) |
| `scripts/release-options.pure.test.mjs` | REL-AC7, REL-AC10 |  | 0 | Tests  13 passed (13) |
| `scripts/release-source.pure.test.mjs` | REL-AC11, REL-AC12 |  | 0 | Tests  37 passed (37) |
| `scripts/post-deploy-checks.pure.test.mjs` | REL-AC8, REL-AC9 |  | 0 | Tests  62 passed (62) |
| `scripts/distribution.test.mjs` | F22-AC30 |  | 0 | Tests  3 passed (3) |
| `src/operator/wrangler-config.test.ts` | F17-AC12, F17-AC19 |  | 0 | Tests  3 passed (3) |
| `scripts/load/guard.pure.test.mjs` | COST-AC4, COST-AC5 |  | 0 | Tests  74 passed (74) |
| `scripts/load/run.test.mjs` | COST-AC4, COST-AC5 |  | 0 | Tests  4 passed (4) |

### 16. 外へ出ていない

| テストファイル | テスト名の ID | ブラウザ | 終了コード | 結果 |
| --- | --- | --- | --- | --- |
| `src/app/outbound-fetch.test.ts` | D-02, D-58, D-60, D-69 |  | 0 | Tests  1 passed (1) |
| `src/app/scope4-unset.test.ts` | D-08 |  | 0 | Tests  5 passed (5) |
| `src/app/scope4-routes.test.ts` | D-12, D-23, D-38, D-45, D-46, F35-AC1, F38-AC19 |  | 0 | Tests  11 passed (11) |
| `src/env-optional.pure.test.ts` | D-08 |  | 0 | Tests  1 passed (1) |
| `src/site/no-email-leak.test.ts` | F39-AC9, F40-AC15, F35-AC32, F28-AC54 |  | 0 | Tests  10 passed (10) |

## 確かめていないこと(ローカルでは確かめられない)

実物の Discord の webhook とアラート、実物のメール、Cloudflare Access(運営の入口)、Cloudflare のアラートと Budget alerts、Workers Builds、tagpr のリリース PR の merge、本番の D1 と R2(バックアップのバケットを含む)、Analytics Engine の書き込みと読み取り、実機のブラウザ(iOS の Safari を含む)、実物の AI エージェントの接続。依頼者が行うことは [第四スコープの統合の記録](scope4-integration.md) と [デプロイの手順](deploy.md) にある。

## 検証のコマンド(この作業の変更に対して)

`pnpm build`、`pnpm format:check`、`python3 scripts/check-docs.py`、`pnpm db:er:check`、`gh actions-lock --verify` は終了コード 0。`pnpm exec tsc --noEmit` の結果は PR の本文に書く。`pnpm test:coverage` は、依頼者の決まりでローカルでは動かさず、PR の最新コミットの CI で確かめる。
