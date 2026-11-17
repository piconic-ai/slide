# 機能の対応表

機能ごとに、入口、操作、動いたと言える結果を書く。仕様は [docs/features/](../../../../docs/features/) が正本で、ここには確かめ方だけを置く。機能を足したり入口を変えたりした PR は、同じ PR でこの表を直す。

`$O` は `http://localhost:8811` のように起動した origin を指す。

| 機能 | 入口 | 操作 | 動いたと言える結果 |
| --- | --- | --- | --- |
| [URL を渡して読んでもらう](../../../../docs/features/f03-sharing.md) | `$O/@kfly8/try-static`(匿名) | 開く | 200。`#deck` の iframe にスライドが出る。Chromium で console のエラーと失敗した request がない |
| 同上(ページの追従) | `$O/@kfly8/try-static/2` | 開く。スライドの中で矢印キーを押す | iframe の URL が `#2` で始まる。めくると、アドレスバーとコピー用の URL のページ番号が変わる(スライドがページを伝える場合) |
| [作者のみ限定公開で発表し、一般公開する](../../../../docs/features/f02-publication.md) | `$O/slides/try-static`(作者) | 「公開を停止する」を押す | D1 の `decks.paused_at` が入る。匿名で `$O/@kfly8/try-static` を開くと 404 |
| 同上(未ログイン) | `$O/slides`(匿名) | 開く | 401 とログインの画面 |
| [GitHub からスライドを更新する](../../../../docs/features/f01-github-deploy.md) | データを入れるコマンド(実際の uploader を通る) | 実行する | 2 つのスライドが ready になり、共有 URL が 200 になる。OIDC の実物は通らない |
| [知らない人のスライドも、安心して開ける](../../../../docs/features/f17-safe-viewing.md) | `$O/help`、`$O/@kfly8/try-static` | 開く。スライドの応答ヘッダーを見る | ヘルプに「できないこと」「できること」「気をつけること」の見出しがある。スライドの応答に `sandbox` と `frame-ancestors` の CSP が付く |
| 同上(運営による非表示) | `$O/slides/try-static`(作者)、`$O/@kfly8/try-static`(匿名) | 手元の D1 で `UPDATE decks SET hidden_at = 1, hidden_reason = '確認', hidden_by = 'local' WHERE id = 'try-static'` を実行してから開く | 作者の画面に「運営がこのスライドを非表示にしています。」と理由が出る。共有 URL は 404。運営の画面は、Cloudflare Access の token が要るので、ローカルでは開けない([運営による非表示の実装設計](../../../../docs/dev/f17-takedown.md#運営だけに開く)) |
| 画面の言語 | `$O/slides/try-static`(作者) | `SLIDE_LOCALE=en-US` と `ja-JP` で開く | 題名と文言が、それぞれ英語と日本語になる |

## 注意

- データを入れ直すと、スライドの deployment が増える。件数を根拠にするときは、置き場を作り直す。
- Firefox は、管理画面で favicon の読み込みを CSP が止めたと console に出す(既知、#79)。この 1 件は失敗に数えない。
- Firefox と WebKit は、viewer で `postMessage` の送り先の origin が合わないと console に出す。Firefox は、デモのイベントが埋め込む外部の player の cookie についても出す。原因は調べていない。viewer の console を根拠にするときは Chromium で確かめ、ほかの engine ではこの 2 種類を除いて数える。
- `scripts/verify-upload.mjs` は既定の置き場(`.wrangler/state`)を使うので、`launch.sh` で起動した Worker には使えない。使い方は [アップロードの確認手順](../../../../docs/dev/f01-local-slice.md#ローカルで確認する) に従う。
