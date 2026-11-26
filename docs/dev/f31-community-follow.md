# コミュニティのフォローの実装設計

[コミュニティをフォローする](../features/f31-community-follow.md) を実装するための契約。ここでは、フォローの表、フォローと解除の経路、コミュニティのページの「フォロー」と「フォロワー」のタブ、削除と退会での扱いを扱う。

## 保存

表 `community_follows` に、「だれが、どのコミュニティを」を 1 行で持つ(migration `0058_community_follows.sql`)。

| 列 | 内容 |
| --- | --- |
| `user_id` | フォローした人。利用者の id |
| `community_id` | フォローされたコミュニティ。`communities.id` を参照する |
| `created_at` | フォローした日時(秒) |

主キーは 2 つの組である。同じコミュニティを 2 度フォローしても、行は 1 つで、最初の日時を保つ。フォロワーのタブを新しい順に引くために、`(community_id, created_at)` に索引を置く。人のフォローの一覧は、主キーの先頭の `user_id` で引く。

`followCommunity`(`src/communities/follow-store.ts`)は、1 つの文で、フォローした人にアカウントがあり、停止されておらず、コミュニティがあってハンドルを持つときだけ行を足す。ブロックは条件に入れない(F32-AC17、F31-AC12)。お知らせは足さない(D-54、F31-AC11、F20-AC14)。解除(`unfollowCommunity`)は行を消すだけである。

コミュニティを削除すると、`deleteCommunity`(`src/communities/admin-store.ts`)の同じ D1 バッチで、そのコミュニティのフォローを消す(F31-AC13)。退会すると、`markAccountDeleted`(`src/decks/deletion-store.ts`)の同じ D1 バッチで、その人のフォローを消す(F31-AC15)。

## フォローと解除の経路

ボタンは、人のフォローのボタンと同じ部品(`followButton`、`src/follows/pages.ts`)で描く。人のフォローの `followForm` も、これを使う。人のフォローと同じく、「フォロー」は白のピル(`button-secondary`)、「フォロー中」も白のピル(`button-secondary following`)にする(F31-AC1。2026-11-25 の依頼者の回答で、墨のピルをやめた)。読み上げには、コミュニティの名前を入れる(「Kanagawa.pm をフォローする」「Kanagawa.pm のフォローを解除する」)。

| 経路 | 動作 |
| --- | --- |
| `POST /communities/follows` | `handle` のコミュニティを、ログインしている人がフォローする。303 で `back` に戻る |
| `POST /communities/follows/release` | `handle` のコミュニティのフォローを外す。303 で `back` に戻る |

`back` は、人のフォローの戻り先と同じく `returnToShare`(`src/share/path.ts`)で検査し、正規の形でないときは `/my/slides` に戻す。コミュニティのハンドルでない値(人のハンドル、だれも持たないハンドル、ハンドルの形でない値)は、何も変えずに戻す。`Accept: application/json` のときは、操作の後の状態を `{"following": true}` か `{"following": false}` で返す。

ログインしていない人には、ボタンの代わりに、ログインを促すモーダルを開くリンクを出す(F31-AC2)。モーダルは人のフォローと同じ部品(`loginPrompt`、`src/site/login-prompt.ts`)で、種類 `follow-community` の文言を持つ。「ログインして続ける」は `/login?to=<元のページ>` に進み、ログインの後は元のページに戻る。フォローの続きはしない(F21-AC61 と同じ)。スクリプトが無いときは、リンクがそのまま `/login?to=…` に進む。ログインが切れた後にフォームが届いたときは、何も保存せず、303 で同じ `/login?to=…` に送る(JSON なら 401)。

両方の経路は、フォームの `Content-Type` と CSRF を検査し、人のフォローと同じ頻度制限(`management`)に数える。

## コミュニティのページ

頭の「フォロー」は、作業 C の置き場所(`communityFollowFrame`、`src/communities/follow-frames.ts`)に入れる。戻り先は、開いているタブのパスである。頭には数を出さない(D-51)。

「フォロワー」のタブ(`/@handle/followers`)は、人のフォロワーの一覧と同じ部品(`peopleListBody`、`src/follows/people-pages.ts`)で、フォローの新しい順に、1 ページ 50 人で並べる(F31-AC10)。行のボタンは、その人をフォローするボタンで、同じタブに戻る。タブの横の数(`countCommunityFollowers`、`src/communities/followers-store.ts`)は、一覧と同じ条件で数える。退会した人と停止中の人は、だれにも出さない。見ている人がミュートした人は、その人に出さない。`?page=` が正規の値でないときは 404 にする。

## トップの新着

ログイン中のトップの「フォローしているコミュニティの新着」は、ドロップ枠の下、「フォロー中の人の新着」の上に置く(F31-AC3)。トップは静的なファイルなので、枠(`HomeCommunitiesFrame`、`src/site/home-communities-frame.tsx`)のクライアントコンポーネント `components/HomeCommunities.tsx` が、読み込みの後に `GET /api/home/communities` を取る。

フォローしているコミュニティが 1 つでもあるかは、Worker が `/` を返すときに判断する(F31-AC6、F31-AC16)。セッションの cookie がある人にだけ、セッションを確かめ(`currentOwner`。停止中の人も同じに扱う)、`followsAnyCommunity`(`src/communities/follow-store.ts`)で、ハンドルを持つコミュニティへのフォローが 1 行でもあるかを D1 に聞く。あれば、本文の `data-communities="no"` を `data-communities="yes"` に置き換える(`markViewer`、`src/site/home-viewer.ts`)。印が `no` のときは、CSS が枠を `display: none` にするので、フォローしていない人、ログインしていない人、セッションが切れた cookie の人のページに、場所も仮の表示も出ない。cookie のない人には D1 を読まず、ファイルをそのまま返す(ETag と 304 も、これまでどおり)。

