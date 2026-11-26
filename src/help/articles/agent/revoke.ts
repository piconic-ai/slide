import { html } from 'hono/html'
import { defineArticle } from '../../article'

export default defineArticle({
  order: 30,
  form: 'reference',
  related: ['agent/connect'],
  ja: {
    title: 'AI エージェントの接続を取り消す',
    lead: () =>
      html`「設定」の「接続済みのエージェント」で、取り消したいエージェントの「接続を取り消す」を押します。`,
    body: () =>
      html`<p>
        取り消したエージェントの次の要求は、断られます。途中だった受け取りも終わります。
      </p>`,
  },
  en: {
    title: 'Revoke an AI agent’s connection',
    lead: () =>
      html`In “Settings”, under “Connected agents”, press “Disconnect” for the
      agent.`,
    body: () =>
      html`<p>Its next request is refused, and its unfinished uploads end.</p>`,
  },
})
