# 引用と SNS の反応を試す

スライドへの反応を、そのスライドの下に集める機能の試作。仕様は未確定で、動かして判断するために置いている。採用する場合は feature とストーリーマップに書き起こす。

## できること

- **ページ番号つきの共有 URL**: `/@handle/slug/6` で 6 ページ目から開く。viewer はデッキの URL に `#6` を付けて渡すので、fragment の番号でページを開くデッキ(peitho、Marp など)で効く。
- **引用の検出**: アップロードの finalize で、デッキの HTML(最大 200 ファイル、各 512KB まで)から共有 URL へのリンクを読み、`citations` に保存する。引用したデッキが一般公開されている間だけ数える。
- **スライド内のリンクで引用元へ移動する**: デッキは sandbox 内で動き、viewer を移動できない。読者がデッキ内の共有 URL へのリンクを押すと、デッキの iframe がその URL を要求する。サービスは iframe からの要求(`Sec-Fetch-Dest: iframe`)に、viewer へ移動を依頼するだけのページを返し、viewer は、本体の iframe の中の自分の origin からの依頼で、共有 URL の path である場合だけ移動する。下に埋め込んだ引用のデッキからの依頼では移動しない。デッキが読者を送れるのは、このサービスの共有 URL だけになる。
- **viewer の構成**: スライドの横に SNS の投稿のタイムラインを置き、最初の画面で両方が見える。スライドの下に題名、作者、全画面表示、共有 URL を置く。幅が狭い画面では縦に並べる。
- **引用の表示**: スライドの下に「このスライドを引用しているスライド」と「このスライドが引用しているスライド」を、埋め込みで表示する。何ページ引用していてもデッキごとに一つで、本体と同じ sandbox の iframe で動く。それぞれ公開が新しい順に 4 件までを表示し、残りは件数だけを示す。埋め込みは 1280×720 で描画して縮小する。
- **イベントとコミュニティの表示**: デッキが発表されたイベントを、作者の下に「コミュニティ、イベント名、開催日、ハッシュタグ」で示す。スライドの下には、同じイベントのほかの発表を発表順に埋め込みで並べる。このサービスのデッキは引用と同じ sandbox の iframe で動かす。Speaker Deck と Docswell のスライドは各サービスの player を埋め込み、それ以外は題名のリンクだけにする。表示は 4 件までで、残りは件数を示す。
- **タイムライン**: 投稿を新しい順に並べる。
- **viewer から外した導線**: 「資料だけを開く」。出回る URL を共有 URL だけにするため。投稿への自前のリンクも置かない。埋め込み自体が投稿へのリンクを持つ。
- **投稿の埋め込み**: 作者が `/decks/:deck/reactions` で X または Bluesky の投稿の URL とページ番号を入力すると、タイムラインに各サービスの公式の埋め込みを表示する。
- **Bluesky からの収集**: 同じ画面から、共有 URL(または入力した言葉)を含む投稿を検索して追加する。投稿が特定のページの URL を含むときは、そのページ番号を一緒に保存する。ページ番号は今は管理画面に出るだけで、読者の画面には使っていない。

イベントは `communities`・`events`・`event_talks`(migration `0015_events.sql`)に持つ。発表は、このサービスのデッキか、他サービスのスライドの URL のどちらか一方を持つ。入力する画面はまだなく、下の script がデモ用の 1 件を入れる。コードは `src/events/` にあり、`talk.ts` が保存された行を読者に見せる発表へ変える純粋なロジック、`store.ts` が D1、`pages.ts` が画面を受け持つ。

純粋なロジックは `src/reactions/` の `citation.ts`・`post.ts`・`collect.ts`・`timeline.ts`、D1 は `store.ts`、R2 の読み取りは `record.ts`、Bluesky との通信は `bluesky.ts`、画面は `pages.ts`、フォームは `routes.ts` に分けている。

## ローカルで試す

ビルド済みのデッキを一つ用意する。以下は kobaken.co の `barefootjs-testing` を使う例。

```sh
pnpm build
pnpm exec wrangler d1 migrations apply slide --local
pnpm exec wrangler dev --local --port 8794 --infer-origin-from-routes=false \
  --var PUBLIC_ORIGIN:http://localhost:8794 \
  --var CONTENT_ORIGIN:http://localhost:8794 \
  --var BETTER_AUTH_SECRET:local-demo-only-better-auth-secret-000000 \
  --var GITHUB_APP_CLIENT_SECRET:local-demo
```

別の terminal で実行する。

```sh
SLIDE_DEMO_BASE=slides/barefootjs-testing \
  node scripts/demo-reactions.mjs ../../kfly8/kobaken.co/public/slides/barefootjs-testing http://localhost:8794 --login
```

