# 公開管理の実装設計

[作者のみ限定公開で確認し、一般公開する](../features/f02-publication.md) を scope1 で実装するための契約。全体の方針は [公開の競合](design.md#公開の競合) と [作者のみ限定公開](design.md#作者のみ限定公開) を参照する。

## 公開状態

アップロード状態（deployment の `state`）と公開状態（deck の列）を分ける。F01 の `ready` 確定だけでは公開状態は変わらない。

| 状態 | 保存する列 | 匿名配信 |
| --- | --- | --- |
| 下書き `draft` | `public_deployment_id` と `paused_at` が NULL | しない |
| 一般公開 `public` | `public_deployment_id` に一つの deployment | その deployment だけ |
| 停止 `paused` | `paused_at` と、再開で戻す `resume_deployment_id`（任意） | しない |

`public_deployment_id` は一般公開中だけ値を持つ。配信の認可はこの列だけで判断でき、停止中に公開 pointer が残って漏れることはない。版ごとの配信許可はこの pointer から導出する。版を置き換えると旧版の匿名配信は止まる。購入者向けの現行版は後続 scope で別の列として持つ。

型は `src/publication/state.ts` の `Publication` で表し、矛盾する組み合わせは D1 の CHECK 制約と `parseDeckPublication` の両方で拒否する。

## revision と CI の順序

| 値 | 意味 |
| --- | --- |
| `decks.revision` | 公開状態・モードが変わるたびに 1 進む。作者の操作は表示時の revision を送り、一致したときだけ反映する |
| `decks.author_revision` | 最後の作者操作の revision。CI はこれより前に開始していれば反映しない |
| `decks.ci_run_id`・`ci_run_attempt` | repository モードで最後に公開を変えた GitHub Actions の run。run ID は repository ごとに増えるので、run ID・attempt の順で新旧を比べる |
| `deployments.start_revision` | アップロード開始時の deck の revision。開始の INSERT と同じ文で読む |
| `deployments.publish_intent` | workflow が求めた公開。`published`・`unpublished`・NULL（指定なし） |

作者の操作と CI の反映をどちらが優先するかは、後続の PR で遷移の純粋関数として定める。

## 未決事項

- launch token の有効期間（設計案は 60 秒）、閲覧セッションの有効期間・更新・再認証の方式。
- 公開 API と競合時の応答形式。

これらは各操作を実装する PR で確定し、この文書に追記する。
