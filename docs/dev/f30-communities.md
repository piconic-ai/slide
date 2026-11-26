# コミュニティの実装設計

[コミュニティをつくる](../features/f30-communities.md) の F30-AC9〜F30-AC41 と、[イベントの発表として並ぶ](../features/f29-event-talks.md) の F29-AC22 を作るための設計。ハンドルの表と取り方は [人とコミュニティが分け合うハンドルの実装設計](f30-handles.md)、イベントの表と URL の鍵は [イベントの発表の実装設計](f29-event-talks.md) にある。

## 表

migration は 0056(`migrations/0056_communities.sql`)。足すだけで、既存の表と列は変えない(D-04)。

| 表 | 列 | 役割 |
| --- | --- | --- |
| `communities` | `id`(主キー、正の整数)、`name`、`description`、`color`、`sites`、`logo_at`、`cover_at`、`created_at` | コミュニティ。ハンドルは持たず、`handles`(`owner_kind = 'community'`、`owner_id` は `id` の文字列)から引く |
| `community_admins` | `community_id`、`user_id`、`added_at`(主キーは前の 2 つ) | 管理者。`user_id` の索引で、人の管理しているコミュニティを引く |
| `community_links` | `id`、`community_id`、`url`(一意)、`kind`、`host`、`created_at` | 紐づけ用リンク。`url` はそろえた綴りで、一意の索引が 1 つのリンクを 1 つのコミュニティに限る(D-34)。`host` は照らし合わせに使うホスト名で、Luma のカレンダーだけが NULL(CHECK) |
| `community_feed_events` | `link_id`、`event_key`、`added_at` | Luma のカレンダーの配信に並ぶイベントの鍵。作業 L が書く |

- `id` は、作る経路が乱数で選ぶ(`crypto.getRandomValues` で 1〜2^53-1)。ハンドルを取る batch で、コミュニティの行より先に `handles` の行を書くため、自動の番号は使えない。`id` は既定のカバー画像の模様の種でもある(D-46 の「コミュニティの番号から決まる乱数」)。
- `color` は作るときに 5 色(`red`、`orange`、`yellow`、`green`、`navy`)から乱数で選ぶ(D-45、F30-AC22)。変える経路は編集のフォームだけで、`readEditForm` が 5 色のどれかに解析し、`updateCommunity` がほかの値と同じ更新で書く(F30-AC45)。列の `CHECK` も 5 色に限る。
- `sites` は「ほかのリンク」(D-37)の JSON の配列で、3 つまで(CHECK)。読むときに zod で解析する。
- `logo_at`、`cover_at` は、アップロードした画像を置いた時刻(ミリ秒)。画像の URL の版にする。NULL なら頭文字と既定の模様。
- イベントとコミュニティの対応は、表に書き写さない。読むときに、紐づけ用リンクのホスト名とイベントのリンクのホスト名(`related_link_events.host`)を突き合わせる(下の「照らし合わせ」)。紐づけ用リンクを足しても外しても、イベントが後から作られても、対応を作り直す処理が要らない(D-35)。照らし合わせのために、`related_link_events.host` に索引を足す。

## 紐づけ用リンクの判定

`src/communities/link-rules.ts` の `checkCommunityLink` が、入力された 1 本を読む(D-32、F30-AC11、F30-AC12)。リンク先には取りに行かない(D-02)。

| 種類 | 形 | そろえた綴り | `host` |
| --- | --- | --- | --- |
| connpass | `https://<グループ>.connpass.com/` | 同じ | `<グループ>.connpass.com` |
| Doorkeeper | `https://<グループ>.doorkeeper.jp/` | 同じ | `<グループ>.doorkeeper.jp` |
| Luma | `https://api.lu.ma/ics/get?entity=calendar&id=cal-…`(D-05) | `entity` と `id` だけを残す | なし |
| 自前のサイト | `https://<ホスト名>/` | 同じ | `<ホスト名>` |

