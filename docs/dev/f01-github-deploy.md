# GitHub からのアップロード設計と実装タスク

Status: an initial private upload slice is implemented. See [the runnable slice and current gaps](f01-local-slice.md). The remainder below is the target design, not a claim of completion.

[利用場面](../features/f01-github-deploy.md)と[ストーリーマップ](../story-mapping.canvas)を前提とする。API 名とデータ構造は提案。

## 目的と範囲

勉強会の資料を作者の GitHub Actions から送り、どの commit の成果物が受領できたかを確認する。F01 の完了は「一般公開されていない、変更不能な ready deployment が作られた」こと。公開と閲覧は F02・F03 が担当する。

受け取るのはビルド済み HTML・JS・CSS・画像などの静的ファイルだけ。作者が選ぶビルド方法にサービスも公式 Action も介入しない。初期は設定した一人の GitHub account ID のみが利用する。

## 呼び出し側から見た流れ

1. 作者が GitHub でログインし、資料を作成して repository と許可 branch を結びつける。
2. 作者自身の CI が任意のビルドを完了する。
3. uploader が出力 directory を列挙し、相対 path・byte 数・SHA-256・media type を inventory にする。
4. Actions OIDC token を、資料と upload session に限定した credential に交換する。
5. uploader がファイルを順に送り、受領済みの同じファイルは再送時に再利用する。
6. 全件検証後に ready を返す。CLI は deployment ID、commit、状態確認 URL を表示する。
7. 作者が履歴で結果と失敗理由を確認する。F02 が ready の版を選び、限定公開や一般公開を開始する。

## データと責任

| データ | 保持する内容と所有する判断 |
| --- | --- |
| RepositoryBinding | deck、GitHub repository/owner ID、許可 ref、必要なら environment。表示名は認可に使わない |
| Deployment | deck、source SHA、run ID/attempt、inventory digest、entry、state、作成者と作成日時 |
| UploadSession | deployment、credential hash、有効期限、冪等キー、予約 byte 数、受信中 request の lease |
| UploadFile | session 内の正規化 path、期待 size/hash/type、選択された受領 object key、状態 |
| UploadAttempt | 一回の受信の識別子、lease、object key、実 byte 数、結果。失敗した object は公開しない |
| UploadQuota | 作者の使用量・予約量・開始回数・同時 session 数を一度の条件付き更新で管理 |

R2 は非公開。D1 が inventory と受領結果を持つ。初期は一資料一 upload session、一作者一実行に制限する。archive 展開や bucket credential の client への引き渡しはしない。

## API 案

| API | 認証と入力 | 結果 |
| --- | --- | --- |
| `POST /api/decks/:deck/repository` | browser session、repository ID、許可 ref | 管理権限を確認した連携情報 |
| `POST /api/decks/:deck/uploads` | GitHub OIDC、冪等キー、entry、inventory、任意 manifest | scoped credential、deployment ID、期限、送信対象一覧 |
| `PUT /api/uploads/:session/files/:fileId` | upload credential、ファイル bytes | 受領 receipt またはサイズ/hash 不一致 |
| `POST /api/uploads/:session/finalize` | upload credential | ready deployment または不足一覧・競合 |
| `GET /api/decks/:deck/deployments` | browser session、ページング | commit、状態、作成日時、失敗理由の履歴 |
| `GET /api/uploads/:session` | upload credential | 再開用の受領状態。browser 向けの詳細は所有者認証を使う |

API 名は提案。ファイルは URL の未検証 path でなく server が割り当てた fileId で受信する。公開 API、作者限定 content session、読者向け file route は F01 に含めない。

## 認証と入力検証

ブラウザは許可済み本人かを確認する。repository 登録は REST で管理権限を検証し、source write 権限を要求しない。repository 移転・所有者変更・権限喪失時は再連携まで送信を止める。

OIDC は署名・JWKS・issuer・専用 audience・期限・repository ID・owner ID・ref・event・設定された environment を検証する。pull request と `pull_request_target` を production 送信に使わせない。caller が送る commit・run 情報は claim と照合する。一般の `GITHUB_TOKEN` は当サービスの認証に使わない。

credential は一つの session に限定し、server には hash を保存する。全送信・状態取得・finalize で期限と失効、deck の所有関係を再検査する。upload session が有効なまま credential だけが期限切れになった場合は、fresh OIDC で本人・連携を再検証し、同じ session の credential を更新できる。session 自体が expired または failed になったら再開せず、新しい冪等キーで始める。期限延長だけで権限変更を迂回できない。

entry と inventory path は directory 内の相対 path のみ。絶対 path、`..`、曖昧な separator、正規化後重複、symlink、予約 path、秘密ファイル、サーバー実行形式を拒否する。media type は server 側の方針で決め、任意 response header を受け付けない。

未ビルド Markdown を entry にする要求は拒否する。任意 HTML によるページ認識や framework adapter は後続 scope とし、F01 は `index.html` と静的 file tree を最低限にする。

## 再送・競合・容量

同じ作者・deck・冪等キー・inventory digest なら同じ session を返す。異なる inventory で同じキーを使うと conflict。同一ファイルの受領済み hash と size が一致する再送は receipt を返す。再試行で回数 quota と予約容量を二重に消費しない。

