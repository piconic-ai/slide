---
version: alpha
name: slide
description: HTML スライドを公開し、読む人がさわって確かめ、反応が集まるサービス slide の UI。枠は白と墨の二色で静かに保ち、遊び心は「さわる・わかる・あつまる」に割り当てた積み木の色の面と、その意味を表す切り紙の図形、図形の動きが受け持つ。作者のスライドが置かれる画面では、枠に色を使わない。
colors:
  primary: "#111111"
  on-primary: "#ffffff"
  ink: "#111111"
  ink-muted: "#5c5c5c"
  canvas: "#ffffff"
  surface-soft: "#f7f7f5"
  hairline: "#e6e6e6"
  hairline-soft: "#f1f1f1"
  control-border: "#8c8c8c"
  inverse-ink: "#ffffff"
  stage: "#000000"
  block-yellow: "#feeba6"
  block-yellow-deep: "#f8da64"
  block-yellow-deeper: "#e7c100"
  block-blue: "#cce8ff"
  block-blue-deep: "#a4d3ff"
  block-blue-deeper: "#60aaf3"
  block-red: "#ffd8d0"
  block-red-deep: "#ffb5a9"
  block-red-deeper: "#f9786a"
  block-green: "#c9f4d7"
  block-green-deep: "#9be5b4"
  block-green-deeper: "#55c483"
  block-ecru: "#f5f0e3"
  block-ecru-deep: "#eae1c8"
  block-ecru-deeper: "#d6c69b"
  block-purple: "#ecddff"
  block-purple-deep: "#dac0fb"
  block-purple-deeper: "#b88fe6"
  block-navy: "#153b70"
  on-block-navy: "#ffffff"
  accent: "#ff3d8b"
  on-accent: "#111111"
  success: "#1f6f43"
  success-soft: "#e6f4ea"
  warning: "#8a5200"
  warning-soft: "#fff6e5"
  danger: "#8a1c1c"
  danger-soft: "#fbe9e9"
typography:
  display:
    fontFamily: system-ui, -apple-system, "Segoe UI", "Hiragino Sans", "Noto Sans JP", sans-serif
    fontSize: 56px
    fontWeight: 700
    lineHeight: 1.25
    letterSpacing: 0
  heading-1:
    fontFamily: system-ui, -apple-system, "Segoe UI", "Hiragino Sans", "Noto Sans JP", sans-serif
    fontSize: 32px
    fontWeight: 700
    lineHeight: 1.35
    letterSpacing: 0
  heading-2:
    fontFamily: system-ui, -apple-system, "Segoe UI", "Hiragino Sans", "Noto Sans JP", sans-serif
    fontSize: 24px
    fontWeight: 700
    lineHeight: 1.4
    letterSpacing: 0
  heading-3:
    fontFamily: system-ui, -apple-system, "Segoe UI", "Hiragino Sans", "Noto Sans JP", sans-serif
    fontSize: 18px
    fontWeight: 700
    lineHeight: 1.5
    letterSpacing: 0
  body-lg:
    fontFamily: system-ui, -apple-system, "Segoe UI", "Hiragino Sans", "Noto Sans JP", sans-serif
    fontSize: 18px
    fontWeight: 400
    lineHeight: 1.8
    letterSpacing: 0
  body:
    fontFamily: system-ui, -apple-system, "Segoe UI", "Hiragino Sans", "Noto Sans JP", sans-serif
    fontSize: 16px
    fontWeight: 400
    lineHeight: 1.8
    letterSpacing: 0
  reading:
    fontFamily: system-ui, -apple-system, "Segoe UI", "Hiragino Sans", "Noto Sans JP", sans-serif
    fontSize: 16px
    fontWeight: 400
    lineHeight: 1.9
    letterSpacing: 0
  body-sm:
    fontFamily: system-ui, -apple-system, "Segoe UI", "Hiragino Sans", "Noto Sans JP", sans-serif
    fontSize: 14px
    fontWeight: 400
    lineHeight: 1.7
    letterSpacing: 0
  caption:
    fontFamily: system-ui, -apple-system, "Segoe UI", "Hiragino Sans", "Noto Sans JP", sans-serif
    fontSize: 13px
    fontWeight: 400
    lineHeight: 1.6
    letterSpacing: 0
  button:
    fontFamily: system-ui, -apple-system, "Segoe UI", "Hiragino Sans", "Noto Sans JP", sans-serif
    fontSize: 15px
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: 0
  eyebrow:
    fontFamily: system-ui, -apple-system, "Segoe UI", "Hiragino Sans", "Noto Sans JP", sans-serif
    fontSize: 13px
    fontWeight: 700
    lineHeight: 1.4
    letterSpacing: 0.1em
  mono:
    fontFamily: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace
    fontSize: 13px
    fontWeight: 400
    lineHeight: 1.6
    letterSpacing: 0
rounded:
  xs: 2px
  sm: 6px
  md: 8px
  lg: 24px
  xl: 32px
  full: 9999px