- `http` も受け取り、`https` にそろえる。ホスト名は小文字にし、末尾の `.` を外す。クエリとフラグメントは捨てる。
- パスはトップ(`/`)だけ。イベントのページやグループの下のページは `not_top` で断る。
- ユーザー名、パスワード、ポートのある URL、ホスト名の形でないもの(`localhost` など、`.` のないもの)は `invalid` で断る。
- `luma.com`、`www.luma.com`、`lu.ma` のページと、形の違う `api.lu.ma` の URL は `luma_calendar` で断る(カレンダーの iCal の URL を入れてもらう)。カレンダーの番号の形(`LUMA_CALENDAR_ID`)、パス(`LUMA_FEED_PATH`)、そろえた綴りの組み立て(`lumaFeedUrl`)は、配信の取得の側(`src/feeds/luma-url.ts`)と同じものを使う。
- connpass と Doorkeeper のグループは、イベントの URL の判定と同じ `groupOf`(`src/events/event-url.ts`)で読む。
- 同じリンクを 2 回入れたときは、1 つにまとめる。1 つ以上、10 個まで(F30-AC17)。

### だれでも使うサイトのホスト名

次のホスト名と、その下のすべてのサブドメイン(`sites.google.com`、`gist.github.com`、`ja.wikipedia.org`、`us02web.zoom.us`、`<グループ>.peatix.com` など)は、自前のサイトとして断る(`public_host`)。一覧は `PUBLIC_HOSTS`、判定は `isPublicHost`(`endsWith` で見る)にある。

`connpass.com`、`doorkeeper.jp`、`luma.com`、`lu.ma`、`api.lu.ma`、`peatix.com`、`techplay.jp`、`github.com`、`gitlab.com`、`x.com`、`twitter.com`、`facebook.com`、`instagram.com`、`threads.net`、`bsky.app`、`linkedin.com`、`youtube.com`、`youtu.be`、`tiktok.com`、`discord.com`、`discord.gg`、`slack.com`、`meetup.com`、`eventbrite.com`、`eventbrite.co.jp`、`zoom.us`、`speakerdeck.com`、`slideshare.net`、`docs.google.com`、`google.com`、`forms.gle`、`notion.so`、`notion.site`、`note.com`、`qiita.com`、`zenn.dev`、`medium.com`、`hatenablog.com`、`wikipedia.org`、`slide.community`、`microsoft.com`、`live.com`、`office.com`、`sharepoint.com`、`apple.com`、`icloud.com`、`amazon.com`、`amazon.co.jp`、`yahoo.co.jp`、`line.me`、`mixi.jp`、`hatena.ne.jp`、`scrapbox.io`、`cosense.io`、`canva.com`、`figma.com`、`miro.com`、`reddit.com`、`pixiv.net`、`nicovideo.jp`、`twitch.tv`、`vimeo.com`、`wordpress.com`、`blogspot.com`、`tumblr.com`、`substack.com`、`dev.to`、`stackoverflow.com`

短縮 URL のホスト名も断る: `t.co`、`bit.ly`、`goo.gl`、`tinyurl.com`、`ow.ly`、`buff.ly`、`is.gd`、`amzn.to`、`lnkd.in`、`x.gd`

connpass と Doorkeeper のサブドメインのうち、サービスが自分で使う語(`www`、`api`、`m`、`help`、`blog`、`support`、`docs`、`status`、`static`、`media`、`img`、`images`、`cdn`、`assets`、`app`、`admin`、`mail`、`manage`、`dev`、`test`、`staging`。一覧は `SERVICE_SUBDOMAINS`)は、グループではない。`https://www.connpass.com/event/<番号>/` はグループ名の無いイベントなので、`www.connpass.com` を紐づけ用リンクにすると、グループ名の無いイベントが集まってしまう(D-33、F30-AC16)。だれでも使うサイトとして断る。

`<名前>.github.io` のような、人ごとのホスト名(一覧のホストの下ではないもの)は、自前のサイトとして受け取る。

### 重複

1 つのリンクは 1 つのコミュニティにだけ属する(D-34、F30-AC13)。保存の前に `findLinkOwners` で、ほかのコミュニティが持つリンクとそのハンドルを引き、欄の下に「このリンクは slide.community/@(ハンドル) がすでに使っています。」を出す。確かめてから書くまでの間にほかのコミュニティが取ったときは、`community_links.url` の一意の索引で書き込みが止まり、batch 全体(外すリンクの削除を含む)が巻き戻る。作るときは `takeHandle` の `precondition` で、ハンドルも含めて何も書かない。