開始時に一版・一ファイル・件数・作者合計・頻度・同時数を検査し、D1 で容量を予約する。使用量と別 session の予約を足して上限判定する。上限値は [本人利用から始める初期上限](design.md#initial-limits)を参照し、各 API に定数を散らさない。設定変更は次の session へ適用し、作成済み session は記録した制限で処理する。

API の metadata 本文、inventory 件数、path 長にも上限を設け、巨大 JSON を先に読み込まない。同じ session のファイル受信は D1 の条件付き lease で一件ずつに制限し、同時に多数の buffer を作れないようにする。

Content-Length だけでは信用せず、受信 chunk ごとに累積 byte 数を数える。宣言 size または上限を超えた時点で読み取りを中止する。初期の小さい一ファイル上限なら bounded buffer と WebCrypto digest を使える。無制限の全件メモリ読み込みはしない。R2 への完全 streaming 化は必要になった時点で検討する。

受信 attempt は固有 object key を使う。D1 の条件付き更新で現在の lease と session state が一致する attempt だけを receipt として採用する。遅れて完了した attempt や R2 成功後に D1 更新が失敗した object は orphan とし、後続で清掃する。

finalize は `uploading -> validating` を条件付き更新し、新規ファイル受信を止める。受信中の lease があれば conflict か再試行可能な状態を返す。全件の size/hash、entry、manifest を検査し、不変 file map と deployment を ready にする。R2 は attempt ごとの object を保持し、確定 file map が正しい object key を選ぶ。最終化時の障害は検証 lease の期限と再試行で復旧し、validating のまま永久に残さない。ready の確定と同じ D1 トランザクションで、予約容量を使用量へ一度だけ振り替え、同時 session 枠を解放する。同じ finalize の再送は同じ結果を返し、使用量を二重加算しない。

## 状態と失敗

```text
uploading -> validating -> ready
uploading -> expired
uploading / validating -> failed
```

不足ファイルによる finalize は不足一覧を返し、uploading へ戻して再送可能にする。致命的な manifest 不正は failed。ready 後の上書き・追記は拒否する。期限切れと失敗の予約容量は解放するが、受信済み object の削除と D1 の accounting は再送しても収束させる。

F01 は deck の公開 pointer を一切変更しない。失敗・古い CI・finalize 再送で公開済み資料が変わらない。公開順序や公開停止との競合判定は F02 で ready の後に行う。

## 実装タスク

| 順序 | タスク | 完了条件 |
| --- | --- | --- |
| 1 | D1/R2 binding、migration、運用設定 | 非公開 bucket を使い、本人 allowlist と容量設定が local で読み取れる。無料・PRO の契約は不要 |
| 2 | 本人ログインと repository 連携 | 本人だけが登録でき、管理権限のない repository と未許可 ref は拒否される |
| 3 | inventory の schema と正規化 | 正常 tree と entry を受け付け、traversal・重複・秘密ファイル・超過 inventory を実行前に拒否する |
| 4 | OIDC 検証と session 作成 | claim 不一致・期限切れ・PR を拒否し、正しい token で scoped credential と予約を一度だけ作る |
| 5 | byte 受信と receipt | 超過・hash 不一致・切断で成功 receipt を作らず、正常ファイルを受領し、同じ再送で同じ結果を返す |
| 6 | finalize と不変 deployment | 不足時に再送でき、完了時に ready を一度だけ作り、ready 後は変更できない |
| 7 | uploader と Action の入口 | ビルドせず directory を列挙・送信し、再実行で再開でき、commit と ready ID を出力する |
| 8 | 履歴と失敗表示 | 本人が commit、state、不足/超過理由を確認でき、他人には状態を漏らさない |
| 9 | expiry・予約解放・orphan 清掃 | 中断後の再試行・期限切れ・清掃の重複で容量が増減しすぎず、ready を削除しない |
| 10 | 二つの静的サンプルで縦断確認 | チェックイン HTML と作者が Markdown から作った成果物を同じ方法で ready にし、一般公開は変わらない |

タスク1〜3、4〜6、7〜8、9〜10 を、それぞれ完了を確認できる単位として順に進める。client の再送前提は server の状態とエラー形式が決まってから実装する。

## scope1 の残りとの境界

F02 は ready deployment の作者限定閲覧、手動公開、repository モードの公開切替、停止、rollback を持つ。F03 は公開 URL の解決、別 origin の HTML、相対 asset、認可後 cache を持つ。

scope1 全体の完了は F01 の ready だけではなく、作者が確認して公開し、匿名読者が URL で読め、停止後に旧 asset URL から取得できないところまで。課金、OGP 撮影、翻訳、音声、TEAM、二画面発表は scope1 に入れない。

## 実装前に決めること

- 非公開 repository の管理権限を確認する GitHub 認証方式。ソースの書き込み権限を含む広い OAuth scope を安易に要求しない。本人利用の初期設定で repository ID と許可 ref を事前登録する方式と、read-only の GitHub App を使う方式を比較し、タスク2で決定する。
- upload session と credential の有効期間、受信・検証 lease の期間。作者限定で発表する content session の期間とは別物として扱う。
- 正規化 path と許可する media type、秘密ファイルの拒否規則、inventory 本文の上限。
- uploader をこの repository から配布する方法と、GitHub Action の配置・version 管理。最初は同じ uploader を手元と Actions の両方から動かし、別実装を作らない。

実装の確認では正常 upload だけでなく、長さを偽る request、hash 不一致、同時開始、同じファイルの同時再送、R2 成功後の D1 失敗、finalize 中の中断、credential の更新、期限切れ清掃の再実行を扱う。F01 の完了は ready と履歴で確認し、公開・閲覧の完成とは区別する。