spacing:
  hair: 1px
  xxs: 4px
  xs: 8px
  sm: 12px
  md: 16px
  lg: 24px
  xl: 32px
  xxl: 48px
  section: 96px
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    typography: "{typography.button}"
    rounded: "{rounded.full}"
    padding: 10px 20px
  button-secondary:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    typography: "{typography.button}"
    rounded: "{rounded.full}"
    padding: 9px 19px
  button-danger:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.danger}"
    typography: "{typography.button}"
    rounded: "{rounded.full}"
    padding: 9px 19px
  button-icon:
    backgroundColor: "{colors.surface-soft}"
    textColor: "{colors.ink}"
    typography: "{typography.button}"
    rounded: "{rounded.full}"
    size: 32px
  text-input:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: 10px 12px
  site-header:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    typography: "{typography.body-sm}"
    height: 56px
  menu:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.md}"
    padding: 6px
  deck-card:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.md}"
    padding: 0
  stage:
    backgroundColor: "{colors.stage}"
    textColor: "{colors.inverse-ink}"
    rounded: "{rounded.md}"
  panel:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.md}"
    padding: 12px
  color-block:
    backgroundColor: "{colors.block-yellow}"
    textColor: "{colors.ink}"
    typography: "{typography.body-lg}"
    rounded: "{rounded.lg}"
    padding: 48px
  color-block-blue:
    backgroundColor: "{colors.block-blue}"
    textColor: "{colors.ink}"
    typography: "{typography.body-lg}"
    rounded: "{rounded.lg}"
    padding: 48px
  color-block-red:
    backgroundColor: "{colors.block-red}"
    textColor: "{colors.ink}"
    typography: "{typography.body-lg}"
    rounded: "{rounded.lg}"
    padding: 48px
  color-block-green:
    backgroundColor: "{colors.block-green}"
    textColor: "{colors.ink}"
    typography: "{typography.body-lg}"
    rounded: "{rounded.lg}"
    padding: 48px
  color-block-ecru:
    backgroundColor: "{colors.block-ecru}"
    textColor: "{colors.ink}"
    typography: "{typography.body-lg}"
    rounded: "{rounded.lg}"
    padding: 48px
  color-block-purple:
    backgroundColor: "{colors.block-purple}"
    textColor: "{colors.ink}"
    typography: "{typography.body-lg}"
    rounded: "{rounded.lg}"
    padding: 48px
  color-block-navy:
    backgroundColor: "{colors.block-navy}"
    textColor: "{colors.on-block-navy}"
    typography: "{typography.body-lg}"
    rounded: "{rounded.lg}"
    padding: 48px
  block-shape:
    backgroundColor: "{colors.block-yellow-deep}"
    rounded: "{rounded.full}"
  block-shape-accent:
    backgroundColor: "{colors.block-yellow-deeper}"
    rounded: "{rounded.full}"
  block-shape-blue:
    backgroundColor: "{colors.block-blue-deep}"
    rounded: "{rounded.full}"
  block-shape-blue-accent:
    backgroundColor: "{colors.block-blue-deeper}"
    rounded: "{rounded.full}"
  block-shape-red:
    backgroundColor: "{colors.block-red-deep}"
    rounded: "{rounded.full}"
  block-shape-red-accent:
    backgroundColor: "{colors.block-red-deeper}"
    rounded: "{rounded.full}"
  block-shape-green:
    backgroundColor: "{colors.block-green-deep}"
    rounded: "{rounded.full}"
  block-shape-green-accent:
    backgroundColor: "{colors.block-green-deeper}"
    rounded: "{rounded.full}"
  block-shape-ecru:
    backgroundColor: "{colors.block-ecru-deep}"
    rounded: "{rounded.full}"
  block-shape-ecru-accent:
    backgroundColor: "{colors.block-ecru-deeper}"
    rounded: "{rounded.full}"
  block-shape-purple:
    backgroundColor: "{colors.block-purple-deep}"
    rounded: "{rounded.full}"
  block-shape-purple-accent:
    backgroundColor: "{colors.block-purple-deeper}"
    rounded: "{rounded.full}"
  pillar-tag:
    backgroundColor: "{colors.block-red}"
    textColor: "{colors.ink}"
    typography: "{typography.eyebrow}"
    rounded: "{rounded.full}"
    padding: 4px 10px
  status-chip:
    backgroundColor: "{colors.surface-soft}"
    textColor: "{colors.ink}"
    typography: "{typography.caption}"
    rounded: "{rounded.full}"
    padding: 4px 10px
  unread-dot:
    backgroundColor: "{colors.accent}"
    rounded: "{rounded.full}"
    size: 8px
  new-label:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.on-accent}"
    typography: "{typography.caption}"
    rounded: "{rounded.full}"
    padding: 2px 8px
  notice-warning:
    backgroundColor: "{colors.warning-soft}"
    textColor: "{colors.warning}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.md}"
    padding: 12px 16px
  notice-danger:
    backgroundColor: "{colors.danger-soft}"
    textColor: "{colors.danger}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.md}"
    padding: 12px 16px
  notice-success:
    backgroundColor: "{colors.success-soft}"
    textColor: "{colors.success}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.md}"
    padding: 12px 16px
  code-block:
    backgroundColor: "{colors.surface-soft}"
    textColor: "{colors.ink}"
    typography: "{typography.mono}"
    rounded: "{rounded.md}"
    padding: 16px
  data-table:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    typography: "{typography.body-sm}"
  footer:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink-muted}"
    typography: "{typography.body-sm}"
