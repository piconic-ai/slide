import { html } from 'hono/html'
import { dayFormats } from '../share/dates'
import { copyRow } from './copy-row'
import { messages, type Lang } from './i18n'
import { frameHelpLink } from '../help/frame-links'

const text = messages({
  ja: {
    heading: 'AI エージェントから置く',
    intro:
      'MCP に対応した AI エージェントにこの URL を登録すると、会話の中からスライドを置けます。置かれたスライドは、公開するまで自分だけが見られます。',
    url: 'MCP サーバーの URL',
    connected: '接続済みのエージェント',
    none: '接続済みのエージェントはありません。',
    connectedOn: (day: string) => `接続した日: ${day}`,
    lastUsedOn: (day: string) => `最後に使った日: ${day}`,
    neverUsed: 'まだ使っていません',
    revoke: {
      label: '接続を取り消す',
      name: (agent: string) => `${agent} の接続を取り消す`,
    },
  },
  en: {
    heading: 'Put slides up from an AI agent',
    intro:
      'Register this URL with an AI agent that supports MCP, and it can put slides up from your conversation. Slides put up this way are visible only to you until you publish them.',
    url: 'MCP server URL',
    connected: 'Connected agents',
    none: 'No agent is connected.',
    connectedOn: (day: string) => `Connected: ${day}`,
    lastUsedOn: (day: string) => `Last used: ${day}`,
    neverUsed: 'Not used yet',
    revoke: {
      label: 'Disconnect',
      name: (agent: string) => `Disconnect ${agent}`,
    },
  },
})

/** What the frame shows: where agents connect, and who is connected. */
export type AgentSettings = Readonly<{
  /** The MCP server's URL, which the author registers with an agent. */
  mcpUrl: string
  connections: readonly Readonly<{
    id: string
    name: string
    connectedAt: number
    lastUsedAt: number | null
  }>[]
}>

const dayOf = (seconds: number, lang: Lang) =>
  dayFormats[lang].format(seconds * 1000)

/**
 * Where the settings show how to connect an AI agent: the MCP server's URL
 * to copy, and the agents connected so far, each with the day it was
 * connected, the day it was last used and a button that ends it at once.
 */
export const settingsAgentFrame = (lang: Lang, view: AgentSettings) => {
  const t = text[lang]
  return html`<section class="panel" id="agents" data-settings-frame="agents">
    <h2>${t.heading}</h2>
    <p>${t.intro}</p>
    ${frameHelpLink('settings-agents', lang)}
    <label for="mcp-url">${t.url}</label>
    ${copyRow({ id: 'mcp-url', value: view.mcpUrl }, lang)}
    ${
      view.connections.length === 0
        ? html`<p>${t.none}</p>`
        : html`<ul
            class="settings-rows"
            role="list"
            aria-label="${t.connected}"
          >
            ${view.connections.map(
              (agent) =>
                html`<li>
                  <form
                    method="post"
                    action="/settings/agents/${encodeURIComponent(agent.id)}/revoke"
                  >
                    <span class="agent-name">
                      <strong>${agent.name}</strong><br />
                      <span class="card-meta"
                        >${t.connectedOn(dayOf(agent.connectedAt, lang))} /
                        ${
                          agent.lastUsedAt === null
                            ? t.neverUsed
                            : t.lastUsedOn(dayOf(agent.lastUsedAt, lang))
                        }</span
                      >
                    </span>
                    <button
                      class="button-secondary"
                      type="submit"
                      aria-label="${t.revoke.name(agent.name)}"
                    >
                      ${t.revoke.label}
                    </button>
                  </form>
                </li>`,
            )}
          </ul>`
    }
  </section>`
}
