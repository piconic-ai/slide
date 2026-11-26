# データベースの ER 図

生成物。手で編集しない。`pnpm db:er` で生成し直す。

`migrations/` を空の SQLite に順に適用した結果から作る。本番の D1 に適用されるものが正本で、`src/db/schema.ts` は読まない。外部キーを宣言している参照だけを線で結ぶ。宣言のない参照(たとえば `owner_user_id`)は、列として図に出るだけで、線にはならない。

## 読み方

- 列の `PK` は主キー、`FK` は外部キー、`UK` は UNIQUE。複数の列で一意になるものは、備考に `unique: a + b` と出る。`CHECK` は、その列を CHECK 制約が参照している。
- 線の `||` は必ず 1、`|o` は 0 または 1(参照する列が NULL を許す)、`o{` は 0 以上、`o|` は 0 または 1(参照する列が一意)。線の名前は、参照する列。
- 別の図の表を参照するときは、その表を列なしで描く。部分的な UNIQUE(`WHERE` つきの索引)は一意として数えない。

## 全体の関係

全ての表と、宣言した外部キーだけ。列は各ドメインの図にある。

```mermaid
erDiagram
    accounts
    alert_signals
    alerts
    article_citations
    articles
    auth_account
    auth_session
    auth_user
    auth_verification
    backup_objects
    backup_state
    blocks
    citations
    communities
    community_admins
    community_feed_events
    community_follows
    community_links
    content_sessions
    decks
    deployments
    events
    follows
    handles
    invited_emails
    login_code_requests
    luma_feed_gate
    luma_feeds
    mail_outbox
    maintenance_notice
    mcp_clients
    mcp_codes
    mcp_grants
    metric_daily
    metric_days
    mutes
    notification_opt_outs
    notifications
    picture_removals
    preview_launches
    profile_links
    profile_pictures
    profiles
    purged_prefixes
    related_link_events
    related_links
    released_handles
    reports
    signup_pause_events
    suspensions
    upload_files
    decks ||--o{ article_citations : "deck_id"
    decks ||--o| articles : "deck_id"
    auth_user ||--o{ auth_account : "user_id"
    auth_user ||--o{ auth_session : "user_id"
    deployments ||--o{ citations : "deployment_id"
    communities ||--o{ community_admins : "community_id"
    community_links ||--o{ community_feed_events : "link_id"
    communities ||--o{ community_follows : "community_id"
    communities ||--o{ community_links : "community_id"
    deployments ||--o{ content_sessions : "deployment_id"
    deployments |o--o{ decks : "resume_deployment_id"
    deployments |o--o{ decks : "public_deployment_id"
    decks |o--o{ deployments : "deck_id"
    accounts ||--o{ mcp_codes : "owner_user_id"
    mcp_clients ||--o{ mcp_codes : "client_id"
    accounts ||--o{ mcp_grants : "owner_user_id"
    mcp_clients ||--o{ mcp_grants : "client_id"
    deployments ||--o{ preview_launches : "deployment_id"
    events ||--o{ related_link_events : "event_id"
    related_links ||--o| related_link_events : "link_id"
    decks ||--o{ related_links : "deck_id"
    decks ||--o{ reports : "deck_id"
    deployments ||--o{ upload_files : "deployment_id"
```

## 認証と利用者

メールのコードでのログイン、Better Auth の利用者とセッション、招待、作者のアカウント、人とコミュニティが分け合うハンドル。

表: `accounts`、`handles`、`released_handles`、`auth_user`、`auth_account`、`auth_session`、`auth_verification`、`invited_emails`、`login_code_requests`、`mail_outbox`、`signup_pause_events`