## 照らし合わせ

`src/communities/store.ts` の `inCommunity(communityId)` が、コミュニティのイベントを `events.id` の条件として返す(D-33、F30-AC14〜F30-AC16)。

- connpass、Doorkeeper、自前のサイト: イベントのリンクのうち 1 本でも、書かれたホスト名(`related_link_events.host`)が紐づけ用リンクの `host` と一致すれば入る。connpass のイベントは、グループの違うリンクが混ざることがある(B の設計)。それぞれのグループのコミュニティに入る。
- グループ名の無い `https://connpass.com/event/<番号>/` のリンクは、ホスト名が `connpass.com` で、これを持つコミュニティは無い(だれでも使うサイトとして断る)。どのコミュニティにも入らない。
- Luma: 配信に並ぶイベントの鍵(`community_feed_events.event_key`)が `events.key` と一致すれば入る。作業 L は、`listFeedLinks` でカレンダーの一覧を読み、`addFeedEvents(db, { linkId, keys, now })` で鍵を入れる。鍵は `eventRefOf(url).key`。スライドがまだ無いイベントの鍵も入れてよい(後から関連リンクが保存されたときに入る)。配信から消えた鍵は外さない(D-68)。
- 紐づけ用リンクを外すと(`replaceCommunityLinks`)、そのリンクの行と、Luma ならその配信の鍵が消え、そのリンクで入っていたイベントが外れる(F30-AC15)。

1 つのイベントが 2 つ以上のコミュニティに入ることがある(グループの違うリンクが混ざった connpass のイベント)。イベントのページのカバー画像と、イベントの行のコミュニティには、紐づけ用リンクがいちばん先に足されたコミュニティを出す。

## 管理者の判定

- 変更の経路(編集、画像、管理者、削除、イベント名)は、どれも最初に `community_admins` で、ログイン中の人が管理者かを確かめる。ログインしていない人と、管理者でない人は、同じく 404 にする(コミュニティの有無と、管理者かどうかを外から区別させない)。`/@ハンドル/edit` も同じ。
- 管理者を外す処理は、1 つの文で「外したあとに 1 人以上残る」ことを条件にする。2 人が同時に互いを外しても、最後の 1 人は残る(F30-AC28)。
- イベント名を直せるのは、そのイベントが入っているコミュニティのどれかの管理者(F29-AC22)。作業 B の `mayRenameEvent` に、そのイベントのコミュニティの管理者の集合を渡す。

## コミュニティの管理

`GET /communities/manage`(`src/communities/manage-routes.ts`)が、ログイン中の人の管理しているコミュニティを出す(F30-AC60、F30-AC61)。行は `listManagedCommunities`(`src/communities/admin-store.ts`)が `community_admins` から名前の順に引き、画面は `src/communities/manage-page.ts` が組む。スライドの管理(`src/decks/deck-list-page.ts`)と対にするため、一覧の行は同じ `.deck-rows` と `.deck-row` を使い、ロゴの列とタグの無い 3 列に置き換える。作る枠は、ドロップ枠と同じ大きさの実線の枠で、`/communities/new` へのリンクを持つ。

ログインしていない人には、スライドの管理と同じ `signInPrompt` を 401 で返し、ボタンに `?to=%2Fcommunities%2Fmanage` を付ける(F30-AC62)。`landingOf`(`src/auth/landing.ts`)は、`to` がちょうど `/communities/manage` のときだけそこへ戻し、ほかの形はスライドの管理へ送る。ヘッダーの「ログイン」も、`/share.js` がこのページでは同じ `to` を付ける。停止中の人は、`currentOwner` が投げる停止のエラーで、スライドの管理と同じ 403 の画面になる。`/communities` は新着のコミュニティの一覧が使い、`communities` はハンドルの予約語なので、`manage` が人やコミュニティのハンドルとぶつかることは無い。

## 画像

第二スコープの顔写真と同じ形にする([設定のページの顔写真](f28-email-login.md))。サービスでは画像を縮めない(Workers に画像の処理系が無い)。

