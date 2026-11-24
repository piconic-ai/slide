import { html } from 'hono/html'
import type { HtmlEscapedString } from 'hono/utils/html'
import { MAX_EMBEDS, MAX_ARTICLE_CHARS } from '../articles/markdown'
import { CODE_ATTEMPTS, CODE_LENGTH, CODE_SECONDS } from '../auth/login-policy'
import { MAX_ARGUMENT_BYTES } from '../mcp/files'
import { MAX_LINKS, MAX_TITLE_LENGTH } from '../links/link'
import { PICTURE_MAX_BYTES } from '../profile/picture-policy'
import {
  BIO_MAX,
  LINKS_MAX,
  LOCATION_MAX,
  NAME_MAX,
} from '../profile/profile-lines'
import { LINK_SCAN_BYTES } from '../citations/citation'
import { DECKS_SHOWN } from '../citations/citing'
import { MAX_SHOT_PAGE } from '../covers/shot'
import { MAX_SLUG_LENGTH } from '../decks/slug-name'
import { STASH_CONTINUE_MAX_AGE_MS, STASH_MAX_AGE_MS } from '../drops/stash'
import { HOME_FOLLOWING_SHOWN } from './home-shape'
import { safetyHelp } from '../safety/pages'
import { MAX_PAGE } from '../share/path'
import { DEFAULT_UPLOAD_LIMITS } from '../uploads/limits'
import { messages, type Lang } from './i18n'

type Html = HtmlEscapedString | Promise<HtmlEscapedString>

/** The ids of the help's sections, in the order the table of contents lists. */
export const HELP_SECTION_IDS = [
  'login',
  'profile',
  'upload',
  'article',
  'links',
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
    citationsShown: DECKS_SHOWN,
    followingShown: HOME_FOLLOWING_SHOWN,
    linkScanKb: LINK_SCAN_BYTES / 1024,
    stashHours: STASH_MAX_AGE_MS / 3_600_000,
    continueMinutes: STASH_CONTINUE_MAX_AGE_MS / 60_000,
    slugLength: MAX_SLUG_LENGTH,
    codeDigits: CODE_LENGTH,
    codeMinutes: CODE_SECONDS / 60,
    codeAttempts: CODE_ATTEMPTS,
    articleChars: MAX_ARTICLE_CHARS.toLocaleString('en-US'),
    embeds: MAX_EMBEDS,
    maxLinks: MAX_LINKS,
    linkTitleChars: MAX_TITLE_LENGTH,
    nameChars: NAME_MAX,
    bioChars: BIO_MAX,
    locationChars: LOCATION_MAX,
    profileLinks: LINKS_MAX,
    pictureMb: PICTURE_MAX_BYTES / MEBIBYTE,
  })
type Numbers = ReturnType<typeof helpNumbers>

type Text = Readonly<{
  title: string
  tocLabel: string
  toc: Readonly<Record<HelpSectionId, string>>
  login: (n: Numbers) => Html
  profile: (n: Numbers) => Html
  upload: (n: Numbers) => Html
  article: (n: Numbers) => Html
  links: (n: Numbers) => Html
  pageShare: (n: Numbers) => Html
  citations: (n: Numbers) => Html
  embed: Html
  agent: (n: Numbers) => Html
  follow: (n: Numbers) => Html
  terms: Html
  privacy: Html
}>