```mermaid
erDiagram
    accounts {
        TEXT user_id PK
        TEXT handle UK "CHECK"
        INTEGER created_at
        INTEGER terms_accepted_at
    }
    auth_account {
        TEXT id PK
        TEXT account_id UK "unique: provider_id + account_id"
        TEXT provider_id UK "unique: provider_id + account_id"
        TEXT user_id FK
        TEXT access_token
        TEXT refresh_token
        TEXT id_token
        INTEGER access_token_expires_at
        INTEGER refresh_token_expires_at
        TEXT scope
        TEXT password
        INTEGER created_at
        INTEGER updated_at
    }
    auth_session {
        TEXT id PK
        TEXT token UK
        TEXT user_id FK
        INTEGER expires_at
        INTEGER created_at
        INTEGER updated_at
        TEXT ip_address
        TEXT user_agent
        TEXT device
    }
    auth_user {
        TEXT id PK
        TEXT name
        TEXT email UK
        INTEGER email_verified
        TEXT image
        INTEGER created_at
        INTEGER updated_at
    }
    auth_verification {
        TEXT id PK
        TEXT identifier
        TEXT value
        INTEGER expires_at
        INTEGER created_at
        INTEGER updated_at
    }
    handles {
        TEXT handle PK "CHECK"
        TEXT owner_kind UK "unique: owner_kind + owner_id; CHECK"
        TEXT owner_id UK "unique: owner_kind + owner_id"
        INTEGER created_at
    }
    invited_emails {
        TEXT email PK "CHECK"
        INTEGER invited_at
        TEXT invited_by "CHECK"
    }
    login_code_requests {
        TEXT id PK
        TEXT kind "CHECK"
        TEXT address_hash
        TEXT source_hash
        INTEGER requested_at
    }
    mail_outbox {
        TEXT id PK
        TEXT to_address
        TEXT subject
        TEXT body
        INTEGER created_at
    }
    released_handles {
        TEXT handle PK
        INTEGER released_at
        TEXT moved_to_kind "CHECK"
        TEXT moved_to_id "CHECK"
    }
    signup_pause_events {
        INTEGER id PK
        INTEGER paused "CHECK"
        INTEGER changed_at
        TEXT changed_by "CHECK"
    }
    auth_user ||--o{ auth_account : "user_id"
    auth_user ||--o{ auth_session : "user_id"
```

## AI エージェントの接続

MCP の OAuth クライアント、認可コード、許可の記録。

表: `mcp_clients`、`mcp_codes`、`mcp_grants`

```mermaid
erDiagram
    mcp_clients {
        TEXT id PK
        TEXT name
        TEXT redirect_uris
        INTEGER created_at
        INTEGER used_at
    }
    mcp_codes {
        TEXT code_hash PK
        TEXT client_id FK
        TEXT owner_user_id FK
        TEXT redirect_uri
        TEXT code_challenge
        INTEGER expires_at
        TEXT scope
    }
    mcp_grants {
        TEXT id PK
        TEXT client_id FK
        TEXT owner_user_id FK
        TEXT access_token_hash UK
        INTEGER access_expires_at
        TEXT refresh_token_hash UK
        INTEGER refresh_expires_at
        INTEGER created_at
        INTEGER last_used_at
        TEXT scope
    }
    accounts
    accounts ||--o{ mcp_codes : "owner_user_id"
    mcp_clients ||--o{ mcp_codes : "client_id"
    accounts ||--o{ mcp_grants : "owner_user_id"
    mcp_clients ||--o{ mcp_grants : "client_id"
```

## スライドと版

スライド(decks)、置かれた版(deployments)、受け取り中のセッションとファイル、プレビュー。

表: `decks`、`deployments`、`content_sessions`、`upload_files`、`preview_launches`、`purged_prefixes`

