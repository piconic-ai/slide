# 開発ガイド

利用者の行動と採用順は [ストーリーマップ](../story-mapping.canvas)、個別の利用場面はそこからリンクした feature を参照する。ここには開発手順と技術設計を置く。実装済みのアップロードを試す手順と、今後の設計案を分けて記載する。

| 文書 | 調べたいこと |
| --- | --- |
| [開発する](development.md) | 起動・ビルド・デプロイ、コンポーネントの調査、変更の確認 |
| [アップロードを試す](f01-local-slice.md) | 実装済みの送信・受領確認・プレビュー |
| [本番に反映する](deploy.md) | バックアップ、migration、deploy、反映後の確認と作業の分担 |
| [構成とデータ](design.md#architecture) | Workers・R2・D1 の役割と状態の持ち主 |
| [アップロードと公開](design.md#deployment) | OIDC、manifest、adapter、不変な版、公開競合 |
| [アップロードの実装設計とタスク](f01-github-deploy.md) | scope1 の F01 を API・状態・受信・再送の単位に分けて実装する |
| [公開管理の実装設計](f02-publication.md) | scope1 の F02 の公開状態、revision、CI の順序、作者の操作 |
| [アクセス制御](design.md#access-control) | HTML の隔離、下書き、販売、無料サンプル、TEAM |
| [決済と契約](design.md#billing) | Stripe、契約、購入権限、返金、タテブログとの接点 |
| [キャッシュ・運用・検証](design.md#operations) | 費用、削除、分析、障害、実装の確認方法 |
| [サービスの基本の備え](service-basics.md) | セキュリティヘッダー、robots.txt、リクエスト頻度の上限、エラーページ、メンテナンスなど、一般的な Web サービスとしての備え |

API 名・JSON・URL・コマンドは識別子として原表記を使う。説明文は日本語で書く。型や API を実装したら、設計例と実装が一致しているか確認する。
