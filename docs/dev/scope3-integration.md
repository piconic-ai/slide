# 第三スコープの統合の点検

第三スコープ(イベントの紐づけ、コミュニティ、コミュニティのフォロー、viewer のおすすめ、ブロック、Luma の配信、ヘルプ)を統合ブランチ `scope3` に集めたあとに、つないだ状態で食い違いがないかを確かめた結果を記録する。点検は作業 Z の「そろえる」で、`scope3` の `089db597`(作業 H の取り込みまで)に対して行った。通しの確認とスクリーンショットは、`scope3` から `main` への PR で扱う。そのあと、依頼者の回答による手直し(#472、#475、#476)を取り込んだ `scope3` の `0cba355c` で、ブロックとフォローの行を実装に合わせて直した(ブロックしている間は、どちら向きのフォローも止める)。

点検のうち、機械で確かめられるものはテストに残した。

| 点検 | 残したテスト |
| --- | --- |
| migration が足すだけで、`main` のデータが残る | `src/db/scope3-migrations.test.ts` |
| 新しい経路が、既存の経路やハンドルのページに隠れない | `src/app/scope3-routes.test.ts` |
| 予約語の一覧と経路の一覧が一致する | `src/auth/handle-rules.test.ts`、`src/auth/handle-rules.pure.test.ts` |
| 外への通信が決まった行き先だけ | `src/app/outbound-fetch.test.ts`、`src/feeds/one-fetch.test.ts` |
| ブロックの除外の付け忘れがない | `src/share/takedown-readers.test.ts` ほか(下の表) |
| 新しい画面が日本語と英語の両方で出る | `src/app/scope3-routes.test.ts` |

## migration

`migrations/` は 0001 から 0058 まで、欠けも重なりもない(`src/db/migration-numbers.test.ts`)。0049〜0052 は、第三スコープを切ったあとに `main` が足して本番に適用したもの(端末ごとのセッション、関連リンクの `normalized_url`・`sanitized_url`)である。第三スコープは、その後ろの 0053〜0058 で、どれも表・索引・trigger を足すだけである。第三スコープの 6 本は、はじめ 0049〜0054 だったが、`main` を取り込むときに中身を変えずに番号だけを付け替えた(ファイルの先頭のコメントの番号は、付け替える前のまま)。

| 番号 | 付け替える前 | 足すもの |
| --- | --- | --- |
| 0053 | 0049 | `handles`、`released_handles`、`handles_owner`、既存の `accounts` のハンドルの写し、trigger 2 つ |
| 0054 | 0050 | `events`、`related_link_events`、`related_link_events_event` |
| 0055 | 0051 | `blocks`、`blocks_blocked` |
| 0056 | 0052 | `communities`、`community_admins`、`community_links`、`community_feed_events`、索引 5 つ |
| 0057 | 0053 | `luma_feeds`、`luma_feed_gate`(1 行)、`luma_feeds_due` |
| 0058 | 0054 | `community_follows`、`community_follows_community` |

0053〜0058 に、`DROP`、`RENAME`、`ADD COLUMN` 以外の `ALTER TABLE`、`DELETE`、表の作り直しはない。

ローカルの D1 で、次の 2 つを確かめた。`--remote` は使っていない。

1. 空の D1 に 0001〜0058 を適用する。一時ディレクトリに `migrations/` の写しと最小の `wrangler.jsonc` を置き、`wrangler d1 migrations apply slide --local --persist-to <一時ディレクトリ>` で 58 本すべてが適用された。
2. `main` の最後の状態(0001〜0052)の D1 に、人 2 人(`accounts`)、スライド 2 本(`decks`)、関連リンク(`related_links`、connpass のイベントの URL)、フォロー 1 件(`follows`)を入れ、0053〜0058 を足して適用した。6 本が適用され、行はそのまま残り、`handles` に `alice`・`bob` が `person` として写っていた。

同じことを `src/db/scope3-migrations.test.ts` が CI で確かめる。

## 経路

`src/app/routes.tsx` で、第三スコープの経路は次の順に登録されている。`/help` と `/help/bot` はメンテナンスの middleware より前、ほかは `shareRoutes` の後にある。`/@ハンドル/...` はすべて `shareRoutes` が受け、`handles` を引いて、コミュニティなら `showCommunity` に渡す。

| 経路 | 受ける場所 | 確かめた応答 |
| --- | --- | --- |
| `/communities/new` | `communityForms` | 作るフォーム(`action="/communities/new"`) |
| `/events/:id` | `eventRoutes` | イベントのページと発表 |
| `/blocks/new` | `blockForms`(`/blocks`) | ブロックの確認のページ(`action="/blocks"`) |
| `/@コミュニティ/edit` | `shareRoutes` → `showCommunity` | 編集のページ(`action="/communities/:id/edit"`) |
| `/@人/edit` | `shareRoutes` | その人の `edit` という名前のスライド(人のスライドは `edit` を名前にできる) |
| `/@handle/communities` | `shareRoutes` | プロフィールの「コミュニティ」のタブ |
| `/help/bot` | `app.get(HELP_BOT_PATH)` | 配信を読むボットの説明 |

予約語(`RESERVED_HANDLES`)の経路の語は、`app.routes` の先頭の語と一致する(`operator` だけは別のホストで受ける)。第三スコープの `communities`、`events`、`blocks`、`edit` は予約語にある。模擬配信の `/__mock/luma` の `__mock` は、ハンドルに使えない文字を含むので予約語は要らない。`/@handle/communities` の `communities` を、ハンドルの後に来る語の一覧(`AFTER_HANDLE_WORDS`)に足し、共有 URL の一覧と突き合わせるテストに含めた。

## 外への通信

サーバー側でグローバルの `fetch` を使うのは、次の 5 か所だけである。binding や entrypoint の `fetch`(`env.ASSETS.fetch`、`ContentFiles`、`CoverShots`、MCP の handler)は Worker の中で閉じる。

| ファイル | 行き先 | いつから |
| --- | --- | --- |
| `src/auth/turnstile-client.ts` | `challenges.cloudflare.com`(Turnstile の Siteverify) | 既存 |
| `src/mail/mail-client.ts` | `api.cloudflare.com`(Email Sending) | 既存 |
| `src/profile/gravatar-client.ts` | Gravatar(プロフィール画像) | 第二スコープ |
| `src/feeds/luma-client.ts` | `api.lu.ma/ics/get` だけ(D-67) | 第三スコープ(作業 L) |
| `src/uploads/status-page.ts` | 同じ origin の `/api/uploads/...`(作者のブラウザで動く script) | 既存 |

関連リンク、紐づけ用リンク、OGP、connpass への通信はない。指示書の想定(Turnstile、メール、Luma)のほかに、第二スコープからの Gravatar がある。

## ブロックの除外

除外の条件は `src/blocks/store.ts` の `notBlocking` にあり、一覧は `notBlockedBy`(`notBlockedByOf`)を使う。ミュートの条件(`notMutedBy`)を使う問い合わせは、すべてブロックの条件も使う(`src/share/takedown-readers.test.ts` が付け忘れを見つける)。D-71 の表の場所ごとに、呼んでいる場所とテストは次のとおり。

| 場所 | 呼んでいる場所 | テスト |
| --- | --- | --- |
| トップの最近のスライド、フォロー中の人の新着 | `src/share/store.ts` | `src/share/blocks.test.ts`(F32-AC3) |
| フォローしているコミュニティの新着、「すべて見る」 | `src/communities/feed-store.ts` | `src/communities/feed.test.ts`(F32-AC4) |
| コミュニティのページの一覧と数 | `src/communities/page-store.ts` | `src/communities/routes.test.ts`(F32-AC4) |
| イベントのページと一覧 | `src/events/store.ts` | `src/events/event-page.test.ts`、`src/communities/event-communities.test.ts`(F32-AC4) |
| プロフィールの「コミュニティ」のタブの最近のスライド | `src/profile/communities-store.ts` | `src/profile/communities-tab.test.ts`(F32-AC4) |
| viewer のおすすめ(同じイベント・同じコミュニティ) | `src/share/viewer-talks-store.ts` | `src/share/viewer-talks.test.ts`(F24-AC45) |
| viewer の引用の一覧、表紙のカードの数 | `src/citations/store.ts`、`src/citations/pair-store.ts` | `src/share/blocks.test.ts`(F32-AC3、F32-AC6、F32-AC7) |
| プロフィールの「引用された」の数と一覧 | `src/citations/store.ts` | `src/share/blocks.test.ts`(F32-AC7) |
| お知らせ(書くときと読むとき) | `src/notifications/store.ts` | `src/share/blocks.test.ts`(F32-AC5) |
| フォロー(ブロックしている間の、どちら向きのフォローも) | `src/follows/store.ts`(`notBlocking` を両向きに)、`src/follows/routes.ts`、`src/share/routes.ts`(`blockedBetween`) | `src/blocks/routes.test.ts`、`src/blocks/store.test.ts`、`src/blocks/screens.test.ts`(F32-AC1、F32-AC2) |

抜けはなかった。

## 文言

第三スコープで足した画面の文言は、どれも `messages()` で日本語と英語を持つ(英語の辞書のキーの欠けは型検査で落ちる)。辞書を使わないのは、`lang` で分ける `src/events/event-name.ts` と、運営の画面(`src/communities/operator-page.ts`、`src/feeds/operator-page.ts`、`src/operator/pages.ts`)である。運営の画面は第二スコープから日本語だけで、それに合わせている。

新しい画面と変わった画面(コミュニティを作る・見る・編集する、イベントのページ、ブロックの確認、プロフィールの「コミュニティ」のタブ、イベントの行のある viewer、フォローしているコミュニティの新着、設定、`/help/bot`)を英語で開いて日本語が残らないこと、日本語で開いて日本語で出ることを、`src/app/scope3-routes.test.ts` で確かめる。

## 部品の重なり

| 部品 | 点検の結果 |
| --- | --- |
| ロゴ | 描く部品は `communityLogo` の 1 つだったが、アップロードしたロゴの URL を選ぶ処理が、コミュニティのページの `logoOf` と viewer のイベントの行に 2 つあった。`logoOf` を `src/communities/logo.ts` に移し、viewer もそれを使う |
| カバー画像の模様 | 模様は `coverPattern` の 1 つだった。アップロードした画像と模様を選んで描く処理が、コミュニティのページとイベントのページに別々にあった。`src/site/cover-pattern.ts` の `coverOf` と `src/communities/community.ts` の `communityCoverOf` にまとめた。コミュニティのページのカバー画像にも、イベントのページと同じく `referrerpolicy="no-referrer"` が付く |
| フォローのボタン | 人とコミュニティのボタンは、どちらも `src/follows/pages.ts` の `followButton` を使っていた。重なりなし |
| URL の判定 | イベントの URL(`src/events/event-url.ts`)とコミュニティの紐づけ用リンク(`src/communities/link-rules.ts`)が、グループのホストを読む `groupOf` を別々に持っていた。コミュニティの側は、Luma のカレンダーの番号の形と配信の URL の組み立ても、`src/feeds/luma-url.ts` と別に持っていた。どちらも 1 つにまとめた |