1. ブラウザが、選んだファイルの先頭のバイトで PNG、JPEG、WebP かを確かめ(拡張子や `type` を信じない)、大きさ(カバー 2 MB、ロゴ 1 MB)を確かめる(F30-AC29)。
2. ブラウザが、カバーは中央を 4:1 に切り抜いて横 1600px(元が狭ければその幅)に、ロゴは中央の正方形を 256px に描き直し、PNG にして送る(F30-AC30)。描き直すので、元の画像のメタデータは残らない。元の画像は送らない。
3. サービスは、送られたものが決まった大きさの PNG であることを、`src/profile/picture-png.ts` と同じ読み方で確かめる(先頭のバイト、チャンクごとの長さと CRC、IHDR の幅と高さ)。カバーは幅 1〜1600、高さが幅の 1/4(四捨五入)。ロゴは 256 × 256。ほかは断る。表示に要るチャンクだけを残して、R2 に置く。
4. R2 の鍵は `communities/<id>/logo` と `communities/<id>/cover`。配る経路は `/communities/<id>/logo?v=<時刻>`、`/communities/<id>/cover?v=<時刻>` で、顔写真と同じヘッダー(`nosniff`、`sandbox` の CSP)を付ける。
5. 「頭文字に戻す」「既定の模様に戻す」は、行の時刻を NULL にしてから、R2 の物を消す(F30-AC31)。

送るときに縮めるので、2 MB を超える元のファイルを断るのはブラウザである。サービスは、縮めた後の PNG が大きさの上限(カバー 4 MB、ロゴ 512 KB)を超えるものを断る。どちらも、PNG でないものは断る。

## 色と既定の見た目

- 5 色の値は `src/site/design-tokens.ts` の `--community-*`(作業 B が足した)。色の名前は `src/site/cover-pattern.ts` の `COMMUNITY_COLORS`。
- 既定のカバー画像は `coverPattern({ color, seed: id, label })`(D-46、F30-AC23)。アップロードした画像と既定の模様のどちらを描くかは、`communityCoverOf`(`src/communities/community.ts`)が選び、`coverOf`(`src/site/cover-pattern.ts`)が描く。コミュニティのページと、そのコミュニティのイベントのページは、同じこの 2 つを使う。アップロードした画像には `referrerpolicy="no-referrer"` が付く。
- ロゴは、`logoOf`(`src/communities/logo.ts`)が、アップロードしたロゴの URL か頭文字かを選び、`communityLogo` で描く。コミュニティのページ、プロフィールのコミュニティのタブ、viewer のイベントの行は、どれも `logoOf` を使う。
- ロゴの頭文字は、名前の最初の 1 文字(書記素)を大文字にして、色の「中」の地に出す。文字の色は、トークンの値から白と墨それぞれの対比を計算し、高い方を選ぶ(D-48、F30-AC24)。赤、緑、紺は白、橙、黄は墨になる。

## 削除

管理者が、ハンドルを入れて削除する(D-39、F30-AC32、F30-AC33)。入力がハンドルと一致しないときは、サービスが断る。

1 つの batch で、`releaseHandleSteps`(ハンドルを 90 日の保留へ、F30-AC8)、配信の鍵、紐づけ用リンク、管理者、コミュニティの行を消す。R2 のロゴとカバー画像は、batch の後に消す。スライド、関連リンク、イベントは触らない。コミュニティのフォローの行も、同じ batch で消す([コミュニティのフォローの実装設計](f31-community-follow.md))。

## 運営の画面

運営の画面(`src/operator/`)に、コミュニティの一覧と、次の操作を足す(F30-AC36)。どれも運営のホストだけが通る。

- 管理者を足す・外す(D-40)。ハンドルで人を指す。運営も、最後の 1 人は外せない(D-38)。管理者を移すときは、先に新しい人を足してから、前の人を外す。
- ハンドルを変える(D-36)。作業 A の `renameHandle` を呼ぶ。前の URL は新しい URL へ 301 で移る。
- 削除する。管理者の削除と同じ処理。

## 確かめ方

- 紐づけ用リンクの判定: `src/communities/link-rules.pure.test.ts`。
- 作る、照らし合わせ、配信の鍵: `src/communities/store.test.ts`(ローカルの D1)。
