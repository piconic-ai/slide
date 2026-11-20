import { html } from 'hono/html'
import type { HtmlEscapedString } from 'hono/utils/html'
import { MAX_ARGUMENT_BYTES } from '../mcp/files'
import { MAX_SHOT_PAGE } from '../covers/shot'
import { safetyHelp } from '../safety/pages'
import { MAX_PAGE } from '../share/path'
import { DEFAULT_UPLOAD_LIMITS } from '../uploads/limits'
import { messages, type Lang } from './i18n'

type Html = HtmlEscapedString | Promise<HtmlEscapedString>

/** The ids of the help's sections, in the order the table of contents lists. */
export const HELP_SECTION_IDS = [
  'upload',
  'page-share',
  'citations',
  'embed',
  'agent',
  'follow',
  'safety',
  'terms',
  'privacy',
] as const
export type HelpSectionId = (typeof HELP_SECTION_IDS)[number]

const MEBIBYTE = 1024 * 1024

/**
 * The numbers the help quotes, taken from the code that enforces them, so
 * that a changed limit changes the help and no figure is typed twice.
 */
export const helpNumbers = () =>
  Object.freeze({
    versionMb: DEFAULT_UPLOAD_LIMITS.deploymentBytes / MEBIBYTE,
    fileMb: DEFAULT_UPLOAD_LIMITS.fileBytes / MEBIBYTE,
    files: DEFAULT_UPLOAD_LIMITS.files,
    decks: DEFAULT_UPLOAD_LIMITS.decks,
    authorMb: DEFAULT_UPLOAD_LIMITS.authorBytes / MEBIBYTE,
    agentMb: MAX_ARGUMENT_BYTES / MEBIBYTE,
    shotPage: MAX_SHOT_PAGE,
    viewerPage: MAX_PAGE,
  })
type Numbers = ReturnType<typeof helpNumbers>

type Text = Readonly<{
  title: string
  tocLabel: string
  toc: Readonly<Record<HelpSectionId, string>>
  upload: (n: Numbers) => Html
  pageShare: (n: Numbers) => Html
  citations: Html
  embed: Html
  agent: (n: Numbers) => Html
  follow: Html
  terms: Html
  privacy: Html
}>

