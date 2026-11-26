import { html } from 'hono/html'
import { defineArticle } from '../../article'

export default defineArticle({
  order: 60,
  form: 'howto',
  related: ['agent/export-with-agent', 'agent/connect', 'agent/revoke'],
  ja: {
    title: '接続をつなぎ直す',
    lead: () =>
      html`書き出しができるようになる前につないだエージェントは、「設定」で接続を取り消し、もう一度つなぐと、書き出しを使えます。`,
    body: () =>
      html`<ol>
          <li>
            「設定」の「AI
            エージェントから置く」の「接続済みのエージェント」で、そのエージェントの「接続を取り消す」を押します。
          </li>
          <li>
            エージェントに「MCP サーバーの
            URL」をもう一度登録し、接続を始めます(<a href="/help/agent/connect"
              >AI エージェントをつなぐ</a
            >)。
          </li>
          <li>
            ブラウザで開く「エージェントとの接続を許可しますか」の画面に、「あなたのスライドを置く、差し替える」と「自分のスライドと記事を読み、取り出す」の
            2 行が出ていることを確かめて、「許可する」を押します。
          </li>
          <li>エージェントに、書き出しをもう一度頼みます。</li>
        </ol>
        <h2>なぜ必要か</h2>
        <p>
          つなぎ直すこと(再接続)が要るのは、接続が、許可した操作を覚えているからです。書き出しができるようになる前につないだ接続は、スライドを置くことだけを許していて、スライドと記事を読み、取り出すことは許していません。許可していない操作を、エージェントが勝手に使うことはできません。
        </p>
        <h2>うまくいかないとき</h2>
        <ul>
          <li>
            先に取り消さなくても、同じエージェントをつなぎ直すと、前の接続は新しい接続に置き換わります。
          </li>
          <li>つなぎ直しても同じ答えが返るときは、お問い合わせください。</li>
        </ul>`,
  },
  en: {
    title: 'Reconnect an AI agent',
    lead: () =>
      html`An agent connected before exporting was possible can export once you
      disconnect it in “Settings” and connect it again.`,
    body: () =>
      html`<ol>
          <li>
            In “Settings”, under “Connected agents” in “Put slides up from an AI
            agent”, press “Disconnect” for that agent.
          </li>
          <li>
            Register the “MCP server URL” with the agent again and start the
            connection (<a href="/help/agent/connect">Connect an AI agent</a>).
          </li>
          <li>
            On the “Allow this agent to connect?” screen that opens in the
            browser, check that both “Put up your slides and replace them” and
            “Read your slides and articles, and take them out” are listed, and
            press “Allow”.
          </li>
          <li>Ask the agent to write everything out again.</li>
        </ol>
        <h2>Why it is needed</h2>
        <p>
          A connection remembers what you allowed. One made before exporting was
          possible only allows putting slides up, not reading your slides and
          articles and taking them out. An agent cannot use what you did not
          allow.
        </p>
        <h2>When it does not work</h2>
        <ul>
          <li>
            Even if you do not disconnect first, connecting the same agent again
            replaces the old connection with the new one.
          </li>
          <li>
            If the same answer comes back after connecting again, please contact
            us.
          </li>
        </ul>`,
  },
})