---

# slide の UI デザイン

slide の画面を作る、または変えるときに従う。値は冒頭のトークンが正で、本文は使いどころと理由を説明する。

## Overview

slide の主役は、作者が作ったスライドである。色も書体もスライドごとに違うので、サービスの枠が色を持つと必ずどれかとぶつかる。そこで枠は白 `{colors.canvas}` と墨 `{colors.ink}` の二色に絞り、線と余白だけで組み立てる。

一方で slide は、発表のまわりに人と反応が集まる場でもある。静かなだけの枠では、集まる楽しさが出ない。遊び心は**色面**に任せる。色面は、積み木のようなはっきりした 6 色の面に、切り紙の図形を重ねたものである。色と図形はどちらも slide の約束と結びついていて、見ればその場所が何のためにあるかがわかる。図形は、その意味どおりに動く。

| 色 | 意味 | 図形 | 置く場所の例 |
| --- | --- | --- | --- |
| 黄 `{colors.block-yellow}` | さわる | 軌道とつまみ、大きな円 | デモを動かせる説明、安心して開ける説明 |
| 青 `{colors.block-blue}` | わかる | 紙片と 2 本の行 | 話した言葉、コース、AI レビュー |
| 赤 `{colors.block-red}` | あつまる | 重なる 3 つの円 | 同じ場の発表、引用、SNS の反応 |
| 緑 `{colors.block-green}` | お礼 | 積み重なる硬貨 | 投げ銭、コースの購入 |
| 生成り `{colors.block-ecru}` | 作る人へ | 積み上がる四角 | 公開の手順、作者向けの案内、空の状態 |
| 紫 `{colors.block-purple}` | 人 | 顔の円と肩の半円 | プロフィール、フォロー |

この設計の要点は次のとおり。

- 枠は二色。ボタン、本文、ヘッダー、フッター、表は `{colors.ink}` と `{colors.canvas}` で作る。
- 色面は意味で選ぶ。飾りとして好きな色や図形を置かない。
- スライドが見えている最初の画面には、色面を置かない。
- ボタンはすべてピル型。アイコンだけのボタンは円。
- 影はメニューにだけ使う。カードやパネルは線で区切る。
- 日本語を読む場なので、字間は詰めず、行間を広く取る。
- 動くのは色面の図形と、反応が届いたことを知らせる小さな印だけ。

## Colors

### 枠

- **墨** `{colors.ink}` / `{colors.primary}`: 本文、見出し、主ボタン、選択中の状態。リンクも墨で、下線で示す。
- **白** `{colors.canvas}`: ページの背景、カード、パネル、入力欄。
- **淡い面** `{colors.surface-soft}`: コードブロック、アイコンボタン、表の見出し行、ホバー中の行。
- **補助の文字** `{colors.ink-muted}`: 日時、件数、補足。白と淡い面の上でだけ使う。色面の上では使わない(`{colors.block-red-deeper}` の図形の上でコントラスト比が 2.5 に落ちる)。
- **罫線** `{colors.hairline}` と `{colors.hairline-soft}`: カード、パネル、表の行の区切り。
- **入力欄の枠** `{colors.control-border}`: 入力欄、選択欄、副ボタンの輪郭。白との比が 3.4 あり、操作できる範囲が見える。罫線の色は薄すぎるので輪郭に使わない。
- **舞台** `{colors.stage}`: スライドの iframe の背景と、縮小表示の背景。読み込み中と余白が黒になる。

### 色面

1 つの色は 3 つの濃さを持つ。面の地、大きな図形、小さな図形の順に濃くなる。

| 色 | 地 | 大きな図形 | 小さな図形 |
| --- | --- | --- | --- |
| 黄 | `{colors.block-yellow}` | `{colors.block-yellow-deep}` | `{colors.block-yellow-deeper}` |
| 青 | `{colors.block-blue}` | `{colors.block-blue-deep}` | `{colors.block-blue-deeper}` |
| 赤 | `{colors.block-red}` | `{colors.block-red-deep}` | `{colors.block-red-deeper}` |
| 緑 | `{colors.block-green}` | `{colors.block-green-deep}` | `{colors.block-green-deeper}` |
| 生成り | `{colors.block-ecru}` | `{colors.block-ecru-deep}` | `{colors.block-ecru-deeper}` |
| 紫 | `{colors.block-purple}` | `{colors.block-purple-deep}` | `{colors.block-purple-deeper}` |

色面の上の文字は、紺を除いて必ず `{colors.ink}` にする。図形と重なっても読めるよう、最も濃い図形の上でも比が 7.1 以上ある。2026-11-19 に相対輝度で測ると、最も低いのは赤の 3 段目の上の墨で 7.12。本文と地は 4.5 以上で、成功の文字と淡い地が 5.42、補足 `{colors.ink-muted}` と白が 6.69。未読の点 `{colors.accent}` と白は 3.34 で、文字の基準には届かない。点のまま使い、白い文字は載せない。