const text = messages<Text>({
  ja: {
    title: 'ヘルプ',
    tocLabel: 'ヘルプの目次',
    toc: {
      upload: '置き方',
      'page-share': 'ページごとの共有',
      citations: '引用',
      embed: 'ブログへの埋め込み',
      agent: 'AI エージェントから置く',
      follow: 'フォロー',
      safety: '安全について',
      terms: '規約',
      privacy: 'プライバシー',
    },
    upload: (n) =>
      html` <p>
          slide は、いまは招待制です。運営が登録した GitHub
          アカウントの人だけが、スライドを置けます。登録していない人がログインしたり、ファイルを置いたりしようとすると、受け取らずに、招待制であることをお伝えします。
        </p>
        <h3>置けるもの</h3>
        <ul>
          <li>
            HTML 1 ファイル(<code>.html</code>)。<code>index.html</code>
            として置かれます。
          </li>
          <li>
            zip。直下に <code>index.html</code> があるか、1 つのフォルダの中に
            <code>index.html</code>
            があるものです。フォルダの中にあるときは、そのフォルダが根になります。macOS
            が足す <code>__MACOSX/</code> と
            <code>.DS_Store</code> は、無いものとして扱います。<code
              >index.html</code
            >
            が決まらない zip は、受け取らずに理由をお伝えします。
          </li>
        </ul>
        <p>
          フォルダそのもののドロップ、PDF、zip 以外の圧縮形式は受け取りません。
        </p>
        <h3>上限</h3>
        <ul>
          <li>1 つの版は ${n.versionMb} MB まで</li>
          <li>1 つのファイルは ${n.fileMb} MB まで</li>
          <li>1 つの版のファイルは ${n.files} 個まで</li>
          <li>1 人が置けるスライドは ${n.decks} 本まで</li>
          <li>1 人が置けるファイルの合計は ${n.authorMb} MB まで</li>
        </ul>
        <p>
          ブラウザから置くときは、版の大きさ、ファイルの大きさ、ファイルの数を、送る前に確かめます。超えているときは、どの上限を超えたかを枠の中に出します。
        </p>
        <h3>置いたあと</h3>
        <ol>
          <li>
            トップか「スライドの管理」に、ファイルをドロップします(「ファイルを選ぶ」からも選べます)。ログインしていないときは、ファイルをこのブラウザの中に預かり、「GitHub
            でログインして続ける」からログインすると、戻ったときに自動で受け取ります。預かるのは
            1 件だけで、24 時間たつと捨てます。
          </li>
          <li>
            受け取ったスライドは、作者だけが見られる状態で、1
            本の管理ページに開きます。題名は <code>index.html</code> の
            <code>&lt;title&gt;</code>、URL
            の名前は題名かファイル名から決めてあります。
          </li>
          <li>
            表示を確かめます。「この版を一般公開する」を押すと、共有 URL (<code
              >/@ハンドル/URL の名前</code
            >)をだれでも開けるようになります。
          </li>
        </ol>
        <p>
          公開を止めるときは、同じページの「公開を停止する」を押します。止めたあと、新しい版を受け取っても、自動では公開し直しません。
        </p>
        <h3>差し替える</h3>
        <p>
          直した版は、1 本の管理ページの「差し替え」にドロップします。共有 URL
          は変わりません。公開中の版は、版の履歴で「この版を一般公開する」を押すまで変わらないので、発表中に差し替えても、読者に見える版は動きません。
        </p>
        <h3>URL の名前</h3>
        <p>
          URL の名前は、公開する前だけ、1
          本の管理ページで変えられます。英小文字、数字、ハイフンで、64
          文字までです。一度公開したスライドは、公開を止めたあとも変えられません。同じ人の中で名前が重なったときは、<code>-2</code>、<code
            >-3</code
          >
          を付けます。
        </p>`,
    pageShare: (n) =>
      html` <p>
          スライドの中の特定のページを共有したいときは、共有 URL
          の末尾にページ番号を付けます (<code>/@ハンドル/URL の名前/6</code
          >)。この URL を開くと、そのページからスライドが始まります。viewer
          の「共有」から「いま見ているページの URL
          をコピー」を押すと、いま見ているページの URL が取れます。
        </p>
        <p>
          X や Bluesky、チャットなどが URL のカードを作るとき、ページ番号つきの
          URL
          には、表紙ではなく、そのページを撮った画像が出ます。画像は、必要になったときに
          slide が撮るので、作者は何もしなくてかまいません。
        </p>
        <h3>働く条件</h3>
        <ul>
          <li>
            スライドが、ページ番号を <code>#6</code> の形(URL の
            <code>#</code> のあとに番号)で持っていること。Marp
            で作ったスライドなどが当てはまります。
          </li>
          <li>
            その版の <code>index.html</code>
            が、ページを伝える script を読み込んでいること。ブラウザから置いた
            HTML と、AI エージェントが道具の引数で渡した HTML には、slide がこの
            1 行を足します(すでに入っている HTML には足しません)。
          </li>
        </ul>
        <p>
          条件に合わないスライドでは、「いま見ているページの URL
          をコピー」は出ません。ページ番号つきの URL
          でも、カードには表紙が出ます。
        </p>
        <h3>番号の決まり</h3>
        <ul>
          <li>
            スライドが開くのは 1 から ${n.viewerPage}
            までの番号です。それ以外(<code>0</code>、<code>03</code> など)の URL
            は、見つからないページになります。
          </li>
          <li>
            カードにページの画像が出るのは、1 から ${n.shotPage}
            までです。それより大きい番号、条件に合わないスライド、撮影に失敗したときは、表紙が出ます。1
            ページ目の URL(番号なし)も、表紙です。
          </li>
        </ul>
        <p>
          SNS が一度取得したカードの画像をいつ更新するかは、SNS
          が決めます。スライドを直したあとも、古い画像がしばらく残ることがあります。
        </p>`,
    citations: html` <p>
        スライドの中に、ほかのスライドの共有
        URL(ページ番号つきでもかまいません)へのリンクを書くと、2
        つのスライドがつながります。作者に、申請や入力は要りません。
      </p>
      <h3>つなげかた</h3>
      <ul>
        <li>
          リンクは、slide のアドレスで始まる共有 URL (<code
            >https://…/@ハンドル/URL の名前</code
          >)を <code>href</code>
          に書いたものです。相対 URL、ほかのサイトの URL、プロフィールの URL
          は、引用になりません。
        </li>
        <li>
          リンクは、スライドを置いて確定するときに読みます。HTML
          ファイルごとに、先頭の 512 KB までです。画像を埋め込んだ 1
          ファイルのスライドでは、後ろのほうのリンクは読まれないことがあります。
        </li>
        <li>
          同じスライドへのリンクは、引用になりません。同じ作者の別のスライドへのリンクは、引用になります。何ページで引用しても、1
          回だけ数えます。
        </li>
      </ul>
      <h3>どこに出るか</h3>
      <ul>
        <li>
          引用された側の viewer
          の下に「このスライドを引用しているスライド」、引用した側の viewer
          の下に「このスライドが引用しているスライド」が、表紙のカードで出ます。4
          件まで並べ、残りは「ほか N 件」と件数で示します。1
          件もないときは、見出しごと出ません。
        </li>
        <li>
          引用された側の作者は、1
          本の管理ページで、引用しているスライドの一覧を、件数を切らずに見られます。お知らせは届きません。
        </li>
        <li>
          スライドの中の共有 URL へのリンクを読者が押すと、viewer
          がそのスライドへ移ります。ほかの URL へは移りません。
        </li>
      </ul>
      <h3>消えるとき</h3>
      <p>
        引用は、引用した側と、された側の両方が一般公開されている間だけ出ます。どちらかの公開を止めると消え、もう一度公開すると戻ります。読むのは公開中の版なので、新しい版を受け取っても、公開中の版を入れ替えるまでは、出る引用は変わりません。読者がミュートしている作者、運営が非表示にしたスライド、停止中の作者のスライドは出ません。引用は表紙のカードで出すだけで、引用したスライドを相手のページの上で動かすことはしません。
      </p>`,
    embed: html` <p>
        公開中のスライドは、ブログの記事の中でめくれる形で埋め込めます。
      </p>
      <h3>貼りかた</h3>
      <ol>
        <li>
          スライドの viewer
          の「共有」から「埋め込みコードをコピー」を押します。作者は、1
          本の管理ページの「埋め込みコード」の枠からもコピーできます。
        </li>
        <li>
          コードをブログの記事に貼ります。コードは <code>&lt;iframe&gt;</code> 1
          つで、記事の幅に合わせて 16:9 になります。
        </li>
        <li>
          開始のページを変えたいときは、<code>src</code> の末尾に
          <code>/3</code> のようにページ番号を足します。
        </li>
      </ol>
      <p>
        一般公開されていないスライドの共有メニューには、埋め込みコードは出ません。公開を止めたスライドや、運営が非表示にしたスライドの埋め込みは、表示されなくなります。ブログサービスが
        <code>&lt;iframe&gt;</code>
        を貼れるかどうかは、そのサービスの決まりによります。
      </p>
      <h3>伝わること</h3>
      <ul>
        <li>
          埋め込み先のサイトには、記事を開いたことが伝わります(そのサイト自身のページなので)。枠の中は別の
          origin なので、スライドの中身、めくったページ、読者が slide
          にログインしているかどうかは、読めません。
        </li>
        <li>
          slide には、読者の IP
          アドレス、ブラウザの種類、埋め込みが読み込まれたことが伝わります。ブラウザの既定では、埋め込み先のサイトの
          origin(path は含みません)も届きます。読まれた回数は数えていません。
        </li>
        <li>
          スライドが外部のサービスへ通信する作りなら、そのサービスにも IP
          アドレスと開いたことが伝わります。「安全について」を読んでください。
        </li>
      </ul>
      <h3>できないこと</h3>
      <ul>
        <li>
          埋め込みの中では、フォロー、通報、ミュートができません。下端の「Slide
          で開く」から viewer を開いて行います。
        </li>
        <li>
          埋め込みの中のスライドは、そのスライド自身のファイルへのリンクのほかは開きません。ほかのスライドの共有
          URL や、ほかのサイトへのリンクは、「Slide で開く」から viewer
          を開いてたどります。
        </li>
        <li>
          めくったページは、埋め込み先に伝わりません。「Slide
          で開く」の行き先は、埋め込みの URL のページ番号で決まります。
        </li>
        <li>viewer 本体の URL は、ほかのサイトに埋め込めません。</li>
      </ul>
      <h3>安全</h3>
      <p>
        埋め込みの中のスライドは、viewer
        と同じ囲いの中で動き、埋め込み先のページを移動させたり、別のタブを開いたり、フォームを送ったり、ファイルをダウンロードさせたりできません。埋め込みのページは、読者のログイン情報を読みません。
      </p>`,
    agent: (n) =>
      html` <p>
          Claude Code など、MCP に対応した AI
          エージェントから、会話の流れのままスライドを置けます。
        </p>
        <h3>つなぎかた</h3>
        <ol>
          <li>
            「設定」の「AI エージェントから置く」にある「MCP サーバーの
            URL」を、エージェントに登録します。登録のしかたは、エージェントによって違います。
          </li>
          <li>
            初めて使うときに、ブラウザで接続を許可する画面が開きます。許可すると、そのエージェントから道具が使えます。
          </li>
          <li>
            できたスライドを「置いて」と頼むと、エージェントが 1
            本の管理ページの URL
            を返します。そのページで表示を確かめて、「この版を一般公開する」を押します。
          </li>
        </ol>
        <h3>エージェントにできること</h3>
        <ul>
          <li>自分のスライドの一覧を見る</li>
          <li>新しく置く</li>
          <li>
            新しい版に差し替える(公開中の版は、人が入れ替えるまで変わりません)
          </li>
          <li>受け取りの状態を見る</li>
        </ul>
        <p>
          小さな HTML(文字のファイルの合計が ${n.agentMb} MB
          まで)は、道具の引数で渡します。それより大きいもの、画像などを含むものは、エージェントが送り先へ直接送ります。zip
          は渡せません。ファイルの一覧(パスと内容)で渡します。上限は、ブラウザから置くときと同じ(1
          つの版 ${n.versionMb} MB、1 つのファイル ${n.fileMb} MB、${n.files}
          ファイル、1 人 ${n.decks} 本)です。招待制も同じです。
        </p>
        <h3>エージェントにできないこと</h3>
        <p>
          公開すること、公開を止めること、削除すること、URL
          の名前を変えること、設定を変えることはできません。置かれたスライドは、あなたが管理ページで「この版を一般公開する」を押すまで、自分だけが見られます。
        </p>
        <h3>取り消しかた</h3>
        <p>
          「設定」の「接続済みのエージェント」で、取り消したいエージェントの「接続を取り消す」を押します。取り消したエージェントの次の要求は、断られます。途中だった受け取りも終わります。
        </p>`,
    follow: html` <p>
        気になる人をフォローすると、その人が新しいスライドを公開したときに知らせが届きます。
      </p>
      <h3>フォローすると</h3>
      <ul>
        <li>
          相手のプロフィールか、スライドの作者名のそばの「フォロー」を押します。ログインが必要です。自分自身はフォローできません。
        </li>
        <li>
          相手が新しいスライドを公開すると、ヘッダーのベルのお知らせに届き、ログイン中のトップの「フォロー中の人の新着」に出ます(公開が新しい順に
          4 件まで)。
        </li>
        <li>相手には、あなたがフォローしたことが、お知らせで伝わります。</li>
      </ul>
      <h3>一覧</h3>
      <p>
        プロフィールの「フォロー中」と「フォロワー」の一覧と、その数は、ログインしていない人を含めて、だれでも見られます。あなたがミュートしている人は、あなたが見る一覧に出ません。停止中の人と退会した人は、だれが見ても出ません。
      </p>
      <h3>解除</h3>
      <p>
        自分のプロフィールの「フォロー中」で、解除したい人を選びます。相手のプロフィールやスライドの「フォロー中」のボタンからも解除できます。解除すると、相手のフォロワーの一覧からあなたが消え、新しいスライドのお知らせは届かなくなります。人をミュートしたときと、退会したときも、フォローは外れます。
      </p>`,
    terms: html` <p>
      <a href="/terms">利用規約</a
      >を読めます。いまは仮のページで、正式な内容はまだ決めていません。
    </p>`,
    privacy: html` <p>
      <a href="/privacy">プライバシーポリシー</a
      >を読めます。いまは仮のページで、正式な内容はまだ決めていません。
    </p>`,
  },
  en: {
    title: 'Help',
    tocLabel: 'Help contents',
    toc: {
      upload: 'Putting slides up',
      'page-share': 'Sharing a page',
      citations: 'Citations',
      embed: 'Embedding in a blog',
      agent: 'Putting up from an AI agent',
      follow: 'Following',
      safety: 'Safety',
      terms: 'Terms',
      privacy: 'Privacy',
    },
    upload: (n) =>
      html` <p>
          Slide is invite-only for now. Only people whose GitHub account the
          operators registered can put slides up. If someone who is not
          registered signs in or drops a file, nothing is received and they are
          told that the service is invite-only.
        </p>
        <h3>What you can put up</h3>
        <ul>
          <li>
            One HTML file (<code>.html</code>). It is put up as
            <code>index.html</code>.
          </li>
          <li>
            A zip with <code>index.html</code> at its top, or inside the one
            folder that holds everything. In the second case that folder becomes
            the root. The <code>__MACOSX/</code> folder and
            <code>.DS_Store</code> that macOS adds are ignored. A zip where
            <code>index.html</code> cannot be found is refused, with the reason.
          </li>
        </ul>
        <p>
          Dropping a folder itself, PDFs and archives other than zip are not
          accepted.
        </p>
        <h3>Limits</h3>
        <ul>
          <li>One version: up to ${n.versionMb} MB</li>
          <li>One file: up to ${n.fileMb} MB</li>
          <li>Files in one version: up to ${n.files}</li>
          <li>Slides per person: up to ${n.decks}</li>
          <li>All files per person together: up to ${n.authorMb} MB</li>
        </ul>
        <p>
          When you drop in the browser, the size of the version, the size of
          each file and the number of files are checked before anything is sent.
          If one is over, the drop area says which limit it is.
        </p>
        <h3>After you put them up</h3>
        <ol>
          <li>
            Drop the file on the top page or on “Your slides” (you can also
            choose it with “Choose a file”). If you are not signed in, the file
            is kept in this browser, and when you sign in with “Sign in with
            GitHub to continue”, it is received automatically on your return.
            Only one file is kept, and it is discarded after 24 hours.
          </li>
          <li>
            The slides open on a manage page, visible only to you. The title
            comes from the <code>&lt;title&gt;</code> of
            <code>index.html</code>, and the name in the URL from the title or
            the file name.
          </li>
          <li>
            Check how they look. Press “Publish this version” and anyone can
            open the share link (<code>/@handle/name</code>).
          </li>
        </ol>
        <p>
          To stop publishing, press “Pause publishing” on the same page. A new
          version received afterwards does not publish again by itself.
        </p>
        <h3>Replacing slides</h3>
        <p>
          Drop the fixed version on “Replace” on the manage page. The share link
          stays the same. The public version does not change until you press
          “Publish this version” in the history of versions, so replacing slides
          in the middle of a talk does not move what readers see.
        </p>
        <h3>The name in the URL</h3>
        <p>
          You can change the name in the URL on the manage page only before you
          publish. Use lowercase letters, digits and hyphens, up to 64
          characters. Once slides were published, the name cannot be changed,
          even after you stop publishing. When a name is already taken among
          your slides, <code>-2</code>, <code>-3</code> is added.
        </p>`,
    pageShare: (n) =>
      html` <p>
          To share one page of the slides, add its number to the end of the
          share link (<code>/@handle/name/6</code>). Opening it starts the
          slides at that page. In the viewer, press “Share” and then “Copy link
          to this page” to get the link of the page you are looking at.
        </p>
        <p>
          When X, Bluesky or a chat app makes a card for the link, a link with a
          page number shows an image of that page instead of the cover. Slide
          takes the image when it is needed, so the author does nothing.
        </p>
        <h3>When it works</h3>
        <ul>
          <li>
            The slides keep the page number in the form <code>#6</code> (the
            number after the <code>#</code> of the URL). Slides made with Marp
            are an example.
          </li>
          <li>
            The <code>index.html</code> of that version loads the script that
            reports the page. Slide adds this line to HTML put up from the
            browser and to HTML an AI agent passes in a tool’s arguments (it
            does not add it to HTML that already has it).
          </li>
        </ul>
        <p>
          For slides that do not meet this, “Copy link to this page” is not
          shown, and a link with a page number still shows the cover in its
          card.
        </p>
        <h3>Page numbers</h3>
        <ul>
          <li>
            The slides open at numbers from 1 to ${n.viewerPage}. A link with
            any other number (<code>0</code>, <code>03</code>) is a page that is
            not found.
          </li>
          <li>
            The card shows the page image from 1 to ${n.shotPage}. A larger
            number, slides that do not meet the conditions, or a failed capture
            shows the cover. The link of the first page without a number shows
            the cover too.
          </li>
        </ul>
        <p>
          When a social service refreshes a card image it has already taken is
          up to that service. After you fix the slides, the old image may stay
          for a while.
        </p>`,
    citations: html` <p>
        When your slides contain a link to the share link of other slides (a
        page number is fine), the two are connected. The author does not apply
        or type anything.
      </p>
      <h3>How to connect them</h3>
      <ul>
        <li>
          The link is a share link that starts with Slide’s own address
          (<code>https://…/@handle/name</code>), written in an
          <code>href</code>. A relative URL, the URL of another site or a
          profile URL is not a citation.
        </li>
        <li>
          The links are read when the slides are put up and the version is
          confirmed. For each HTML file, the first 512 KB are read. In a
          one-file slide with embedded images, a link near the end may not be
          read.
        </li>
        <li>
          A link to the same slides is not a citation. A link to another slide
          by the same author is. However many pages cite them, they are counted
          once.
        </li>
      </ul>
      <h3>Where it shows</h3>
      <ul>
        <li>
          Under the viewer of the cited slides, “Slides citing these slides”
          shows as cover cards, and under the viewer of the citing slides,
          “Slides these slides cite”. Up to 4 are shown and the rest as “N
          more”. When there are none, the heading is left out.
        </li>
        <li>
          The author of the cited slides sees every citing slide, with no count
          cut off, on the manage page. No notification is sent.
        </li>
        <li>
          When a reader presses a link to a share link inside the slides, the
          viewer moves to those slides. It does not move to other URLs.
        </li>
      </ul>
      <h3>When it goes away</h3>
      <p>
        A citation shows only while both the citing and the cited slides are
        public. Stopping either one removes it, and publishing again brings it
        back. The public version is the one that is read, so receiving a new
        version changes the citations only after you replace the public version.
        Slides by an author the reader muted, slides the operators hid, and
        slides by a suspended author are not shown. Citations appear only as
        cover cards; the citing slides are never run on the other slides’ page.
      </p>`,
    embed: html` <p>
        Public slides can be embedded so that readers can flip through them
        inside a blog post.
      </p>
      <h3>How to paste</h3>
      <ol>
        <li>
          In the viewer, press “Share” and then “Copy embed code”. The author
          can also copy it from the “Embed code” area of the manage page.
        </li>
        <li>
          Paste the code into the blog post. It is one
          <code>&lt;iframe&gt;</code>, which keeps 16:9 to the width of the
          post.
        </li>
        <li>
          To start at another page, add the page number to the end of
          <code>src</code>, like <code>/3</code>.
        </li>
      </ol>
      <p>
        The share menu of slides that are not public has no embed code. The
        embed of slides you stopped publishing, or that the operators hid, stops
        showing. Whether a blog service accepts an
        <code>&lt;iframe&gt;</code> is up to that service.
      </p>
      <h3>What is passed on</h3>
      <ul>
        <li>
          The embedding site learns that the post was opened (it is that site’s
          own page). The frame is another origin, so it cannot read the slides’
          content, the page turned to, or whether the reader is signed in to
          Slide.
        </li>
        <li>
          Slide learns the reader’s IP address, their browser and that the embed
          was loaded. By the browser’s default, the origin of the embedding site
          (without its path) arrives too. Views are not counted.
        </li>
        <li>
          If the slides talk to other services, those services learn the IP
          address and that the slides were opened. Read “Safety”.
        </li>
      </ul>
      <h3>What it cannot do</h3>
      <ul>
        <li>
          Following, reporting and muting are not possible inside an embed. Use
          “Open on Slide” at the bottom to open the viewer and do them there.
        </li>
        <li>
          Inside the embed, the slides open only links to their own files. A
          link to another slide’s share link, or to another site, is followed
          from the viewer you open with “Open on Slide”.
        </li>
        <li>
          The page turned to is not passed to the embedding site. Where “Open in
          Slide” goes is set by the page number in the embed’s URL.
        </li>
        <li>The viewer itself cannot be embedded in another site.</li>
      </ul>
      <h3>Safety</h3>
      <p>
        Slides inside an embed run in the same enclosure as in the viewer. They
        cannot move the embedding page, open another tab, send a form or start a
        download. The embed page does not read the reader’s sign-in.
      </p>`,
    agent: (n) =>
      html` <p>
          From an AI agent that supports MCP, such as Claude Code, you can put
          slides up without leaving the conversation.
        </p>
        <h3>How to connect</h3>
        <ol>
          <li>
            Register the “MCP server URL” in “Settings”, under “Put slides up
            from an AI agent”, with the agent. How to register it depends on the
            agent.
          </li>
          <li>
            The first time, a screen opens in the browser to allow the
            connection. Once you allow it, the agent can use the tools.
          </li>
          <li>
            Ask the agent to put the finished slides up. It returns the URL of a
            manage page. Check the slides there and press “Publish this
            version”.
          </li>
        </ol>
        <h3>What the agent can do</h3>
        <ul>
          <li>List your slides</li>
          <li>Put new slides up</li>
          <li>
            Replace slides with a new version (the public version does not
            change until a person replaces it)
          </li>
          <li>Check the state of an upload</li>
        </ul>
        <p>
          Small HTML (up to ${n.agentMb} MB of text files together) is passed in
          the tool’s arguments. Anything larger, or with images and the like,
          the agent sends directly to an address it is given. A zip cannot be
          passed; files go as a list of paths and contents. The limits are the
          same as when you put slides up from the browser (a version
          ${n.versionMb} MB, a file ${n.fileMb} MB, ${n.files} files, ${n.decks}
          slides per person), and so is the invitation.
        </p>
        <h3>What the agent cannot do</h3>
        <p>
          It cannot publish, stop publishing, delete, rename the URL or change
          settings. Slides it puts up are visible only to you until you press
          “Publish this version” on the manage page.
        </p>
        <h3>How to revoke</h3>
        <p>
          In “Settings”, under “Connected agents”, press “Disconnect” for the
          agent. Its next request is refused, and its unfinished uploads end.
        </p>`,
    follow: html` <p>
        When you follow someone, you are told when they publish new slides.
      </p>
      <h3>When you follow</h3>
      <ul>
        <li>
          Press “Follow” on their profile or beside the author’s name on their
          slides. You need to be signed in. You cannot follow yourself.
        </li>
        <li>
          When they publish new slides, it arrives in the bell’s notifications
          and shows in “New from people you follow” on your top page while
          signed in (the 4 most recently published).
        </li>
        <li>They are notified that you followed them.</li>
      </ul>
      <h3>The lists</h3>
      <p>
        The “Following” and “Followers” lists on a profile, and their counts,
        can be seen by anyone, including people who are not signed in. People
        you muted do not appear in the lists you see. Suspended people and
        people who left never appear to anyone.
      </p>
      <h3>Unfollowing</h3>
      <p>
        On your own profile, choose the person under “Following”. You can also
        unfollow from the “Following” button on their profile or slides. Then
        you disappear from their followers, and you no longer get notifications
        of their new slides. Muting someone, or leaving, also ends a follow.
      </p>`,
    terms: html` <p>
      You can read the <a href="/terms">Terms of Service</a>. It is a draft page
      for now, and the final text has not been decided.
    </p>`,
    privacy: html` <p>
      You can read the <a href="/privacy">Privacy Policy</a>. It is a draft page
      for now, and the final text has not been decided.
    </p>`,
  },
})

export type HelpSection = Readonly<{
  id: HelpSectionId
  title: string
  body: Html
}>

/** The sections of the help in the table of contents' order. */
export function helpSections(lang: Lang): readonly HelpSection[] {
  const t = text[lang]
  const n = helpNumbers()
  const bodies: Readonly<Record<HelpSectionId, Html>> = {
    upload: t.upload(n),
    'page-share': t.pageShare(n),
    citations: t.citations,
    embed: t.embed,
    agent: t.agent(n),
    follow: t.follow,
    safety: safetyHelp(lang),
    terms: t.terms,
    privacy: t.privacy,
  }
  return HELP_SECTION_IDS.map((id) => ({
    id,
    title: t.toc[id],
    body: bodies[id],
  }))
}

/** The page's own words: its title and the label of its table of contents. */
export const helpLabels = (lang: Lang) => ({
  title: text[lang].title,
  tocLabel: text[lang].tocLabel,
})
