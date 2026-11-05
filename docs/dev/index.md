# 開発者向け設計

利用者の行動と採用順は [ストーリーマップ](../story-mapping.canvas)、個別の利用場面はそこからリンクした feature を参照する。ここには、それらを成立させる責務、データ、認証、配信、運用を置く。すべて設計案であり、未実装。

| 文書 | 調べたいこと |
| --- | --- |
| [構成とデータ](design.md#architecture) | Workers・R2・D1 の役割と状態の持ち主 |
| [アップロードと公開](design.md#deployment) | OIDC、manifest、adapter、不変な版、公開競合 |
| [アクセス制御](design.md#access-control) | HTML の隔離、下書き、販売、無料サンプル、TEAM |
| [決済と契約](design.md#billing) | Stripe、契約、購入権限、返金、タテブログとの接点 |
| [キャッシュ・運用・検証](design.md#operations) | 費用、削除、分析、障害、実装の確認方法 |

API 名・JSON・URL・コマンドは識別子として原表記を使う。説明文は日本語で書く。型や API を実装したら、設計例と実装が一致しているか確認する。
