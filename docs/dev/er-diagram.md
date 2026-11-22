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
    article_citations
    articles
    auth_account
    auth_session
    auth_user
    auth_verification
    citations
    content_sessions
    decks
    deployments
    follows
    invited_emails
    login_code_requests
    mail_outbox
    mcp_clients
    mcp_codes
    mcp_grants
    mutes
    notification_opt_outs
    notifications
    page_script_deployments
    picture_removals
    preview_launches
    profile_links
    profile_pictures
    profiles
    purged_prefixes
    related_links
    reports
    suspensions
    upload_files
    decks ||--o{ article_citations : "deck_id"
    decks ||--o| articles : "deck_id"
    auth_user ||--o{ auth_account : "user_id"
    auth_user ||--o| auth_session : "user_id"
    deployments ||--o{ citations : "deployment_id"
    deployments ||--o{ content_sessions : "deployment_id"
    deployments |o--o{ decks : "resume_deployment_id"
    deployments |o--o{ decks : "public_deployment_id"
    decks |o--o{ deployments : "deck_id"
    accounts ||--o{ mcp_codes : "owner_user_id"
    mcp_clients ||--o{ mcp_codes : "client_id"
    accounts ||--o{ mcp_grants : "owner_user_id"
    mcp_clients ||--o{ mcp_grants : "client_id"
    deployments ||--o| page_script_deployments : "deployment_id"
    deployments ||--o{ preview_launches : "deployment_id"
    decks ||--o{ related_links : "deck_id"
    decks ||--o{ reports : "deck_id"
    deployments ||--o{ upload_files : "deployment_id"
```

## 認証と利用者

メールのコードでのログイン、Better Auth の利用者とセッション、招待、作者のアカウント。

表: `accounts`、`auth_user`、`auth_account`、`auth_session`、`auth_verification`、`invited_emails`、`login_code_requests`、`mail_outbox`

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
        TEXT user_id FK, UK
        INTEGER expires_at
        INTEGER created_at
        INTEGER updated_at
        TEXT ip_address
        TEXT user_agent
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
    auth_user ||--o{ auth_account : "user_id"
    auth_user ||--o| auth_session : "user_id"
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
    }
    accounts
    accounts ||--o{ mcp_codes : "owner_user_id"
    mcp_clients ||--o{ mcp_codes : "client_id"
    accounts ||--o{ mcp_grants : "owner_user_id"
    mcp_clients ||--o{ mcp_grants : "client_id"
```

## スライドと版

スライド(decks)、置かれた版(deployments)、受け取り中のセッションとファイル、プレビュー。

表: `decks`、`deployments`、`content_sessions`、`upload_files`、`page_script_deployments`、`preview_launches`、`purged_prefixes`

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
    page_script_deployments {
        TEXT deployment_id PK, FK
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
    deployments ||--o| page_script_deployments : "deployment_id"
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

フォロー、ミュート、お知らせと、その受け取りの設定。

表: `follows`、`mutes`、`notifications`、`notification_opt_outs`

```mermaid
erDiagram
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
    }
    decks
    deployments
    decks ||--o{ article_citations : "deck_id"
    decks ||--o| articles : "deck_id"
    deployments ||--o{ citations : "deployment_id"
    decks ||--o{ related_links : "deck_id"
```

## プロフィール

プロフィール、リンク、顔写真と、その取り下げ。

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
    }
```