```mermaid
erDiagram
    content_sessions {
        TEXT token_hash PK
        TEXT deployment_id FK
        TEXT owner_user_id
        INTEGER created_at "CHECK"
        INTEGER expires_at "CHECK"
        INTEGER hard_expires_at "CHECK"
    }
    decks {
        TEXT id PK
        TEXT owner_user_id UK "unique: owner_user_id + slug"
        INTEGER created_at
        INTEGER paused_at "CHECK"
        TEXT public_deployment_id FK "CHECK"
        TEXT resume_deployment_id FK "CHECK"
        INTEGER revision "CHECK"
        TEXT change_id
        INTEGER deleted_at "CHECK"
        INTEGER hidden_at
        TEXT hidden_reason "CHECK"
        TEXT hidden_by "CHECK"
        TEXT slug UK "unique: owner_user_id + slug"
        INTEGER first_published_at
    }
    deployments {
        TEXT id PK
        TEXT idempotency_key UK
        TEXT inventory_digest
        TEXT state "CHECK"
        INTEGER total_bytes
        TEXT token_hash
        INTEGER created_at
        INTEGER expires_at
        INTEGER credential_expires_at
        TEXT lease_id
        INTEGER lease_until
        INTEGER ready_at "CHECK"
        TEXT failure_reason "CHECK"
        INTEGER swept_at
        INTEGER sweep_after
        TEXT deck_id FK
        TEXT title "CHECK"
        TEXT description "CHECK"
        TEXT cover_path "CHECK"
        TEXT source "CHECK"
    }
    preview_launches {
        TEXT token_hash PK
        TEXT deployment_id FK
        TEXT owner_user_id
        INTEGER created_at "CHECK"
        INTEGER expires_at "CHECK"
        INTEGER consumed_at "CHECK"
        TEXT session_hash "CHECK"
    }
    purged_prefixes {
        TEXT deployment_id PK
        INTEGER purged_at
        INTEGER sweep_after
    }
    upload_files {
        TEXT deployment_id PK, FK, UK "unique: deployment_id + path"
        TEXT id PK
        TEXT path UK "unique: deployment_id + path"
        INTEGER size
        TEXT sha256
        TEXT media_type
        TEXT object_key
    }
    deployments ||--o{ content_sessions : "deployment_id"
    deployments |o--o{ decks : "resume_deployment_id"
    deployments |o--o{ decks : "public_deployment_id"
    decks |o--o{ deployments : "deck_id"
    deployments ||--o{ preview_launches : "deployment_id"
    deployments ||--o{ upload_files : "deployment_id"
```

## 通報と運営

通報と、アカウントの停止。

表: `reports`、`suspensions`

```mermaid
erDiagram
    reports {
        TEXT id PK
        TEXT deck_id FK, UK "unique: deck_id + reporter_user_id"
        TEXT deployment_id
        TEXT share_path
        TEXT reason "CHECK"
        TEXT note
        TEXT reporter_user_id UK "unique: deck_id + reporter_user_id"
        INTEGER created_at
        INTEGER updated_at
    }
    suspensions {
        TEXT user_id PK
        TEXT reason
        INTEGER suspended_at
        TEXT suspended_by
    }
    decks
    decks ||--o{ reports : "deck_id"
```

## フォローとお知らせ

フォロー、ミュート、ブロック、お知らせと、その受け取りの設定。

表: `follows`、`mutes`、`blocks`、`notifications`、`notification_opt_outs`

```mermaid
erDiagram
    blocks {
        TEXT blocker_user_id PK "CHECK"
        TEXT blocked_user_id PK "CHECK"
        INTEGER created_at
    }
    follows {
        TEXT follower_user_id PK "CHECK"
        TEXT followee_user_id PK "CHECK"
        INTEGER created_at
    }
    mutes {
        TEXT muter_user_id PK "CHECK"
        TEXT muted_user_id PK "CHECK"
        INTEGER created_at
    }
    notification_opt_outs {
        TEXT user_id PK
        TEXT kind PK
    }
    notifications {
        TEXT id PK
        TEXT recipient_user_id "CHECK"
        TEXT kind "CHECK"
        TEXT actor_user_id "CHECK"
        TEXT deck_id "CHECK"
        TEXT target_deck_id "CHECK"
        INTEGER created_at
        INTEGER read_at
    }
```

