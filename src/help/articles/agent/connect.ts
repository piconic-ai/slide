import { html } from 'hono/html'
import { defineArticle } from '../../article'

export default defineArticle({
  order: 10,
  form: 'howto',
  related: ['agent/capabilities', 'agent/revoke', 'slides/upload'],
  ja: {
    title: 'AI エージェントをつなぐ',
    lead: () =>
      html`Claude Code など、MCP に対応した AI
      エージェントから、会話の流れのままスライドを置けます。`,
    body: () =>
      html`<ol>
        <li>
          「設定」の「AI エージェントから置く」にある「MCP サーバーの
          URL」を、エージェントに登録します。登録のしかたは、エージェントによって違います。
        </li>
        <li>
          初めて使うときに、ブラウザで接続を許可する画面が開きます。許可すると、そのエージェントから道具が使えます。
        </li>
        <li>
          できたスライドを「置いて」と頼むと、エージェントが
          スライドの編集の画面の URL
          を返します。そのページで表示を確かめて、「公開する」を押します。
        </li>
      </ol>`,
  },
  en: {
    title: 'Connect an AI agent',
    lead: (n) =>
      html`From an AI agent that supports MCP, such as Claude Code, you can put
      slides up without leaving the conversation.`,
    body: (n) =>
      html`<ol>
        <li>
          Register the “MCP server URL” in “Settings”, under “Put slides up from
          an AI agent”, with the agent. How to register it depends on the agent.
        </li>
        <li>
          The first time, a screen opens in the browser to allow the connection.
          Once you allow it, the agent can use the tools.
        </li>
        <li>
          Ask the agent to put the finished slides up. It returns the URL of an
          edit page. Check the slides there and press “Publish this version”.
        </li>
      </ol>`,
  },
})
