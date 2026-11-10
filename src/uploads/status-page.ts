import { messages, type Lang } from '../site/i18n'
import { SERVICE_NAME } from '../site/service'
import { uploadResourcePolicy } from './content-policy'

// Static wording only: the page is a plain template, so nothing here may
// hold markup or come from a request.
const text = messages({
  ja: {
    title: `${SERVICE_NAME} アップロード受領票`,
    intro:
      'GitHub Actions から非公開で送った資料の commit と受領済みファイルを確認できます。アップロードだけでは資料は公開されません。',
    receiptFile: '非公開の受領票 JSON を読み込む',
    credential: 'このアップロード専用の認証情報',
    check: '受領票を確認',
    preview: 'スライドをプレビュー',
    credentialNote:
      '認証情報はこのページ内だけで保持し、アップロード開始から24時間で期限が切れます。このアップロード専用の認証情報であり、GitHub ログインとは異なります。',
    prompt:
      'Deployment ID と認証情報、または受領票 JSON で状態を確認してください。',
    previewTitle: '非公開スライドのプレビュー',
    previewNote:
      '現在のプレビューは HTML 単体で完結する資料に対応しています。相対パスの画像・CSS・JS は読み込みません。',
    script: {
      badReceipt: '受領票 JSON を読み込めませんでした。',
      previewFailed:
        'プレビューを読み込めませんでした。認証情報と ready 状態を確認してください。',
      checking: '確認しています…',
      offline: 'サービスに接続できませんでした。もう一度お試しください。',
    },
  },
  en: {
    title: `${SERVICE_NAME} upload receipt`,
    intro:
      'Check the commit and the received files of slides you uploaded privately from GitHub Actions. Uploading alone does not publish them.',
    receiptFile: 'Load the private receipt JSON',
    credential: 'Credential for this upload only',
    check: 'Check the receipt',
    preview: 'Preview the slides',
    credentialNote:
      'The credential stays on this page only and expires 24 hours after the upload started. It is for this upload only and is not your GitHub sign-in.',
    prompt:
      'Enter the deployment ID and credential, or load the receipt JSON, to check the status.',
    previewTitle: 'Private preview of the slides',
    previewNote:
      'The preview currently supports slides that are a single self-contained HTML file. Images, CSS and JS at relative paths are not loaded.',
    script: {
      badReceipt: 'Could not read the receipt JSON.',
      previewFailed:
        'Could not load the preview. Check the credential and that the version is ready.',
      checking: 'Checking…',
      offline: 'Could not reach the service. Please try again.',
    },
  },
})

/** A value for the inline script, safe inside its script element. */
const scriptValue = (value: unknown) =>
  JSON.stringify(value).replace(/</g, '\\u003c')

const previewDocumentPrefix = `<!doctype html><meta http-equiv="Content-Security-Policy" content="${uploadResourcePolicy}">`

/** `footer` is the rendered site footer for the same language. */
export const statusPage = (lang: Lang, footer: string) => {
  const t = text[lang]
  return /* HTML */ `<!doctype html>
    <html lang="${lang}">
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width" />
      <title>${t.title}</title>
      <style>
        body {
          font: 17px system-ui;
          max-width: 800px;
          margin: 6vh auto;
          padding: 24px;
          background: #f4f6fa;
          color: #152439;
        }
        input,
        button {
          font: inherit;
          padding: 12px;
          border: 1px solid #aab6c9;
          border-radius: 6px;
        }
        input {
          width: 95%;
        }
        button {
          margin-top: 12px;
          background: #153b70;
          color: white;
          cursor: pointer;
        }
        pre {
          white-space: pre-wrap;
          overflow-wrap: anywhere;
          background: white;
          padding: 20px;
          border-radius: 8px;
        }
        label {
          display: block;
          margin: 18px 0 8px;
        }
        p {
          line-height: 1.6;
        }
      </style>
      <h1>${t.title}</h1>
      <p>${t.intro}</p>
      <label for="receipt-file">${t.receiptFile}</label
      ><input id="receipt-file" type="file" accept="application/json" />
      <form id="receipt">
        <label for="deployment">Deployment ID</label
        ><input id="deployment" required autocomplete="off" /><label
          for="credential"
          >${t.credential}</label
        ><input
          id="credential"
          type="password"
          required
          autocomplete="off"
        /><button>${t.check}</button
        ><button type="button" id="preview">${t.preview}</button>
      </form>
      <p>${t.credentialNote}</p>
      <pre id="result" role="status">${t.prompt}</pre>
      <iframe
        id="slide-preview"
        title="${t.previewTitle}"
        sandbox="allow-scripts"
        referrerpolicy="no-referrer"
        style="display:none;width:100%;height:65vh;border:1px solid #aab6c9"
      ></iframe>
      <p>${t.previewNote}</p>
      ${footer}
      <script>
        const text = ${scriptValue(t.script)}
        const id = location.pathname.split('/')[2]
        if (id) document.querySelector('#deployment').value = id
        document
          .querySelector('#receipt-file')
          .addEventListener('change', async (event) => {
            try {
              const data = JSON.parse(await event.target.files[0].text())
              document.querySelector('#deployment').value = data.deploymentId
              document.querySelector('#credential').value = data.credential
              document.querySelector('#receipt').requestSubmit()
            } catch {
              document.querySelector('#result').textContent = text.badReceipt
            }
          })
        document
          .querySelector('#preview')
          .addEventListener('click', async () => {
            const frame = document.querySelector('#slide-preview')
            try {
              const response = await fetch(
                '/api/uploads/' +
                  encodeURIComponent(
                    document.querySelector('#deployment').value,
                  ) +
                  '/content/index.html',
                {
                  headers: {
                    Authorization:
                      'Bearer ' + document.querySelector('#credential').value,
                  },
                },
              )
              if (!response.ok) throw new Error()
              frame.srcdoc =
                ${JSON.stringify(previewDocumentPrefix)} +
                (await response.text())
              frame.style.display = 'block'
            } catch {
              document.querySelector('#result').textContent = text.previewFailed
            }
          })
        document
          .querySelector('#receipt')
          .addEventListener('submit', async (event) => {
            event.preventDefault()
            const result = document.querySelector('#result')
            result.textContent = text.checking
            try {
              const response = await fetch(
                '/api/uploads/' +
                  encodeURIComponent(
                    document.querySelector('#deployment').value,
                  ),
                {
                  headers: {
                    Authorization:
                      'Bearer ' + document.querySelector('#credential').value,
                  },
                },
              )
              const data = await response.json()
              result.textContent = JSON.stringify(data, null, 2)
            } catch {
              result.textContent = text.offline
            }
          })
      </script>
    </html>`
}