- **紺** `{colors.block-navy}`: 唯一の濃い色面。文字は `{colors.on-block-navy}`。トップページの締めの呼びかけに 1 ページ 1 回だけ使う。意味の色ではなく、slide 自身の声を表す。図形は置かない。

### アクセント

- **マゼンタ** `{colors.accent}`: 未読と新着の印だけに使う。点(`unread-dot`)か、`{colors.on-accent}` の文字を載せた小さなラベル(`new-label`)にする。白い文字は比が 3.3 しかないので載せない。文字色やボタンには使わない。

### 状態

- **成功** `{colors.success}` / `{colors.success-soft}`: 一般公開中、操作が反映された通知。
- **注意** `{colors.warning}` / `{colors.warning-soft}`: 公開停止中、下書きの文書の注記。
- **危険** `{colors.danger}` / `{colors.danger-soft}`: 入力の誤り、運営による非表示、削除や退会。

状態の色は意味の色面と混ぜない。公開状態のラベルに `{colors.block-green}` を使うと、投げ銭の色と区別がつかなくなる。

黄と赤の色面は、注意と危険の淡い地に近い。見分けがつくよう、通知の帯には必ず同系の濃い色の 1px の線を付け、色面には線を付けない。色面は管理の画面に置かないので、同じ画面に並ぶことも避けられる。

## Typography

### 書体

OS の書体を使う。Web フォントは読み込まない。ページの CSP が `default-src 'none'` で外部の書体を許可しておらず、日本語の Web フォントは重いからである。

- 本文と見出し: `system-ui, -apple-system, "Segoe UI", "Hiragino Sans", "Noto Sans JP", sans-serif`
- 等幅: `ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`

### 階層

| トークン | 大きさ / 太さ / 行間 | 使いどころ |
| --- | --- | --- |
| `{typography.display}` | 56px / 700 / 1.25 | トップページの見出し。`clamp(32px, 6vw, 56px)` で縮める |
| `{typography.heading-1}` | 32px / 700 / 1.35 | 各ページの題。閲覧画面のスライドの題は 20px に下げる |
| `{typography.heading-2}` | 24px / 700 / 1.4 | 節の見出し、色面の中の見出し |
| `{typography.heading-3}` | 18px / 700 / 1.5 | カードやパネルの見出し |
| `{typography.body-lg}` | 18px / 400 / 1.8 | 色面の中の本文、ページ冒頭の説明 |
| `{typography.body}` | 16px / 400 / 1.8 | 本文 |
| `{typography.reading}` | 16px / 400 / 1.9 | 話した言葉、ヘルプ、規約など長く読む文章 |
| `{typography.body-sm}` | 14px / 400 / 1.7 | カード、表、メニュー、フッター |
| `{typography.caption}` | 13px / 400 / 1.6 | 日時、補足、状態のラベル |
| `{typography.button}` | 15px / 600 / 1.2 | ボタン |
| `{typography.eyebrow}` | 13px / 700 / 字間 0.1em | 節の上に置く小さな見出し、意味のタグ |
| `{typography.mono}` | 13px / 400 / 1.6 | URL、commit、deployment、スライド ID、コード |

### 原則

- 太さは 400・600・700 の 3 つ。OS の日本語書体は中間の太さを持たないので、細かい太さで階層を作らない。
- 字間は 0。日本語の見出しを詰めると読みにくくなる。広げるのは `{typography.eyebrow}` だけ。
- 階層は大きさと太さで作る。文字を薄くして弱めるのは、`{colors.ink-muted}` を使う補足だけにする。
- 長い文章の幅は 40 文字前後(`max-width: 40em`)に収める。
- ハンドルやスライド ID は長い英数字の並びになる。`overflow-wrap: anywhere` で折り返す。
- 識別子は等幅で示す。本文の中で等幅を強調に使わない。

## Layout

### 余白

- 基本の単位は 8px。`{spacing.xxs}` 4 · `{spacing.xs}` 8 · `{spacing.sm}` 12 · `{spacing.md}` 16 · `{spacing.lg}` 24 · `{spacing.xl}` 32 · `{spacing.xxl}` 48 · `{spacing.section}` 96。
- 節と節の間は `{spacing.section}`。幅 760px 未満では 56px に縮める。
- 色面の内側は `{spacing.xxl}`。幅 760px 未満では `{spacing.lg}`。
- カードの内側は `{spacing.md}`、パネルの内側は `{spacing.sm}`。

### 幅

| 画面 | 最大幅 |
| --- | --- |
| 閲覧画面 | 1600px。幅 761px 以上は、スライドが 1600px までの横幅いっぱいで、その下が左の列と右の列(280px 以上、全体の 3 分の 1 ほど)の 2 列。右の列は、説明・関連リンク・引用のどれかがあるときだけ作る。幅 760px 以下は 1 列 |
| トップページ、一覧、プロフィール、管理画面 | 960px |
| 規約 | 720px |
| ヘルプ | 960px。左に目次(200px から 240px)、右に本文。本文の段落は 40em。幅 600px 未満では、目次を本文の上に置く |
| ログイン、エラー、確認の画面 | 640px |