## 記事と関連リンクと引用

スライドに付く実況記事、関連リンク、スライドと記事からの引用。

表: `articles`、`article_citations`、`related_links`、`citations`

```mermaid
erDiagram
    article_citations {
        TEXT deck_id PK, FK
        TEXT target_handle PK
        TEXT target_slug PK
        INTEGER target_page PK "CHECK"
    }
    articles {
        TEXT deck_id PK, FK
        TEXT body "CHECK"
        TEXT status "CHECK"
        INTEGER created_at
        INTEGER updated_at
        TEXT draft_body "CHECK"
        INTEGER revision "CHECK"
    }
    citations {
        TEXT deployment_id PK, FK
        TEXT target_handle PK
        TEXT target_slug PK
        INTEGER target_page PK "CHECK"
    }
    related_links {
        TEXT id PK
        TEXT deck_id FK, UK "unique: deck_id + position"
        TEXT kind "CHECK"
        TEXT url
        TEXT title "CHECK"
        INTEGER position UK "unique: deck_id + position"
        INTEGER created_at
        TEXT normalized_url
        TEXT sanitized_url
    }
    decks
    deployments
    decks ||--o{ article_citations : "deck_id"
    decks ||--o| articles : "deck_id"
    deployments ||--o{ citations : "deployment_id"
    decks ||--o{ related_links : "deck_id"
```

## イベント

関連リンクの URL から決まるイベントと、関連リンクとの対応。

表: `events`、`related_link_events`

```mermaid
erDiagram
    events {
        INTEGER id PK
        TEXT key UK "CHECK"
        TEXT service "CHECK"
        TEXT ref "CHECK"
        TEXT host "CHECK"
        TEXT url "CHECK"
        TEXT name "CHECK"
        TEXT named_by "CHECK"
        INTEGER named_at "CHECK"
        INTEGER created_at
    }
    related_link_events {
        TEXT link_id PK, FK
        INTEGER event_id FK
        TEXT host "CHECK"
        INTEGER created_at
    }
    related_links
    events ||--o{ related_link_events : "event_id"
    related_links ||--o| related_link_events : "link_id"
```

## コミュニティ

コミュニティ、その管理者、スライドの自動紐づけ用リンク、Luma のカレンダーの配信に並ぶイベントの鍵と、コミュニティのフォロー。

表: `communities`、`community_admins`、`community_links`、`community_feed_events`、`community_follows`

```mermaid
erDiagram
    communities {
        INTEGER id PK "CHECK"
        TEXT name "CHECK"
        TEXT description "CHECK"
        TEXT color "CHECK"
        TEXT sites "CHECK"
        INTEGER logo_at
        INTEGER cover_at
        INTEGER created_at
    }
    community_admins {
        INTEGER community_id PK, FK
        TEXT user_id PK
        INTEGER added_at
    }
    community_feed_events {
        INTEGER link_id PK, FK
        TEXT event_key PK "CHECK"
        INTEGER added_at
    }
    community_follows {
        TEXT user_id PK
        INTEGER community_id PK, FK
        INTEGER created_at
    }
    community_links {
        INTEGER id PK
        INTEGER community_id FK
        TEXT url UK "CHECK"
        TEXT kind "CHECK"
        TEXT host "CHECK"
        INTEGER created_at
    }
    communities ||--o{ community_admins : "community_id"
    community_links ||--o{ community_feed_events : "link_id"
    communities ||--o{ community_follows : "community_id"
    communities ||--o{ community_links : "community_id"
```

## Luma の配信

Luma のカレンダーの iCal 配信を読む記録(間隔、条件付きの取得、失敗と停止)と、Luma への取得を 1 本ずつに絞る門。

表: `luma_feeds`、`luma_feed_gate`