印が `yes` の人には、「フォロー中の人の新着」と同じ作りで、見出しと 8 枚ぶんの場所を、中身が届く前から取る(F31-AC16、F03-AC80)。

| 応答 | 画面 |
| --- | --- |
| 届く前 | 見出し、「すべて見る」、仮のカード 8 枚(`.home-loading`、`aria-busy`)、読み上げ用の「読み込み中」 |
| `{"talks": [...]}`(8 枚まで) | 届いたカードと、残りの場所を埋める隠したカード(`.home-spare`) |
| `{"talks": []}`(スライドがない) | 隠したカードの上に「フォローしているコミュニティの新着は、まだありません。」(`.home-room-note`) |
| 失敗 | 「新着を読み込めませんでした。」と「もう一度読み込む」 |
| `null`(セッションがない、またはフォローしているコミュニティがない) | 節を出さない。印が `yes` の人では、印を付けた後にセッションが切れたか、フォローを外したときだけで、1 度だけ縮む |

カードの日付の下の行は、コミュニティの行(`.card-community`)と 2 行になるので、仮のカードと隠したカードにも同じ 2 行を入れて、高さをそろえる。応答は `Cache-Control: private, no-store` で、頻度制限は `/api/home` と同じ `viewer` に数える。押し下がらないことは、ブラウザで、届く前と後の下の節の位置と CLS を測って確かめる(`src/site/home-shift.browser.test.ts`)。

カードは、最近のスライドのカードに、作者と日付の下の行で、コミュニティの名前(コミュニティのページへのリンク)と、その色の小さな印を添える(F31-AC4)。印は飾りなので読み上げない。色は `community-mark-<色>` のクラスでトークンから取り、コミュニティの色はこの印のほかに広げない(D-45)。

並びは `listFollowedCommunityTalks`(`src/communities/feed-store.ts`)が決める。

- 見る人がフォローしているコミュニティに入った(`inCommunity`、`src/communities/store.ts`。コミュニティの番号に列を渡せる)イベントの関連リンクを持つスライドのうち、一覧から開けるもの(準備のできた公開の版があり、取り下げられていない)。
- 見る人がミュート・ブロックした作者のスライドは除く(`notMutedBy`、`notBlockedBy`。F31-AC7、F32-AC4)。
- 一般公開の新しい順(`decks.first_published_at`、無ければ公開の版の準備ができた日時)。イベントごとにはまとめない。
- 1 本のスライドは 1 回だけ出す。複数のフォロー中のコミュニティに入っているときは、見る人が先にフォローしたコミュニティの名前を添える(`ROW_NUMBER()` で選ぶ)。

「すべて見る」は `GET /communities/following`(見る人だけの一覧。ログインしていなければ `/login` へ)。同じ並びを 1 ページ 24 枚で出し、次のページがあれば「次の 24 枚」、2 ページ目からは「前の 24 枚」を出す(F31-AC5)。ページの数は、一覧と同じ行を数えて決める(`countFollowedCommunityTalks`)。最後より後のページでは、「前の 24 枚」を最後のページへ向ける(人の一覧の `neighbourPages` と同じ)。`?page=` が正規の値でないときは 404 にする。

## プロフィールのコミュニティのタブ

`/@handle/communities`(`communitiesListFrame`、`src/profile/community-frames.ts`)は、その人がフォローしているコミュニティを、フォローの新しい順に縦に 1 列で、1 ページ 50 件で並べる(F31-AC8、D-53)。だれのプロフィールでも、ログインしていなくても見られる(F31-AC9、D-50)。

1 件ごとに、上の段にロゴ(48px)、名前(コミュニティのページへのリンク)、その人が管理者なら鍵の印(`adminBadge`。読み上げは「管理者」。F30-AC34)、見ている人のための「フォロー」/「フォロー中」(コミュニティのページと同じボタンで、同じタブに戻る)。ログインしていない人には、ログインを促すモーダルを開くリンクを出す。下の段に、そのコミュニティに入った一般公開中のスライドを、新しい順に 4 枚(`deck-grid-4`。幅が狭いときは 2 枚ずつ 2 段。F31-AC14)。スライドが無いコミュニティは、下の段を出さない。フォロワー数とイベント数は出さない。

| 関数(`src/profile/communities-store.ts`) | 内容 |
| --- | --- |
| `countProfileFollows` | タブの横の「フォロー中」「フォロワー」「コミュニティ」の数。1 回の D1 の batch で読む。コミュニティは、ハンドルを持つものだけを数える |
| `listFollowedCommunities` | 1 ページのコミュニティ。その人が管理者か、見ている人もフォローしているかを、同じ問い合わせで読む |
| `listRecentCommunityTalks` | ページのコミュニティごとの新しいスライド 4 枚。トップの新着と同じく、一覧から開けるものだけで、見ている人がミュート・ブロックした作者を除く(F32-AC4)。1 回の問い合わせで、`ROW_NUMBER()` でコミュニティごとに数える |

コミュニティを削除すると、フォローの行が消えるので、タブと数からも消える(F31-AC13)。`?page=` が正規の値でないときは 404 にする。

プロフィールの頭には、4 つの数を出さない(D-51。第二スコープの F21-AC62 のとおり、数はタブの横だけにある)。