### 余白の考え方

色面と色面の間には、必ず白い面を挟む。1 つの画面に見える色面は 1 つまでにする。色面が続くと意味の区別が消え、ただの派手なページになる。

## Elevation & Depth

| 段階 | 表現 | 使いどころ |
| --- | --- | --- |
| 0 | 影も線もなし | 色面、ヘッダー、フッター |
| 1 | `{colors.hairline}` の 1px の線 | カード、パネル、表、入力欄 |
| 2 | `0 6px 20px rgb(0 0 0 / 0.12)` と 1px の線 | アカウントのメニュー、スライドのメニュー |

注目を集めたい場所には、影つきのカードではなく色面を使う。色面に影は付けない。

## Shapes

| トークン | 値 | 使いどころ |
| --- | --- | --- |
| `{rounded.xs}` | 2px | リンクのフォーカスの輪郭 |
| `{rounded.sm}` | 6px | メニューの項目、行内のコード |
| `{rounded.md}` | 8px | スライドの舞台、表紙、カード、パネル、入力欄、コードブロック |
| `{rounded.lg}` | 24px | 色面 |
| `{rounded.xl}` | 32px | トップページ冒頭の色面 |
| `{rounded.full}` | 9999px | ボタン、タグ、状態のラベル、アイコン、プロフィール画像 |

スライドの舞台と表紙は 16:9 で、角は `{rounded.md}`。幅 900px 未満で舞台が画面の端まで広がるときは、角を 0 にする。

## Components

### ボタン

- **`button-primary`**: 墨の地に白い文字のピル。1 つの画面で最も進めたい操作に 1 つだけ使う(「GitHub ではじめる」「一般公開する」)。
- **`button-secondary`**: 白い地に墨の文字、`{colors.control-border}` の 1px の線のピル。それ以外の操作(「さわってみる」「コピー」「フォローする」「停止する」)。
- **`button-danger`**: 白い地に `{colors.danger}` の文字と線。取り消せない操作(スライドの削除、退会)。確認の入力を終えるまで押せない状態は、不透明度 0.5 にする。
- **`button-icon`**: 直径 36px の円。ヘッダーのベルとプロフィール画像、スライドのメニューを開く「⋯」。押せる範囲は 44px 四方を確保する。
- ホバーは主ボタンで不透明度 0.85、副ボタンで地を `{colors.surface-soft}` にする。フォーカスは `{colors.ink}` の 2px の輪郭を 2px 離して出す。濃い地の上では輪郭を白にする。

### 入力

- **`text-input`**: 白い地、`{colors.control-border}` の 1px の線、`{rounded.md}`。`textarea` と `select` も同じ。フォーカスで線を `{colors.ink}` の 2px にする。
- ラベルは入力欄の上に `{typography.body-sm}` の太さ 600 で置く。補足は入力欄の下に `{typography.caption}` と `{colors.ink-muted}` で置く。
- 誤りは入力欄の下に `{colors.danger}` の文で示し、線も `{colors.danger}` にする。色だけで伝えず、文で理由を書く。
- **共有 URL の欄**: 読み取り専用の入力欄と「コピー」の副ボタンを横に並べる。URL は `{typography.mono}`。
- ラジオボタンとチェックボックスは OS の見た目のまま、`accent-color` を `{colors.ink}` にする。

### 枠

- **`site-header`**: 白い地、画面の幅いっぱい、下に `{colors.hairline}` の 1px の線。左にサービス名(太さ 700、20px)、右にアカウント。ログイン前は「ログイン」の副ボタン、ログイン後は、お知らせのベルと、プロフィール画像(なければ頭文字)のメニュー。「スライドの管理」はメニューの中にだけ置く。円は見た目 36px、押せる範囲 44px。「スライドを追加」のボタンは置かない。
- **`menu`**: 白い地、1px の線、段階 2 の影。項目は `{rounded.sm}` で、ホバーで `{colors.surface-soft}`。ログアウトのように性質の違う項目は `{colors.hairline-soft}` の線で分ける。
- **`footer`**: 白い地に `{colors.ink-muted}` の `{typography.body-sm}`。上に 1px の線と `{spacing.lg}` の余白。ヘルプ、規約、プライバシー、お問い合わせへのリンクを間隔 20px で横に並べ(下線なし、ホバーで下線)、その末尾に GitHub のリポジトリへのリンクを、マークのアイコンだけで置き(44px 四方、同じタブで開く)、同じ行の右端に言語の切り替え。幅 600px 未満では 2 行にする。選択中の言語は墨の太字。

### スライドを見せる