script は、指定したデッキと `examples/citing`(前者のページを引用するデッキ)を実際の uploader で送り、ローカル D1 上で一般公開にする。あわせて、指定したデッキが発表されたイベントとして ToKyoto.js #03 を登録し、Speaker Deck と Docswell にある二つの発表を並べる。`--login` を付けると `http://localhost:8795/` を開くだけで本人の session が入り、反応の管理画面へ移動する。この session はローカル D1 に直接作るもので、Worker に認証を迂回する route は追加していない。Chromium 系のブラウザで確認している。

- 引用された側: `http://localhost:8794/@kfly8/barefootjs-testing`
- 引用した側: `http://localhost:8794/@demo-reader/citing-demo`
- 反応の管理: `http://localhost:8794/decks/barefootjs-testing/reactions`

## 確認したこと

- 自動テスト: リンクと投稿 URL の解析、収集、タイムラインの並び、表示件数の絞り込みは Vitest の単体テスト。viewer の表示、CSP、作者のフォーム、権限、finalize 時の記録は `src/reactions/routes.test.ts` がローカル D1・R2 を通して確認する。Bluesky との通信だけを置き換えている。
- 手動: 上の手順で、実際の upload から引用が表示されること、X と Bluesky の実際の埋め込みが表示されて高さが合うこと、Bluesky の実際の検索から投稿が追加されることを Chromium で確認した。
- ブラウザ: デッキ内のリンクで引用元へ移動すること、戻ると元のデッキに帰ること、デッキ自身が移動を依頼しても viewer が動かないこと、下に埋め込んだ引用のデッキが自分の iframe を共有 URL へ移動しても viewer が動かず、読み込みを繰り返さないことを `src/share/viewer.browser.test.ts` が Chromium・Firefox・WebKit で確認する。
- イベントの表示は `src/events/talk.test.ts`(単体)と `src/events/routes.test.ts`(ローカル D1 を通した viewer の表示と CSP)で確認する。
- 手動: Speaker Deck と Docswell の実際の player が viewer の中で表示されることを Chromium で確認した。

## 決めていないこと

- X の投稿を自動で集める方法。読み取り API が必要で、費用の確認が要る。
- 検索で集めた投稿を、表示の前に作者が選ぶかどうか。今は追加した時点で表示し、作者が後から外す。
- 埋め込みを開いた読者の IP アドレスは X・Bluesky に伝わる。押すまで読み込まない形にするかどうか。
- 読者がデッキの中でページをめくっても、viewer は今のページを知らない。タイムラインを今のページに追従させるには、デッキから viewer へ伝える取り決めが要る。
- デッキ内のリンクで移動した後に戻ると、デッキは最初のページから読み込み直す。履歴には iframe の移動の分が一つ残る。
- 引用すると、相手のデッキのページに自分のデッキが埋め込みで動く。引用された作者が外す手段も、運営が止める手段もまだない。埋め込みではなく題名のリンクにする、作者が承認したものだけを埋め込む、などの案がある。
- デッキは読者の操作なしに、自分の iframe を別の共有 URL へ移動できる。その場合も viewer は移動する。読者が押したときだけ移動する形にできるかは未確認。
- 引用の読み取りは finalize の中で行い、最大 200 回の R2 の読み取りを待つ。失敗した場合は引用なしで公開され、後から読み直す手段はない。migration より前の deployment の引用も読まない。
- `Sec-Fetch-Dest` を送らない古いブラウザでは、デッキ内の共有 URL へのリンクは iframe の中で拒否され、移動しない。
- イベントとコミュニティを誰がどう登録するか。connpass の URL から読み取る、コミュニティの運営者が入力する、などの案がある。今は入力する画面がない。
- コミュニティとイベントのページ。今は名前が connpass など外部のページへのリンクになっている。イベントの全発表と全投稿を一覧するページは、投稿とスライドの紐づけを運営者が直す場所にもなる。
- 他サービスの player を開いた読者の IP アドレスは、そのサービスに伝わる。投稿の埋め込みと同じ論点。
- Speaker Deck の player の URL は、スライドの URL からは決まらない。登録時に oEmbed で調べる必要がある。
- 引用が 4 件を超えたときに、残りを見る画面。今は件数だけを示す。
- タイムラインの投稿が多いときの絞り込み。今は 200 件までを並べ、枠の中でスクロールする。
- 引用されたことを作者へ通知する方法。今は管理画面と viewer に出るだけ。
- 本番への反映。migration `0013_citations.sql`・`0014_reaction_posts.sql`・`0015_events.sql` を含むため、[本番に反映する](deploy.md)の手順に従う。