```mermaid
erDiagram
    luma_feed_gate {
        INTEGER id PK "CHECK"
        INTEGER busy_until
        INTEGER next_start_at
    }
    luma_feeds {
        TEXT url PK "CHECK"
        INTEGER read_at
        INTEGER not_before
        INTEGER due_at
        INTEGER retry_until
        TEXT etag "CHECK"
        TEXT last_modified "CHECK"
        INTEGER failures "CHECK"
        TEXT last_failure "CHECK"
        INTEGER stopped_at "CHECK"
    }
```

## 運営への通知

運営へ知らせる通知。すぐ送ったものの記録と、翌日のメールにまとめるために待っているもの。通知にするための数え上げに使う出来事。

表: `alerts`、`alert_signals`

```mermaid
erDiagram
    alert_signals {
        INTEGER id PK
        TEXT kind "CHECK"
        INTEGER at
    }
    alerts {
        INTEGER id PK
        TEXT kind "CHECK"
        TEXT urgency "CHECK"
        INTEGER count "CHECK"
        TEXT link "CHECK"
        TEXT task "CHECK"
        TEXT phase "CHECK"
        INTEGER raised_at
        TEXT state "CHECK"
        INTEGER mailed_at "CHECK"
    }
```

## R2 のバックアップ

バックアップのバケットにあるファイルの記録と、毎日の写しがどこまで進んだか。

表: `backup_objects`、`backup_state`

```mermaid
erDiagram
    backup_objects {
        TEXT key PK "CHECK"
        TEXT etag
        INTEGER size "CHECK"
        INTEGER copied_at
        INTEGER gone_at
    }
    backup_state {
        INTEGER id PK "CHECK"
        INTEGER pass_started_at "CHECK"
        TEXT cursor "CHECK"
        INTEGER last_pass_started_at
        INTEGER last_completed_at
        INTEGER progress_at
        INTEGER last_run_at
        INTEGER last_run_failed "CHECK"
        INTEGER last_failed_at
        INTEGER told_at
    }
```

## メンテナンスの予告

サービスを止める予定。全ページの帯に出す、開始と終了の見込みと理由。予定は 1 つだけ持つ。

表: `maintenance_notice`

```mermaid
erDiagram
    maintenance_notice {
        INTEGER id PK "CHECK"
        INTEGER starts_at "CHECK"
        INTEGER ends_at "CHECK"
        TEXT reason "CHECK"
        INTEGER updated_at
    }
```

## 計測

運営が使われ方を知るための、日ごとの集計(Analytics Engine から 1 日 1 回写したもの)と、写し終えた日。人や端末を見分ける値は持たない。

表: `metric_daily`、`metric_days`

```mermaid
erDiagram
    metric_daily {
        TEXT day PK "CHECK"
        TEXT event PK "CHECK"
        TEXT detail PK "CHECK"
        TEXT referrer PK "CHECK"
        TEXT lang PK "CHECK"
        TEXT screen PK "CHECK"
        INTEGER events "CHECK"
        REAL value_sum "CHECK"
    }
    metric_days {
        TEXT day PK "CHECK"
        INTEGER copied_at
        INTEGER row_count "CHECK"
        INTEGER was_cut "CHECK"
    }
```

## プロフィール

プロフィール、リンク、プロフィール画像と、その取り下げ。

表: `profiles`、`profile_links`、`profile_pictures`、`picture_removals`

```mermaid
erDiagram
    picture_removals {
        INTEGER id PK
        TEXT user_id
        TEXT removed_by
        TEXT reason "CHECK"
        INTEGER removed_at
    }
    profile_links {
        TEXT user_id PK
        INTEGER position PK "CHECK"
        TEXT url "CHECK"
    }
    profile_pictures {
        TEXT user_id PK
        INTEGER uploaded_at
    }
    profiles {
        TEXT user_id PK
        TEXT name "CHECK"
        TEXT bio "CHECK"
        TEXT location "CHECK"
        TEXT website "CHECK"
        INTEGER use_gravatar "CHECK"
        INTEGER gravatar_at
    }
```
