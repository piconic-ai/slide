# Changelog

## [v0.4.4](https://github.com/piconic-ai/slide/compare/v0.4.3...v0.4.4) - 2026-11-27

- ヘルプの記事の、事実と違う記述を直す(埋め込み、メールアドレス、Gravatar) by @kfly8 in https://github.com/piconic-ai/slide/pull/670
- 運営の入口の pass の書き方を 1 通りにする by @kfly8 in https://github.com/piconic-ai/slide/pull/674
- ヘルプの記事: 公開前の読み直しの指摘を直す(#672 の C) by @kfly8 in https://github.com/piconic-ai/slide/pull/677
- 差し替え・下見のあと、古い保存した版を消す(F37-AC21) by @kfly8 in https://github.com/piconic-ai/slide/pull/678
- バックアップのバケットを UPLOADS_BACKUP に結ぶ(バケットを作ってから merge) by @kfly8 in https://github.com/piconic-ai/slide/pull/669
- ヘルプ: メールアドレスの変更で、運営が本人確認をすることを書く(#672 の 5) by @kfly8 in https://github.com/piconic-ai/slide/pull/680
- メンテナンスの手順に until を必須にし、受け入れた危険を記録する(#673) by @kfly8 in https://github.com/piconic-ai/slide/pull/676
- ヘルプ: スライドを削除する記事を足す(#672 の 3) by @kfly8 in https://github.com/piconic-ai/slide/pull/681
- 保存した版: viewer の開始時にも消す予定を消す(#671 の指摘 2 から 7) by @kfly8 in https://github.com/piconic-ai/slide/pull/682
- 招待制を外したときの決定を、仕様に書く(F17-AC41〜43、F42、F28) by @kfly8 in https://github.com/piconic-ai/slide/pull/679

## [v0.4.3](https://github.com/piconic-ai/slide/compare/v0.4.2...v0.4.3) - 2026-11-27

- 利用規約とプライバシーポリシーを、2026-11-27 制定の初版にする(丁寧語、誤字、施行日) by @kfly8 in https://github.com/piconic-ai/slide/pull/659

## [v0.4.2](https://github.com/piconic-ai/slide/compare/v0.4.1...v0.4.2) - 2026-11-27

- 計測の集計が Workers で失敗する不具合を直す(redirect: 'error' は使えない) by @kfly8 in https://github.com/piconic-ai/slide/pull/664
- 計測の確認手順を直す(SELECT DISTINCT、キーチェーン、参照元、タイムラインの確かめ方) by @kfly8 in https://github.com/piconic-ai/slide/pull/665
- フォローされているときに表示し、ボタンをフォローバックにする by @kfly8 in https://github.com/piconic-ai/slide/pull/663

## [v0.4.1](https://github.com/piconic-ai/slide/compare/v0.4.0...v0.4.1) - 2026-11-26

- docs: タイムラインのスライドを、カードの中でめくれるようにする仕様(F44-AC27〜30、F25-AC12) by @kfly8 in https://github.com/piconic-ai/slide/pull/648
- 初回のリリースの結果を記録する(deploy.md) by @kfly8 in https://github.com/piconic-ai/slide/pull/647
- docs: 埋め込みの合図を ?t=compact にし、タイムラインの記録と CSP を仕様に決める by @kfly8 in https://github.com/piconic-ai/slide/pull/653
- 初回のリリースの記録の誤りを直す(成功の run は通知を送らない) by @kfly8 in https://github.com/piconic-ai/slide/pull/652
- 手で反映する例外(移行前の手順)を外す by @kfly8 in https://github.com/piconic-ai/slide/pull/654
- Monitors のアラートを実際の構成に合わせて書き、メンテナンス中の 5xx の通知を記す by @kfly8 in https://github.com/piconic-ai/slide/pull/657
- feat: 埋め込みに、下の行のない形(?t=compact)を足す by @kfly8 in https://github.com/piconic-ai/slide/pull/655
- スライド管理の枠のヘルプを ? マークにし、関連リンクの種類を URL だけで決める by @kfly8 in https://github.com/piconic-ai/slide/pull/656
- feat: タイムラインのカードを、表紙を押すとその中でめくれるようにする by @kfly8 in https://github.com/piconic-ai/slide/pull/660
- スマホの viewer で全画面ボタンを出す(F03-AC183) by @kfly8 in https://github.com/piconic-ai/slide/pull/658

## [v0.4.0](https://github.com/piconic-ai/slide/compare/v0.3.0...v0.4.0) - 2026-11-26

- 第四スコープ P0: 仕様を書く(F34〜F42) by @kfly8 in https://github.com/piconic-ai/slide/pull/504
- 準備: 第四スコープの置き場(運営の計測・運用、書き出しの枠、cron の登録、通知の型) by @kfly8 in https://github.com/piconic-ai/slide/pull/511
- 規約のページ(1/3): 文面を持ち、ページとして描く(F34) by @kfly8 in https://github.com/piconic-ai/slide/pull/535
- 規約のページ(2/3): 3 つのページを経路につなぎ、フッターに運営者(F34) by @kfly8 in https://github.com/piconic-ai/slide/pull/536
- 規約のページ(3/3): 仮の文面を外し、PR のテンプレートに確認の欄(F34) by @kfly8 in https://github.com/piconic-ai/slide/pull/537
- デプロイ: リリース PR を merge したときだけ本番に反映する(第四スコープ D) by @kfly8 in https://github.com/piconic-ai/slide/pull/542
- 書き出し: 画面から自分のスライド・記事・アカウントの情報を書き出す(第四スコープ E) by @kfly8 in https://github.com/piconic-ai/slide/pull/545
- 監視と通知 1/5: 通知を送る口(すぐ)と設計(F39、作業 M) by @kfly8 in https://github.com/piconic-ai/slide/pull/518
- 監視と通知 2/5: 翌日のメールと cron のログの形(F39、作業 M) by @kfly8 in https://github.com/piconic-ai/slide/pull/519
- 監視と通知 3/5: 数える通知・D1 の大きさ・アラート用のログ(F39、作業 M) by @kfly8 in https://github.com/piconic-ai/slide/pull/520
- 監視と通知 4/5: 見張りの Worker(F39、作業 M) by @kfly8 in https://github.com/piconic-ai/slide/pull/521
- 監視と通知 5/5: 運営の画面の「通知」の枠と手順(F39、作業 M) by @kfly8 in https://github.com/piconic-ai/slide/pull/523
- 監視と通知 6/6: セキュリティのレビューの指摘の修正(F39、作業 M) by @kfly8 in https://github.com/piconic-ai/slide/pull/538
- ヘルプの枠(1/2): 記事の仕組み、42 の記事への移し替え、検索の処理(scope4 H1) by @kfly8 in https://github.com/piconic-ai/slide/pull/528
- ヘルプの枠(2/2): 3 段のページと検索、リンクの直し、古いヘルプの削除(scope4 H1) by @kfly8 in https://github.com/piconic-ai/slide/pull/539
- メールアドレスの暗号化 1/4: 設計、migration、暗号と検索用の値(作業 C) by @kfly8 in https://github.com/piconic-ai/slide/pull/547
- メールアドレスの暗号化 2/4: Better Auth のアダプターの境(作業 C) by @kfly8 in https://github.com/piconic-ai/slide/pull/548
- メールアドレスの暗号化 3/4: 招待・ログイン・送信箱・設定の読み書き(作業 C) by @kfly8 in https://github.com/piconic-ai/slide/pull/550
- メールアドレスの暗号化 4/4: 書き換えと運営の画面の枠(作業 C) by @kfly8 in https://github.com/piconic-ai/slide/pull/551
- メールアドレスの暗号化 5/5: セキュリティのレビューの指摘(作業 C) by @kfly8 in https://github.com/piconic-ai/slide/pull/558
- バックアップ(1/3): 設計、表、新しいファイルを写して続きから再開する(scope4 B) by @kfly8 in https://github.com/piconic-ai/slide/pull/556
- バックアップ(2/3): 消されたものの 30 日、失敗の通知、運営の画面の枠(scope4 B) by @kfly8 in https://github.com/piconic-ai/slide/pull/561
- バックアップ(3/3): バケットの作り方と戻し方の手順(scope4 B) by @kfly8 in https://github.com/piconic-ai/slide/pull/562
- AI エージェントからの書き出し(1/3): 設計と、許可の範囲と画面(F23-AC46) by @kfly8 in https://github.com/piconic-ai/slide/pull/553
- AI エージェントからの書き出し(2/3): export_account、記事の足し、古い接続の答え(F35-AC32, AC42, F23-AC47〜49, AC51) by @kfly8 in https://github.com/piconic-ai/slide/pull/559
- AI エージェントからの書き出し(3/3): get_slide_files と取り出すための URL(F35-AC33〜AC41, F23-AC50) by @kfly8 in https://github.com/piconic-ai/slide/pull/569
- AI エージェントからの書き出し(4/4): セキュリティのレビューの指摘(メール暗号、同意の範囲、版ごとの判定、残るリスク) by @kfly8 in https://github.com/piconic-ai/slide/pull/573
- メンテナンスの値の形、メンテナンス中のページと印、読めるページ(scope4 N 1/4) by @kfly8 in https://github.com/piconic-ai/slide/pull/557
- メンテナンスの予告: 運営の画面の枠と、全ページの帯(scope4 N 2/4) by @kfly8 in https://github.com/piconic-ai/slide/pull/563
- メンテナンス中も運営が管理 origin を開ける入口(scope4 N 3/4) by @kfly8 in https://github.com/piconic-ai/slide/pull/568
- 見張りの Worker のメンテナンスの扱いと、メンテナンスの手順(scope4 N 4/4) by @kfly8 in https://github.com/piconic-ai/slide/pull/571
- メンテナンスの帯の読みの時間切れと競合、止める値の文書(scope4 N 5/5) by @kfly8 in https://github.com/piconic-ai/slide/pull/574
- 計測 1/3: 設計、記録の口、各経路への記録(F40、作業 A) by @kfly8 in https://github.com/piconic-ai/slide/pull/576
- 計測 2/3: 日ごとの集計を Analytics Engine から D1 へ写す(F40、作業 A) by @kfly8 in https://github.com/piconic-ai/slide/pull/578
- 計測 3/3: 運営の画面の「計測」(週ごとの表と CSV)(F40、作業 A) by @kfly8 in https://github.com/piconic-ai/slide/pull/579
- スケールとコスト 1/3: 単価・1 回あたりの数・費用の式(作業 S) by @kfly8 in https://github.com/piconic-ai/slide/pull/570
- スケールとコスト 2/3: 試験の台本と手順(作業 S) by @kfly8 in https://github.com/piconic-ai/slide/pull/572
- スケールとコスト 3/3: 索引と乗り換えの合図(作業 S) by @kfly8 in https://github.com/piconic-ai/slide/pull/580
- 招待なしで登録できる設定(OPEN_SIGNUP)と、招待制を前提にした文言の切り替え(F42 1/4) by @kfly8 in https://github.com/piconic-ai/slide/pull/582
- ログインのメールの全体の上限と、登録の急増の通知(F42 2/4) by @kfly8 in https://github.com/piconic-ai/slide/pull/583
- 運営の画面から新しい登録を止める・再開する(F42 3/4) by @kfly8 in https://github.com/piconic-ai/slide/pull/584
- 新しい登録者の置く量と、招待制を外す手順(F42 4/4。F42-AC17/18 は保留) by @kfly8 in https://github.com/piconic-ai/slide/pull/585
- セキュリティのレビューの対応: 既知の危険と限界を書き、保留を印にする(F42 5/5) by @kfly8 in https://github.com/piconic-ai/slide/pull/586
- ヘルプの記事: 書き出し、AI エージェント、メンテナンス、規約の記事を足す(scope4 H2 1/3) by @kfly8 in https://github.com/piconic-ai/slide/pull/588
- ヘルプの記事: 画面と断りの場所から記事へつなぐ、登録の記事(scope4 H2 2/3) by @kfly8 in https://github.com/piconic-ai/slide/pull/591
- ヘルプの記事: 最初の 1 文の見直しと、検索の目当ての語 20 個(scope4 H2 3/3) by @kfly8 in https://github.com/piconic-ai/slide/pull/592
- 一度開いたスライドを手元に残す(1/4): 別サイトの枠での試験(D-95)と設計 by @kfly8 in https://github.com/piconic-ai/slide/pull/565
- 一度開いたスライドを手元に残す(2/4): 版の Service Worker と配信の CSP by @kfly8 in https://github.com/piconic-ai/slide/pull/575
- 一度開いたスライドを手元に残す(3/4): viewer の殻、1 日と 20 本、帯 by @kfly8 in https://github.com/piconic-ai/slide/pull/589
- 一度開いたスライドを手元に残す(4/4): メンテナンスの確認と応答の速さ by @kfly8 in https://github.com/piconic-ai/slide/pull/590
- 一度開いたスライドを手元に残す(5/5): セキュリティのレビューの指摘を直す by @kfly8 in https://github.com/piconic-ai/slide/pull/593
- ヘルプの記事: 保存した版の記事と、帯からのリンク(scope4 H2 4) by @kfly8 in https://github.com/piconic-ai/slide/pull/594
- 第四スコープの統合(そろえる 1/2): migration の番号、経路、外した設定、漏れのテスト by @kfly8 in https://github.com/piconic-ai/slide/pull/596
- 第四スコープの統合(そろえる 2/2): 統合の記録、deploy.md の節、人の確認と決めてほしいこと by @kfly8 in https://github.com/piconic-ai/slide/pull/598
- scope4 に origin/main を取り込む(最後の取り込み、D-01) by @kfly8 in https://github.com/piconic-ai/slide/pull/601
- 第四スコープの 16 画面を撮る(Z2a): デモ用データのスクリプトと比較 by @kfly8 in https://github.com/piconic-ai/slide/pull/606
- 第四スコープ: 通しの確認 1〜16 の結果と、確認で見つけた不具合の修正(Z2b) by @kfly8 in https://github.com/piconic-ai/slide/pull/607
- scope4 の CI の失敗を直す(per-use の表、古いテストの前提、flake、cccc) by @kfly8 in https://github.com/piconic-ai/slide/pull/608
- scope4 の CI の失敗を直す 2(ヘルプの記事の言葉、hook の時間切れ) by @kfly8 in https://github.com/piconic-ai/slide/pull/610
- scope4 の CI の失敗を直す 3(Firefox の Cookie の検査の再実行、shard 6 の停止への上限) by @kfly8 in https://github.com/piconic-ai/slide/pull/612
- 仕様: メールアドレスに触れる場所を限る(F43) by @kfly8 in https://github.com/piconic-ai/slide/pull/617
- メールアドレスの暗号化(作業 C)を、仕組みごと外す by @kfly8 in https://github.com/piconic-ai/slide/pull/618
- メールアドレスに触れる場所を宣言し、テストで守る(F43 1/3: 宣言と守りのテスト) by @kfly8 in https://github.com/piconic-ai/slide/pull/622
- メールアドレスに触れる場所を宣言し、テストで守る(F43 2/3: ヘルプの記事と試験のアドレス) by @kfly8 in https://github.com/piconic-ai/slide/pull/623
- メールアドレスに触れる場所を宣言し、テストで守る(F43 3/3: 表を除く書き出しと決まり) by @kfly8 in https://github.com/piconic-ai/slide/pull/624
- scope4: main の 0059 を取り込み、第四スコープの migration を 0060〜0068 に付け直す by @kfly8 in https://github.com/piconic-ai/slide/pull/625
- 新しいスライドの上限を直近 24 時間で数える(F42-AC17、AC18、F36-AC37) by @kfly8 in https://github.com/piconic-ai/slide/pull/630
- scope4: main の 0060・0061 を取り込み、第四スコープの migration を 0062〜0070 に付け直す by @kfly8 in https://github.com/piconic-ai/slide/pull/631
- ログインのメールの全体の上限を既定で無効にする(F42-AC25〜AC29) by @kfly8 in https://github.com/piconic-ai/slide/pull/632
- 第四スコープの横断レビューの指摘を直す(新しい人の上限、反映前の確認、古い URL) by @kfly8 in https://github.com/piconic-ai/slide/pull/633
- ドロップのテストの下準備を、数える条件に合わせる(新しい人の上限) by @kfly8 in https://github.com/piconic-ai/slide/pull/635
- 第四スコープ: 安心して使い続けられる状態にする by @kfly8 in https://github.com/piconic-ai/slide/pull/602
- Settle the other-site link test in the router browser tests by @kfly8 in https://github.com/piconic-ai/slide/pull/636
- フッターから運営者の表示を外す by @kfly8 in https://github.com/piconic-ai/slide/pull/641
- Wait for the deck to load in the F03-AC71 test by @kfly8 in https://github.com/piconic-ai/slide/pull/644
- トップを 1 本のタイムラインにする(仕様 F44) by @kfly8 in https://github.com/piconic-ai/slide/pull/640
- トップを「すべて」「フォロー」の 1 本のタイムラインにする(実装 F44) by @kfly8 in https://github.com/piconic-ai/slide/pull/643