const text = messages<Text>({
  ja: {
    title: 'ヘルプ',
    tocLabel: 'ヘルプの目次',
    toc: {
      login: 'ログイン',
      profile: 'プロフィール',
      upload: '置き方',
      article: '記事',
      links: '関連リンク',
      'page-share': 'ページごとの共有',
      citations: '引用',
      embed: 'ブログへの埋め込み',
      agent: 'AI エージェントから置く',
      follow: 'フォロー',
      safety: '安全について',
      terms: '規約',
      privacy: 'プライバシー',
    },
    login: (n) =>
      html` <p>
          slide
          のログインは、メールアドレスに送るコードだけです。パスワードは使いません。GitHub
          などほかのアカウントでのログインはありません。
        </p>
        <h3>ログインのしかた</h3>
        <ol>
          <li>
            ヘッダーの「ログイン」を開き、メールアドレスを入れて「コードを送る」を押します。
          </li>
          <li>
            メールで届いた ${n.codeDigits}
            桁のコードを入れて「ログイン」を押します。
          </li>
          <li>
            初めてのときは、ハンドル(スライドの URL
            に入る名前)と表示名を決め、利用規約とプライバシーポリシーに同意して、「はじめる」を押します。ハンドルはあとから変えられません。決めるまで、ほかの画面へは進めません。同意しないときは、「登録せずに終了する」を押すと、入力したメールアドレスを削除します。
          </li>
        </ol>
        <p>
          ログインすると、見ていたページへ戻ります。トップでファイルを預けていたときは、受け取りに進みます。
        </p>
        <h3>いまは招待制です</h3>
        <p>
          運営が登録したメールアドレスでだけ、ログインできます。登録されていないアドレスを入れても、画面は同じ「コードを送りました」になりますが、コードは届きません。ログインできた人は、全員スライドを置けます。
        </p>
        <h3>コード</h3>
        <ul>
          <li>コードの有効期限は ${n.codeMinutes} 分です。</li>
          <li>
            入力を ${n.codeAttempts}
            回間違えると、そのコードは使えなくなります。「コードを送り直す」で新しいコードを受け取ってください。
          </li>
          <li>
            コードを短い間に何度も頼むと、しばらく送れなくなります。画面に、いつ以降にもう一度頼めるかが出ます。
          </li>
        </ul>
        <h3>メールが届かないとき</h3>
        <p>
          迷惑メールフォルダを確かめ、メールアドレスの打ち間違いがないかを見てください。登録されていないアドレスにも、コードは届きません。
        </p>
        <h3>メールアドレスの変更、受信箱を失ったとき</h3>
        <p>
          メールアドレスを変える画面はありません。アドレスを変えたいとき、受信箱に入れなくなったときは、<a
            href="/contact"
            >お問い合わせ</a
          >からご連絡ください。個別に対応します。
        </p>
        <p>
          メールアドレスは、自分の「設定」の「アカウント」にだけ出ます。ほかの人には見えません。
        </p>`,
    profile: (n) =>
      html` <p>
          プロフィールは、自分で「設定」の「プロフィール」に書きます。書いたものは、プロフィールのページに出ます。
        </p>
        <h3>書けること</h3>
        <ul>
          <li>表示名(必須。${n.nameChars} 文字まで)</li>
          <li>自己紹介(${n.bioChars} 文字まで)</li>
          <li>場所(${n.locationChars} 文字まで)</li>
          <li>Web サイト(1 つ)</li>
          <li>SNS のリンク(${n.profileLinks} つまで)</li>
        </ul>
        <p>
          リンクは <code>https://</code>
          で始まる URL
          だけ使えます。ハンドルは、はじめに決めたあと変えられません。
        </p>
        <h3>プロフィール画像</h3>
        <p>プロフィール画像は、次の順に使います。</p>
        <ol>
          <li>
            アップロードした画像。PNG、JPEG、WebP が使え、${n.pictureMb} MB
            までです。正方形に縮めて、slide が配ります。
          </li>
          <li>
            メールアドレスの Gravatar の画像。「Gravatar
            の画像を使う」を切ると、使いません。
          </li>
          <li>どちらもなければ、名前の頭文字。</li>
        </ol>
        <p>
          アップロードした画像は、「アップロードしたプロフィール画像を外す」でいつでも外せます。外すと、Gravatar
          の画像、なければ頭文字に戻ります。
        </p>
        <h3>メールアドレスは見えません</h3>
        <p>
          メールアドレスは、ほかの人には見えません。Gravatar の画像も、slide
          が取ってきて配るので、ページにはメールアドレスも、そこから作った値も出ません。
        </p>`,
    article: (n) =>
      html` <p>
          スライドの下に、発表の書き起こしなどの記事を載せられます。記事は、スライドを置いた作者だけが書けます。スライド
          1 本につき、記事は 1 本です。
        </p>
        <h3>書く場所</h3>
        <p>
          スライドの編集の画面の「記事」の枠から「記事を書く」(書いたあとは「記事を編集する」)を押すと、記事の編集のページが開きます。入力欄に
          Markdown
          を書きます。画面の上の「ビューアーで見る」を押すと、保存する前の本文で、読者と同じ表示が開きます(「編集に戻る」で、書いていた本文のまま戻れます)。本文は
          ${n.articleChars} 文字までです。
        </p>
        <h3>自動保存</h3>
        <p>
          入力して 1.5
          秒ほど待つと、本文は自動で保存されます。入力欄の下に、「保存しました(時刻)」のように状態が出ます。保存できなかったときも、入力は消えず、もう一度試します。自動保存が済んでいない間にページを離れようとすると、確認が出ます。
        </p>
        <h3>下書きと公開</h3>
        <ul>
          <li>
            公開する前は、下書きです。自動で保存され、作者だけが、viewer
            でそのまま確かめられます。
          </li>
          <li>
            スライドの編集の画面の「記事」の枠で「記事を公開する」を押すと、スライドが一般公開されている間だけ、viewer
            のスライドの下に載ります(編集の画面の入力欄ではなく、保存済みの本文が公開されます)。
          </li>
          <li>
            公開したあとに直した内容は、「編集中の下書き」として自動で保存されますが、「公開記事を更新」を押すまで、読者には見えません。編集中の下書きがあるときは、「未反映の変更あり」と出ます。
          </li>
          <li>
            「変更を取り消す」を押すと、編集中の下書きを捨てて、公開中の本文に戻ります。スライドの編集の画面の「記事の公開を止める」を押すと、保存済みの本文(編集中の下書きがあればそれ)が下書きの本文になります。
          </li>
        </ul>
        <h3>ページの埋め込み</h3>
        <p>
          ページ番号つきの共有 URL(<code>https://…/@ハンドル/URL の名前/3</code
          >)を、段落の中でその URL だけで 1
          行に書くと、そのページの画像が入ります(1 本の記事で ${n.embeds}
          ページまで)。
        </p>
        <ul>
          <li>
            自分のこのスライドのページなら、画像を押すと、上のスライドがそのページに移ります。
          </li>
          <li>
            ほかの人の一般公開中のスライドなら、「△△さんの『□□』3
            ページ」と画像が出て、押すとそのスライドのそのページが開きます。
          </li>
          <li>
            一般公開されていないスライド、存在しないスライドやページは、画像を出さず、ふつうのリンクになります。いまの版にないページは、編集のページでお知らせします。
          </li>
          <li>文の中に書いた URL は、ふつうのリンクになります。</li>
        </ul>
        <h3>引用として数えられます</h3>
        <p>
          記事の中の、ほかのスライドの共有 URL
          へのリンクは、スライドの中のリンクと同じく、引用として数えられます(「引用」の節を読んでください)。数えるのは記事が公開中の間だけで、自分のこのスライドへのリンクは数えません。
        </p>
        <h3>使える書き方、使えないもの</h3>
        <ul>
          <li>
            使えるのは、CommonMark(見出し、段落、箇条書き、引用、コード、リンクなど)と、表、取り消し線、自動リンクです。
          </li>
          <li>
            HTML と script
            は使えません。書くと、文字として表示されます。画像も入れられません。
          </li>
          <li>
            リンクは <code>https:</code>、<code>http:</code>、<code
              >mailto:</code
            >
            だけです。読者には、外へのリンクとして開きます。
          </li>
          <li>見出しは、記事の中の小見出しとして表示されます。</li>
        </ul>
        <h3>AI エージェントから下書きを書く</h3>
        <p>
          MCP につないだ AI エージェントは、記事を読んで、下書きを書けます(「AI
          エージェントから置く」の節を読んでください)。公開はできません。公開中の記事に書いたものは、編集中の下書きに入り、あなたが「公開記事を更新」を押すまで読者には見えません。エージェントが書いたあとに、開いたままの編集のページで続けて書こうとすると、「別のタブで更新されています」と出ます。再読み込みすると、エージェントが書いた本文になります。
        </p>`,
    links: (n) =>
      html` <p>
          録画、ブログの記事など、外のページへのリンクを、スライドの題名の下に載せられます。
        </p>
        <h3>足しかた</h3>
        <ol>
          <li>スライドの編集の画面の「関連リンク」の枠を開きます。</li>
          <li>
            URL
            を入れ、題名は入れたいときだけ入れて、「追加する」を押します。種類(動画、記事、その他)は、URL
            から決まります。
          </li>
          <li>
            要らなくなったら、その行の「外す」を押します。並びは足した順で、並べ替えはできません。
          </li>
        </ol>
        <h3>決まり</h3>
        <ul>
          <li>
            種類は、動画、記事、その他の 3 つで、URL
            のホスト名から決まります(YouTube や Vimeo などは動画、Zenn や Qiita
            などは記事、それ以外はその他)。
          </li>
          <li>1 本のスライドに、${n.maxLinks} 件までです。</li>
          <li>
            URL は <code>https://</code> で始まるものだけです。題名は
            ${n.linkTitleChars} 文字までで、入れなくてもかまいません。
          </li>
          <li>
            題名を入れなかったときは、サイト名(URL のホスト名。例:
            <code>zenn.dev</code>)だけを出します。リンク先は、slide
            が取りに行きません(題名も取りません)。動画は埋め込まず、リンクだけです。
          </li>
        </ul>
        <p>
          読者には、スライドが一般公開されている間だけ見えます。作者は、作者だけが見られる間も
          viewer で確かめられます。関連リンクは、引用としては数えません。
        </p>`,
    upload: (n) =>
      html` <p>
          slide
          は、いまは招待制です。運営が登録したメールアドレスの人だけが、ログインして、スライドを置けます。登録していない人には、ログインのコードが届かないので、ファイルを置けません(くわしくは「ログイン」の節を読んでください)。
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
            が足す <code>__MACOSX/</code>、<code>.DS_Store</code>、<code
              >._</code
            >
            で始まるファイルは、無いものとして扱います。<code>index.html</code>
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
            トップか「スライドの管理」に、ファイルをドロップします(「ファイルを選ぶ」からも選べます)。ログインしていないときは、ファイルをこのブラウザの中に預かります。このタブで「ログインして続ける」を押し、メールのコードでログインして、${n.continueMinutes}
            分以内に戻ると、自動で受け取ります。ヘッダーの「ログイン」からログインしたときや、${n.continueMinutes}
            分を過ぎたときは自動では受け取らないので、もう一度ファイルをドロップしてください。預かるのは
            1 件だけで、${n.stashHours}
            時間たつと捨てます。ログインした状態でトップを開くと、預かったファイルは捨てられます。
          </li>
          <li>
            受け取ったスライドは、作者だけが見られる状態で、スライドの編集の画面に開きます。題名は
            <code>index.html</code> の <code>&lt;title&gt;</code>、URL
            の名前は題名かファイル名から決めてあります。
          </li>
          <li>
            表示を確かめます。「公開する」を押すと、共有 URL (<code
              >/@ハンドル/URL の名前</code
            >)をだれでも開けるようになります。
          </li>
        </ol>
        <p>
          公開を止めるときは、同じページの「公開を止める」を押します。止めると、読者は開けなくなります。もう一度公開すると、同じ
          URL
          で開けます。止めたあと、新しい版を受け取っても、自動では公開し直しません。
        </p>
        <h3>差し替える</h3>
        <p>
          直した版は、スライドの編集の画面の「新しい版」にドロップします。共有
          URL
          は変わりません。公開中の版は、「新しい版」の行の「この版を公開する」を押すまで変わらないので、発表中に差し替えても、読者に見える版は動きません。
        </p>
        <h3>URL の名前</h3>
        <p>
          URL の名前は、公開する前だけ、スライドの編集の画面の「URL
          を変える」で変えられます。公開したあとは、その行は出ません。公開した
          URL は、viewer
          の「共有」からコピーできます。英小文字、数字、ハイフンで、${n.slugLength}
          文字までです。先頭と末尾は、英小文字か数字にします。<code
            >following</code
          >
          や
          <code>followers</code>
          など、サービスが使っている名前は選べません。一度公開したスライドは、公開を止めたあとも変えられません。同じ人の中で名前が重なったときは、<code>-2</code>、<code
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
        </ul>
        <p>
          ページを伝える script を、作者が書く必要はありません。slide
          が、スライドを配るときに、その版の
          <code>index.html</code>
          に入れます。スライドが自分の CSP(<code
            >&lt;meta http-equiv="Content-Security-Policy"&gt;</code
          >)を持っていても、その script
          だけが動くように調整し、ほかの許可は広げません。
        </p>
        <p>
          ページ番号が伝わらないスライドでは、「いま見ているページの URL
          をコピー」は出ません。
        </p>
        <h3>番号の決まり</h3>
        <ul>
          <li>
            スライドが開くのは 1 から ${n.viewerPage} までの番号です。<code
              >0</code
            >
            や ${n.viewerPage + 1} 以上、数字でない番号の URL
            は、見つからないページになります。<code>03</code> のように先頭に 0
            を付けた番号は、正しい表記(<code>3</code>)へ移ります。
          </li>
          <li>
            カードにページの画像が出るのは、1 から ${n.shotPage}
            までです。それより大きい番号と、撮影に失敗したときは、表紙が出ます。1
            ページ目の URL(番号なし)も、表紙です。
          </li>
        </ul>
        <p>
          SNS が一度取得したカードの画像をいつ更新するかは、SNS
          が決めます。スライドを直したあとも、古い画像がしばらく残ることがあります。
        </p>`,
    citations: (n) =>
      html` <p>
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
            ファイルごとに、先頭の ${n.linkScanKb} KB までです。画像を埋め込んだ
            1
            ファイルのスライドでは、後ろのほうのリンクは読まれないことがあります。
          </li>
          <li>
            同じスライドへのリンクは、引用になりません。同じ作者の別のスライドへのリンクは、引用になります。何ページで引用しても、1
            回だけ数えます。
          </li>
          <li>
            記事の中の共有 URL
            へのリンクも、引用になります(「記事」の節を読んでください)。数えるのは、記事が公開中の間だけです。
          </li>
        </ul>
        <h3>どこに出るか</h3>
        <ul>
          <li>
            引用された側の viewer
            の下に「このスライドを引用しているスライド」、引用した側の viewer
            の下に「このスライドが引用しているスライド」が、表紙のカードで出ます。${n.citationsShown}
            件まで並べ、残りは「ほか N 件」と件数で示します。1
            件もないときは、見出しごと出ません。
          </li>
          <li>
            スライドの中の共有 URL へのリンクを読者が押すと、viewer
            がそのスライドへ移ります。ほかの URL へは移りません。
          </li>
          <li>
            プロフィールの「引用した」には、その人のスライド(または記事)が引用した、ほかの人のスライドが出ます。「引用された」には、ほかの人のスライド(または記事)が引用した、その人のスライドが出ます。どちらも、引用の組ごとに
            1
            行で、引用が生まれた日の新しい順に並び、プロフィールの頭に件数が出ます。
          </li>
          <li>
            自分のスライド同士の引用は、プロフィールの一覧にも件数にも入りません(viewer
            には出ます)。
          </li>
        </ul>
        <h3>消えるとき</h3>
        <p>
          viewer
          の引用は、引用した側と、された側の両方が一般公開されている間だけ出ます。どちらかの公開を止めると消え、もう一度公開すると戻ります。読むのは公開中の版なので、新しい版を受け取っても、公開中の版を入れ替えるまでは、出る引用は変わりません。viewer
          では、読者がミュートしている作者のスライドは出ません。運営が非表示にしたスライド、停止中の作者のスライドは、どちらにも出ません。引用は表紙のカードで出すだけで、引用したスライドを相手のページの上で動かすことはしません。
        </p>`,
    embed: html` <p>
        公開中のスライドは、ブログの記事の中でめくれる形で埋め込めます。
      </p>
      <h3>貼りかた</h3>
      <ol>
        <li>
          スライドの viewer
          の「共有」から「埋め込みコードをコピー」を押します。埋め込みコードは、viewer
          の「共有」からだけ取れます。
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
          アドレスと開いたことが伝わります。このページの下の「知らない人のスライドを開くとき」を読んでください。
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
            できたスライドを「置いて」と頼むと、エージェントが
            スライドの編集の画面の URL
            を返します。そのページで表示を確かめて、「公開する」を押します。
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
          <li>
            記事を読み、下書きを書く(公開は、人が行います。公開中の記事に書いたものは編集中の下書きに入り、「公開記事を更新」を押すまで読者には見えません。本文は
            ${n.articleChars} 文字までです)
          </li>
          <li>
            関連リンクを足す、外す(<code>https://</code> の URL を、1 本に
            ${n.maxLinks} 件まで)
          </li>
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
          スライドや記事を公開すること、公開を止めること、削除すること、URL
          の名前を変えること、設定を変えることはできません。置かれたスライドは、あなたがスライドの編集の画面で「公開する」を押すまで、自分だけが見られます。
        </p>
        <h3>取り消しかた</h3>
        <p>
          「設定」の「接続済みのエージェント」で、取り消したいエージェントの「接続を取り消す」を押します。取り消したエージェントの次の要求は、断られます。途中だった受け取りも終わります。
        </p>`,
    follow: (n) =>
      html` <p>
          気になる人をフォローすると、その人が新しいスライドを公開したときに知らせが届きます(お知らせは、設定で受け取らないようにもできます)。
        </p>
        <h3>フォローすると</h3>
        <ul>
          <li>
            相手のプロフィールか、スライドの作者名のそばの「フォロー」を押します。ログインが必要です。自分自身はフォローできません。
          </li>
          <li>
            相手が新しいスライドを公開すると、ヘッダーのベルのお知らせに届き、ログイン中のトップの「フォロー中の人の新着」に出ます(公開が新しい順に
            ${n.followingShown} 件まで)。
          </li>
          <li>
            相手には、あなたがフォローしたことが、お知らせで伝わります(相手が設定で止めていなければ)。
          </li>
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
      login: 'Signing in',
      profile: 'Your profile',
      upload: 'Putting slides up',
      article: 'Articles',
      links: 'Related links',
      'page-share': 'Sharing a page',
      citations: 'Citations',
      embed: 'Embedding in a blog',
      agent: 'Putting up from an AI agent',
      follow: 'Following',
      safety: 'Safety',
      terms: 'Terms',
      privacy: 'Privacy',
    },
    login: (n) =>
      html` <p>
          Signing in to Slide is only by a code we email you. There is no
          password, and no sign-in with GitHub or another account.
        </p>
        <h3>How to sign in</h3>
        <ol>
          <li>
            Open “Sign in” in the header, enter your email address and press
            “Send the code”.
          </li>
          <li>
            Enter the ${n.codeDigits}-digit code from the email and press “Sign
            in”.
          </li>
          <li>
            The first time, choose a handle (the name in the URL of your slides)
            and a display name, and agree to the Terms of Service and the
            Privacy Policy, then press “Get started”. The handle cannot be
            changed later, and you cannot go to other pages until you have
            chosen. If you do not agree, press “Leave without signing up” and
            the email address you entered is deleted.
          </li>
        </ol>
        <p>
          After signing in you return to the page you were on. If you had left a
          file on the top page, it is received.
        </p>
        <h3>Invitation only for now</h3>
        <p>
          Only email addresses the operators registered can sign in. If you
          enter one that is not registered, the screen still says the code was
          sent, but no code arrives. Everyone who can sign in can put slides up.
        </p>
        <h3>The code</h3>
        <ul>
          <li>A code works for ${n.codeMinutes} minutes.</li>
          <li>
            After ${n.codeAttempts} wrong tries the code stops working. Press
            “Send the code again” for a new one.
          </li>
          <li>
            If you ask for codes too often in a short time, none are sent for a
            while. The screen says when you can ask again.
          </li>
        </ul>
        <h3>If the email does not arrive</h3>
        <p>
          Check your spam folder and the spelling of the address. An address
          that is not registered gets no code either.
        </p>
        <h3>Changing your email address, or losing your inbox</h3>
        <p>
          There is no screen to change the email address. If you want to change
          it, or can no longer open your inbox, please
          <a href="/contact">contact us</a>. We handle each case individually.
        </p>
        <p>
          Your email address is shown only on your own “Settings”, under
          “Account”. Nobody else can see it.
        </p>`,
    profile: (n) =>
      html` <p>
          You write your profile yourself, in “Settings” under “Profile”. What
          you write is shown on your profile page.
        </p>
        <h3>What you can write</h3>
        <ul>
          <li>Display name (required; up to ${n.nameChars} characters)</li>
          <li>Bio (up to ${n.bioChars} characters)</li>
          <li>Location (up to ${n.locationChars} characters)</li>
          <li>A website (one)</li>
          <li>Social links (up to ${n.profileLinks})</li>
        </ul>
        <p>
          Links must be URLs that start with <code>https://</code>. The handle
          cannot be changed after you choose it at the start.
        </p>
        <h3>Your profile picture</h3>
        <p>The profile picture is taken in this order.</p>
        <ol>
          <li>
            An image you upload. PNG, JPEG and WebP work, up to ${n.pictureMb}
            MB. It is shrunk to a square and served by Slide.
          </li>
          <li>
            The Gravatar picture of your email address. Turn off “Use my
            Gravatar picture” to not use it.
          </li>
          <li>Failing both, the initial of your name.</li>
        </ol>
        <p>
          You can remove an uploaded image at any time with “Remove the uploaded
          profile picture”. The Gravatar picture, or else your initial, comes
          back.
        </p>
        <h3>Your email address stays hidden</h3>
        <p>
          Nobody else can see your email address. Slide fetches and serves the
          Gravatar picture itself, so no page shows the address or anything made
          from it.
        </p>`,
    article: (n) =>
      html` <p>
          You can put an article, such as a transcript of your talk, under the
          slides. Only the author of the slides can write it. Each slide has at
          most one article.
        </p>
        <h3>Where to write</h3>
        <p>
          On the edit page of the slides, press “Write the article” (afterwards
          “Edit the article”) in the “Article” area to open the article page.
          Type Markdown in the box. “View in viewer” at the top opens the page
          as readers will see it, drawn from the text you have not saved yet
          (“Back to editing” returns with the text as it was). The text can have
          up to ${n.articleChars} characters.
        </p>
        <h3>Autosave</h3>
        <p>
          About 1.5 seconds after you stop typing, the text is saved by itself.
          Under the box you see the state, such as “Saved (12:34)”. If saving
          fails, what you typed stays and it is tried again. If you try to leave
          while a save is not done, you are asked first.
        </p>
        <h3>Draft and published</h3>
        <ul>
          <li>
            Before it is published, it is a draft. It is saved by itself, and
            only you see it in the viewer, as readers would.
          </li>
          <li>
            Press “Publish the article” in the “Article” area of the slide’s
            edit page, and it appears under the slides in the viewer for as long
            as the slides are public (what is kept is published, not the box of
            the article page).
          </li>
          <li>
            What you change after publishing is saved by itself as an edit of
            its own, but readers do not see it until you press “Update published
            article”. While there is such an edit, “Changes not shown yet” is
            shown.
          </li>
          <li>
            “Undo changes” drops the edit and brings back the published text.
            “Stop publishing the article” on the slide’s edit page turns it into
            a draft holding the text that was kept (the edit, if there is one).
          </li>
        </ul>
        <h3>Embedding a page</h3>
        <p>
          Write a share URL with a page number
          (<code>https://…/@handle/name/3</code>) alone on a line in its own
          paragraph, and an image of that page is put in (up to ${n.embeds}
          different pages in one article).
        </p>
        <ul>
          <li>
            For a page of these slides, pressing the image moves the slides
            above to that page.
          </li>
          <li>
            For a page of someone else’s public slides, the image comes with
            “Page 3 of ‘…’ by …”, and pressing it opens that page of their
            slides.
          </li>
          <li>
            For slides that are not public, or slides or pages that do not
            exist, no image is shown and it is a plain link. A page that the
            current version does not have is pointed out on the article page.
          </li>
          <li>A URL written inside a sentence is a plain link.</li>
        </ul>
        <h3>Links count as citations</h3>
        <p>
          A link in an article to the share link of other slides counts as a
          citation, just like a link inside the slides (see “Citations”). It
          counts only while the article is published, and a link to these same
          slides does not count.
        </p>
        <h3>What you can write, and what you cannot</h3>
        <ul>
          <li>
            CommonMark (headings, paragraphs, lists, quotes, code, links and so
            on) works, and so do tables, strikethrough and automatic links.
          </li>
          <li>
            HTML and scripts do not work: they are shown as text. Images cannot
            be put in.
          </li>
          <li>
            Links can be <code>https:</code>, <code>http:</code> or
            <code>mailto:</code> only. They open as links to other sites.
          </li>
          <li>Headings show as sub-headings of the article.</li>
        </ul>
        <h3>Writing a draft from an AI agent</h3>
        <p>
          An AI agent connected by MCP can read the article and write a draft of
          it (see “Putting up from an AI agent”). It cannot publish. What it
          writes on a published article goes into the working draft, and readers
          do not see it until you press “Update published article”. If the
          article page is still open from before the agent wrote, it says “It
          was updated in another tab”; reload it to get the agent’s text.
        </p>`,
    links: (n) =>
      html` <p>
          You can put links to other pages, such as a recording or a blog post,
          under the title of the slides.
        </p>
        <h3>How to add one</h3>
        <ol>
          <li>Open the “Related links” area on the edit page of the slides.</li>
          <li>
            Enter the URL, a title only if you want one, and press “Add”. The
            kind (Video, Article or Other) is read from the URL.
          </li>
          <li>
            When you no longer need one, press “Remove” on its row. They stay in
            the order you added them, and cannot be reordered.
          </li>
        </ol>
        <h3>The rules</h3>
        <ul>
          <li>
            The kinds are Video, Article and Other, read from the host name of
            the URL (YouTube and Vimeo are videos; Zenn and Qiita are articles;
            anything else is Other).
          </li>
          <li>One slide can have up to ${n.maxLinks} links.</li>
          <li>
            The URL must start with <code>https://</code>. The title is
            optional, up to ${n.linkTitleChars} characters.
          </li>
          <li>
            Without a title, only the site name (the host name of the URL, e.g.
            <code>zenn.dev</code>) is shown. Slide does not fetch the page, not
            even for its title. A video is not embedded; it is only a link.
          </li>
        </ul>
        <p>
          Readers see them only while the slides are public. You can check them
          in the viewer while the slides are visible only to you. Related links
          do not count as citations.
        </p>`,
    upload: (n) =>
      html` <p>
          Slide is invite-only for now. Only people whose email address the
          operators registered can sign in and put slides up. Someone who is not
          registered gets no sign-in code, so they cannot put slides up (see
          “Signing in”).
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
            the root. The <code>__MACOSX/</code> folder,
            <code>.DS_Store</code> and files starting with <code>._</code> that
            macOS adds are ignored. A zip where <code>index.html</code> cannot
            be found is refused, with the reason.
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
            is kept in this browser. If you press “Sign in to continue” in this
            tab, sign in with the emailed code and return within
            ${n.continueMinutes} minutes, it is received automatically. If you
            sign in from the header instead, or take longer, it is not received
            by itself, so drop the file again. Only one file is kept, and it is
            discarded after ${n.stashHours} hours. Opening the top page while
            signed in discards it too.
          </li>
          <li>
            The slides open on an edit page, visible only to you. The title
            comes from the <code>&lt;title&gt;</code> of
            <code>index.html</code>, and the name in the URL from the title or
            the file name.
          </li>
          <li>
            Check how they look. Press “Publish” and anyone can open the share
            link (<code>/@handle/name</code>).
          </li>
        </ol>
        <p>
          To stop publishing, press “Stop publishing” on the same page. Readers
          can no longer open the slides; publish again and they open at the same
          URL. A new version received afterwards does not publish again by
          itself.
        </p>
        <h3>Replacing slides</h3>
        <p>
          Drop the fixed version on “New version” on the edit page. The share
          link stays the same. The public version does not change until you
          press “Publish this version” on the row of the new version, so
          replacing slides in the middle of a talk does not move what readers
          see.
        </p>
        <h3>The name in the URL</h3>
        <p>
          You can change the name in the URL with “Change the URL” on the edit
          page, only before you publish. After that the row is gone; copy the
          public URL with “Share” in the viewer. Use lowercase letters, digits
          and hyphens, up to ${n.slugLength} characters, starting and ending
          with a letter or a digit. Names the service uses, such as
          <code>following</code> and <code>followers</code>, cannot be chosen.
          Once slides were published, the name cannot be changed, even after you
          stop publishing. When a name is already taken among your slides,
          <code>-2</code>, <code>-3</code> is added.
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
        </ul>
        <p>
          The author does not need to write the script that reports the page.
          Slide puts it into the <code>index.html</code> of the version as it
          serves the slides. When the slides declare their own CSP (<code
            >&lt;meta http-equiv="Content-Security-Policy"&gt;</code
          >), Slide lets that one script run and allows nothing more.
        </p>
        <p>
          For slides whose page is not reported, “Copy link to this page” is not
          shown.
        </p>
        <h3>Page numbers</h3>
        <ul>
          <li>
            The slides open at numbers from 1 to ${n.viewerPage}. A link with
            <code>0</code>, ${n.viewerPage + 1} or more, or a number that is not
            digits is a page that is not found. A number with a leading zero
            such as <code>03</code> moves to the right spelling
            (<code>3</code>).
          </li>
          <li>
            The card shows the page image from 1 to ${n.shotPage}. A larger
            number, or a failed capture, shows the cover. The link of the first
            page without a number shows the cover too.
          </li>
        </ul>
        <p>
          When a social service refreshes a card image it has already taken is
          up to that service. After you fix the slides, the old image may stay
          for a while.
        </p>`,
    citations: (n) =>
      html` <p>
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
            confirmed. For each HTML file, the first ${n.linkScanKb} KB are
            read. In a one-file slide with embedded images, a link near the end
            may not be read.
          </li>
          <li>
            A link to the same slides is not a citation. A link to another slide
            by the same author is. However many pages cite them, they are
            counted once.
          </li>
          <li>
            A link to a share link in an article is a citation too (see
            “Articles”). It counts only while the article is published.
          </li>
        </ul>
        <h3>Where it shows</h3>
        <ul>
          <li>
            Under the viewer of the cited slides, “Slides citing these slides”
            shows as cover cards, and under the viewer of the citing slides,
            “Slides these slides cite”. Up to ${n.citationsShown} are shown and
            the rest as “N more”. When there are none, the heading is left out.
          </li>
          <li>
            When a reader presses a link to a share link inside the slides, the
            viewer moves to those slides. It does not move to other URLs.
          </li>
          <li>
            On a profile, “Citing” lists the slides of other people that this
            person’s slides (or articles) cite, and “Cited” lists this person’s
            slides that other people’s slides (or articles) cite. Each pair is
            one row, newest citation first, and the counts are at the top of the
            profile.
          </li>
          <li>
            Citations between a person’s own slides are in neither the lists nor
            the counts of the profile (the viewer still shows them).
          </li>
        </ul>
        <h3>When it goes away</h3>
        <p>
          A citation in the viewer shows only while both the citing and the
          cited slides are public. Stopping either one removes it, and
          publishing again brings it back. The public version is the one that is
          read, so receiving a new version changes the citations only after you
          replace the public version. In the viewer, slides by an author the
          reader muted are not shown. Slides the operators hid, and slides by a
          suspended author, are shown in neither. Citations appear only as cover
          cards; the citing slides are never run on the other slides’ page.
        </p>`,
    embed: html` <p>
        Public slides can be embedded so that readers can flip through them
        inside a blog post.
      </p>
      <h3>How to paste</h3>
      <ol>
        <li>
          In the viewer, press “Share” and then “Copy embed code”. The embed
          code comes from the viewer’s “Share” menu only.
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
          address and that the slides were opened. Read “Opening slides from
          someone you do not know” further down this page.
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
          The page turned to is not passed to the embedding site. Where “Open on
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
            Ask the agent to put the finished slides up. It returns the URL of
            an edit page. Check the slides there and press “Publish this
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
          <li>
            Read an article and write a draft of it (a person publishes it; on a
            published article it goes into the working draft, which readers do
            not see until “Update published article” is pressed; the text can
            have up to ${n.articleChars} characters)
          </li>
          <li>
            Add or remove related links (<code>https://</code> URLs, up to
            ${n.maxLinks} per slide)
          </li>
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
          It cannot publish slides or articles, stop publishing, delete, rename
          the URL or change settings. Slides it puts up are visible only to you
          until you press “Publish” on the edit page.
        </p>
        <h3>How to revoke</h3>
        <p>
          In “Settings”, under “Connected agents”, press “Disconnect” for the
          agent. Its next request is refused, and its unfinished uploads end.
        </p>`,
    follow: (n) =>
      html` <p>
          When you follow someone, you are told when they publish new slides
          (you can turn these notifications off in the settings).
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
            signed in (the ${n.followingShown} most recently published).
          </li>
          <li>
            They are notified that you followed them (unless they turned that
            off in the settings).
          </li>
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
          you disappear from their followers, and you no longer get
          notifications of their new slides. Muting someone, or leaving, also
          ends a follow.
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
    login: t.login(n),
    profile: t.profile(n),
    upload: t.upload(n),
    article: t.article(n),
    links: t.links(n),
    'page-share': t.pageShare(n),
    citations: t.citations(n),
    embed: t.embed,
    agent: t.agent(n),
    follow: t.follow(n),
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
