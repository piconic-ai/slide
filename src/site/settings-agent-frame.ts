import { html } from 'hono/html'
import { messages, type Lang } from './i18n'

const text = messages({
  ja: { heading: 'AI エージェントから置く' },
  en: { heading: 'Put slides up from an AI agent' },
})

/**
 * Where the settings show how to connect an AI agent: the MCP server's URL
 * and the agents connected so far. For now only the frame is kept; the
 * feature that lets agents put slides up fills it.
 */
export const settingsAgentFrame = (lang: Lang) =>
  html`<section class="panel" id="agents" data-settings-frame="agents">
    <h2>${text[lang].heading}</h2>
  </section>`