- **`stage`**: スライドの iframe。16:9、地は `{colors.stage}`、線も影もなし。まわりに色面、タグ、装飾を置かない。
- **題の行**: スライドの題(20px、太さ 700)と、右端にメニューを開く `button-icon`。
- **作者の行**: プロフィール画像の円、名前、ハンドル、公開日。名前はプロフィールへのリンク。
- **`deck-card`**: 一覧で 1 本のスライドを表す。上に 16:9 の表紙(`{rounded.md}`、地は `{colors.stage}`、白いスライドと白い画面の境を示す透過 8% の黒の 1px の内側の線を重ねる。`border` にしない。内側の `box-shadow` で引く線で、段階をつける影ではない。viewer の舞台の中の表紙には付けない)、下に題(`{typography.heading-3}`)、作者と日時(`{typography.caption}`、`{colors.ink-muted}`)。カード全体に線や地は付けない(表紙の内側の線は除く)。ホバーで表紙を 2px 持ち上げる。
- **縮小表示**: 引用や同じ場の発表を並べる小さな 16:9。`deck-card` と同じ形で、題は 1 行。
- **ページ送り**: `‹ 14 / 24 ›`。数字は `{typography.mono}`、矢印は `button-icon`。

### あつまる

- **`panel`**(反応の一覧): 閲覧画面の右列。白い地、1px の線、`{rounded.md}`。見出しの横に `pillar-tag`(赤)を置く。投稿の埋め込みは `{rounded.md}`、地は `{colors.surface-soft}`。
- **`pillar-tag`**: 意味の色面と同じ色の小さなピル。色面を置けない場所(閲覧画面、一覧の見出し)で、その場所の意味を示す。地の色は意味に合わせて差し替える。1 つの見出しに 1 つ。
- **イベントの行**: コミュニティ名のピル(白い地、1px の線、太さ 700)、発表の題、日付。
- **お知らせの項目**: 未読には先頭に `unread-dot` を置き、文を太さ 600 にする。色面は使わない。
- **`new-label`**: 「新着」と書いた小さなピル。一覧の中で、前回から増えた項目に付ける。1 つの画面に 3 つまで。

### 色面

- **`color-block`**: コンテンツの幅いっぱいの面。`{rounded.lg}`、内側は `{spacing.xxl}`、はみ出した図形は面の角で切る。中に eyebrow、`{typography.heading-2}`、`{typography.body-lg}`、必要なら画面の見本を置く。地の色は意味に合わせて 6 色から選ぶ。
- **`color-block-navy`**: 紺の面。トップページの締めに置き、中の主ボタンは白い地に墨の文字へ反転する。
- **画面の見本**: 色面の中に置く製品画面の模型。白い地、`{rounded.md}`、線なし。スライドの模型は `{colors.stage}` の 16:9。図形より手前に置く。
- **空の状態**: 何もない一覧には、`{colors.block-ecru}` の小さな面(`{rounded.lg}`、内側 `{spacing.lg}`)に、次にできることを 1 文と操作を 1 つ置く。「まだスライドはありません。」で終わらせない。図形は置かなくてよい。
- **プロフィールの頭**: 第一スコープでは色面を使わない。白地に、プロフィール画像(96px の円。ないときは名前の頭文字)、名前、ハンドル、フォローのボタンを置き、場所・Web サイト・GitHub の項目をその下に並べる。紫の面は、色面を戻すときのために残す。

### 切り紙の図形

色面の中に置く、意味を表す図形(`block-shape` と `block-shape-accent`)。円、角丸の四角、ピル型の棒だけで作り、線画や写真は使わない。大きな図形は 2 段目の濃さ、小さな図形は 3 段目の濃さにする。画面の class はこの 2 つのまま、地の色に合わせて塗りを差し替える。色ごとの部品名（`block-shape-blue` など）は、その塗りのトークンである。

| 意味 | 図形の組み立て |
| --- | --- |
| さわる | 左下に、面の外から伸びる軌道(ピル型の棒)と、その上のつまみ(小さな円)。右下に、面からはみ出す大きな円 |
| わかる | 右上に、面からはみ出す紙片(角丸の四角)。右下に、長さの違う 2 本の行(ピル型の棒) |
| あつまる | 右下に、面からはみ出して重なる 2 つの大きな円。右上に小さな円。重なる部分は乗算で濃くする |
| お礼 | 右下に、少しずつずれて積み重なる 3 枚の硬貨(横長の楕円) |
| 作る人へ | 右下に、階段状に積み上がる 3 つの角丸の四角 |
| 人 | 右下に、肩を表す半円と、その上の顔の円 |

- 図形は面の端に置き、半分ほどを面の外へはみ出させる。面の中央と、見出しの上には置かない。
- 本文と重なってよいのは、図形の端だけ。1 行がまるごと図形の上に乗る配置は避ける。
- 1 つの面の図形は 3 つまで。
- 図形は飾りなので `aria-hidden="true"` を付ける。
- 幅 600px 未満では、小さな図形を 1 つ残して、大きな図形を隠してよい。

### 状態を伝える

- **`status-chip`**: 小さなピル。色に加えて必ず言葉で状態を書く。

  | 状態 | 地 / 文字 |
  | --- | --- |
  | 下書き | `{colors.surface-soft}` / `{colors.ink}` |
  | 一般公開中、実装済み | `{colors.success-soft}` / `{colors.success}` |
  | 公開停止中、開発中 | `{colors.warning-soft}` / `{colors.warning}` |
  | 運営による非表示 | `{colors.danger-soft}` / `{colors.danger}` |
  | 設計中 | `{colors.canvas}` / `{colors.ink-muted}`、`{colors.control-border}` の破線 |

- **`notice-success`** / **`notice-warning`** / **`notice-danger`**: 操作の結果、注意、誤りを伝える帯。`{rounded.md}`、淡い地に同系の濃い文字と、同じ色の 1px の線。結果は `role="status"`、誤りは `role="alert"` を保つ。

### 管理の画面

- **`data-table`**: スライドの一覧、受領履歴、反応の管理、運営画面。白い地、行の下に `{colors.hairline}` の線、見出し行は `{typography.caption}` の太さ 600 と `{colors.ink-muted}`。縦の線と縞は使わない。幅 600px 未満では、1 行を縦に積んだカードにする。
- **`code-block`**: コマンドや設定の例など。`{colors.surface-soft}` の地、線なし、`{rounded.md}`、横スクロール。行内のコードは同じ地で `{rounded.sm}`、左右に 4px。
- **手順**: 番号つきの見出し(`{typography.heading-3}`)と説明。番号は墨の円(24px、白い数字)にする。
- 管理の画面、設定、運営画面には色面を置かない。作業の場では、状態のラベルと通知の帯だけが色を持つ。

## 画面ごとの適用

| 画面 | 色面 | 要点 |
| --- | --- | --- |
| トップページ | 第一スコープでは使わない | ドロップ枠から始め、色面と図形の節は置かない。下の「さわる=黄、わかる=青、あつまる=赤、作る人へ=生成り、締め=紺」の割り当ては、価値の説明の節を戻すときのために残す |
| 閲覧画面(`/@handle/slug`) | なし | 最初の画面は舞台と題だけ。下の節と右列に `pillar-tag` |
| プロフィール(`/@handle`) | 第一スコープでは使わない | 白地。プロフィール画像(なければ頭文字)、名前、フォロー、項目、切り替え、スライドの `deck-card` の格子 |
| お知らせ、フォロー、ミュート、通報 | なし | 幅 640px の 1 列。未読は `unread-dot` |
| スライドの管理、公開状態、設定 | なし | 表と手順と `status-chip` |
| ログイン(`/start` は `/` へ送るので、はじめるの画面はない) | 生成り(手順の面) | 主ボタンは 1 つ |
| エラー | 生成り(第一スコープの画面ではなく、既存のまま) | 大きな見出し、理由を 1 文、戻る操作を 1 つ |
| 作者限定リンクの期限切れ | なし | 白地の見出しと段落 |
| ヘルプ、規約 | なし | `{typography.reading}` で読む。下書きの注記は `notice-warning` |
| 運営画面 | なし | トークン、表、入力欄。非表示と停止は同格なので主ボタンは置かない |
| コース、投げ銭(設計中) | 青、緑 | 購入と送金の面だけに使う |

## Motion

動きは、色面の図形が意味を演じるためと、何かが届いたことを知らせるために使う。画面を飾るためには使わない。

### 図形の動き

| 意味 | 動き |
| --- | --- |
| さわる | つまみが軌道の上を左右に行き来する。軌道の端を越えない。大きな円はゆっくり 5% だけふくらんで戻る |
| わかる | 紙片が上から降りる。2 本の行が、左から順に伸びる |
| あつまる | 3 つの円が面の外から寄ってきて、少し行き過ぎてから定位置に収まる |
| お礼 | 硬貨が上から 1 枚ずつ落ちて積まれる |
| 作る人へ | 四角が下から 1 つずつ積み上がる |
| 人 | 肩の半円がせり上がり、顔の円が弾んで現れる |

- 色面が画面に入るあいだに動き、定位置で止まる。止まった姿が、動きのない環境での見た目と同じになるようにする。繰り返さない。
- スクロールに連動させる。`animation-timeline: view()` と `animation-range: entry 10% cover 45%` を、`@supports (animation-timeline: view())` と `prefers-reduced-motion: no-preference` の中に書く。対応していないブラウザでは、最初から定位置に表示する。スクリプトは使わない。
- keyframes には終わりの姿を書かない。定位置はマークアップの位置になる。つまみは開始と、軌道の反対側（60%）だけを書く。未読の点は開始と 1.4 倍（70%）だけを書く。
- 動かすのは `transform` と `opacity` だけ。小さな図形のホバーだけは `scale` を使う。スクロールの `transform` と同時に効かせるためである。
- 寄ってくる、弾むといった動きには `cubic-bezier(0.34, 1.4, 0.64, 1)`、伸びる、降りる動きには `cubic-bezier(0.2, 0.8, 0.2, 1)` を使う。
- 色面にカーソルを置くと、小さな図形が 150ms で 1.18 倍になって応える。`prefers-reduced-motion: reduce` ではこの倍率も付けない。
- `prefers-reduced-motion: reduce` では、図形を定位置に置いたまま動かさない。

### 小さな動き

| 場所 | 動き | 長さ |
| --- | --- | --- |
| 反応の一覧 | 新しく届いた投稿が、8px 下から不透明度とともに入る | 250ms |
| `unread-dot` | 現れるときに 1 度だけ 1.4 倍に弾む | 300ms |
| 共有 URL の「コピー」 | 押すと文言が「コピーしました」に変わり、2 秒で戻る | — |
| `deck-card` | ホバーで表紙が 2px 持ち上がる | 150ms |
| ボタン | 押しているあいだ 0.97 倍に縮む | 100ms |

スライドの舞台と、そのまわりの題や作者の行は動かさない。ページの切り替え、スクロールの演出、背景の動きは作らない。

## Do's and Don'ts

### Do

- 主ボタンは 1 つの画面に 1 つにする。2 つ目からは `button-secondary` にする。
- 色面は、表の意味に合う色を選ぶ。合う意味がなければ、色面を使わず白い面で作る。
- 色面と色面の間に白い面を挟み、1 つの画面に見える色面を 1 つまでにする。
- 色面の上の文字は `{colors.ink}` にする(紺の上だけ白)。
- 状態は、色と言葉の両方で伝える。
- 色は CSS 変数で指定する。変数にない色が要るときは、先にこの文書へ足す。
- 新しい画面は幅 375px から作り、広い画面へ広げる。

### Don't

- スライドの舞台のまわりに、色面、色つきの枠、影、装飾を置かない。
- 意味のない場所に色面を使わない。管理の画面を色面でにぎやかにしない。
- 意味の色を別の意味に流用しない。成功の表示に緑の色面を、未読の表示に赤の色面を使わない。
- 図形を別の意味の色面に流用しない。つまみは「さわる」、重なる円は「あつまる」だけのもの。
- 図形を繰り返し動かし続けない。読んでいる横で動くものは邪魔になる。
- `{colors.accent}` を文字、ボタン、色面に使わない。
- 角ばったボタンを作らない。
- カードやパネルに影を付けない。
- `{colors.ink-muted}` を色面の上や本文に使わない。
- Web フォント、アイコンフォント、外部の CSS を読み込まない。
- 絵文字を UI の部品として使わない。

## Responsive Behavior

| 幅 | 変化 |
| --- | --- |
| 900px 未満 | 閲覧画面を 1 列にし、舞台を画面の端まで広げて角を 0 にする。反応の一覧は舞台の下に、枠なしで置く |
| 760px 未満 | トップページの文と図を縦に積み、見出しを先にする。節の間を 56px、色面の内側を 24px にする |
| 600px 未満 | 表を縦積みのカードにする。ボタンの並びは折り返し、主ボタンを幅いっぱいにする |

- 押せる範囲は 44px 四方以上。ピル型のボタンは高さ 40px 以上にする。
- 動きは Motion の節に従う。`prefers-reduced-motion: reduce` では動かさない。
- `forced-colors` でも形が残るよう、アイコンは背景ではなく border や文字で描く。

## Iteration Guide

1. 部品は `components:` のトークン名で指す(`button-primary`、`deck-card`、`color-block`)。
2. 新しい節を作るときは、最初に「どの意味か」を決める。意味が決まれば色面の色が決まる。
3. 新しい部品や状態が要るときは、別名の項目として足す(`-pressed`、`-selected`)。本文の中に埋めない。
4. 変更のたびに、幅 375px と 1280px で画面を見る。色面が 1 つの画面に 2 つ見えていないか、舞台のまわりに色がないかを確かめる。
5. 文字と地の組み合わせを足したら、コントラスト比が 4.5 以上あることを確かめる。操作できる部品の輪郭は 3 以上。

## Known Gaps

- ダークテーマは未設計。`public/tokens.css` に `.dark` の値はあるが、色面の暗い版がない。決まるまで、ページは明るいテーマだけで出す。
- 図形と動きを試作したのは、さわる・わかる・あつまるの 3 つ。お礼・作る人へ・人の 3 つは、文で決めただけで描いていない。使う画面を作るときに、試作して依頼者に見せる。
- 紺の締めの呼びかけは、第一スコープではトップページに置かない。戻すときに、主ボタンを冒頭と締めに 1 つずつ置くか(1 画面に 1 つの規則と、ページの両端で同じ操作を示すこととのどちらを優先するかは未決)を決める。
- `@google/design.md lint` は、部品の `backgroundColor` か `textColor` に書いた色だけを参照と数える。`{colors.hairline}`、`{colors.hairline-soft}`、`{colors.control-border}` は線の色なので、この lint では未参照の警告が残る。
- コース、投げ銭、料金プラン、閲覧分析、話した言葉の読み物は画面が未実装。それぞれの仕様が固まった時点で部品を足す。
- ロゴはない。図形をロゴやアイコンに展開するかは未決。

骨格は [getdesign.md](https://getdesign.md/figma/design-md) の Figma のデザイン分析(MIT)を出発点にし、slide の目的と日本語の画面に合わせて書き直した。書体、ロゴ、固有の表現は持ち込んでいない。
