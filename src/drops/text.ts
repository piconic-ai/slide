import { reasonLabel } from '../decks/history'
import { messages, type Lang } from '../site/i18n'
import type { DropRefusal } from './precheck'
import type { SendFailure } from './send'

const MEBIBYTE = 1024 * 1024

/** A size as a reader takes it in: `4.2 MB`, or `980 KB` under a megabyte. */
export function formatBytes(bytes: number): string {
  return bytes < MEBIBYTE
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / MEBIBYTE).toFixed(1)} MB`
}

const text = messages({
  ja: {
    picked: 'このスライドを置きます',
    pickedFile: (name: string, size: string) => `${name}(${size})`,
    signInToContinue: 'GitHub でログインして続ける',
    pickAnother: '別のファイルにする',
    pickedNote:
      'ログインのあと、このページに戻って自動で受け取ります。公開するまでは自分だけが見られます。',
    notKept:
      'このブラウザではファイルを預かれませんでした。ログインしてから、もう一度ドロップしてください。',
    notReceived: '受け取れませんでした',
    notReceivedNote:
      'ファイルは、このページを開いている間だけ持っています。ページを離れると、もう一度選び直しになります。',
    sendAgain: 'もう一度送る',
    visitorUnknown:
      'ログインしているかを確かめられませんでした。何も送っていません。しばらくしてから、もう一度お試しください。',
    keptUnknown:
      'ログインしているかを確かめられませんでした。預かったファイルは、そのままです。しばらくしてから、ページを読み込み直してください。',
    receiving: '受け取っています',
    receivingNote: '終わると、このスライドを確かめる画面が開きます。',
    progress: (received: number, total: number) =>
      `${total} 個のうち ${received} 個を受け取りました`,
    refusals: {
      unsupported_kind: () => 'HTML(.html)か zip のファイルを選んでください。',
      empty: () => 'ファイルの中身がありません。',
      too_many_files: (count: number, limit: number) =>
        `ファイルが ${count} 個あります。1 つの版に置けるのは ${limit} 個までです。`,
      file_too_large: (path: string, size: string, limit: string) =>
        `${path} は ${size} あります。1 つのファイルは ${limit} までです。`,
      version_too_large: (size: string, limit: string) =>
        `合わせて ${size} あります。1 つの版は ${limit} までです。`,
      unsupported_file: (path: string) =>
        `${path} は、置けない種類のファイルです。`,
      unsupported_path: {
        length: (path: string) =>
          `${path} は、名前が長すぎるため受け取れません。フォルダの名前を含めて 512 byte までです。`,
        reserved_folder: (path: string) =>
          `${path} は受け取れません。_preview という名前のフォルダは、サービスが使っています。`,
        character: (path: string) =>
          `${path} は、名前に使えない文字を含むため受け取れません。%・?・#・:・\\ や、制御文字、結合用の見えない文字は使えません。`,
        hidden: (path: string) =>
          `${path} は受け取れません。「.」で始まる名前や、空の名前のファイルやフォルダは置けません。`,
        reserved_name: (path: string) =>
          `${path} は受け取れません。node_modules、credentials、secrets などの名前のファイルやフォルダは置けません。`,
        program: (path: string) =>
          `${path} は受け取れません。.php・.py・.sh など、プログラムとして動く種類の名前は置けません。`,
        file_and_folder: (path: string) =>
          `${path} が、ファイルとフォルダの両方の名前になっているため、受け取れません。`,
      },
      no_index:
        'zip の直下か、zip の中のただ 1 つのフォルダの直下に、index.html が見つかりません。',
      invalid_zip:
        'zip を読めませんでした。作り直してから、もう一度ドロップしてください。',
      unsupported_zip: {
        encrypted: 'パスワード付きの zip は受け取れません。',
        symlink:
          'zip の中にシンボリックリンクがあるため、受け取れません。リンクを実際のファイルにして作り直してください。',
        zip64:
          'この zip は大きすぎるか、ファイルが多すぎて、受け取れない形式です。',
        compression:
          'この圧縮方式の zip は受け取れません。標準の方式(deflate)で作り直してください。',
        names:
          'zip の中のファイル名が UTF-8 でないため、受け取れません。UTF-8 で作り直してください。',
      },
      unsafe_path: (path: string) =>
        `zip の中の ${path} は、スライドの外を指す名前なので、受け取れません。`,
      duplicate_path: (path: string) => `zip の中に ${path} が 2 つあります。`,
    },
    failures: {
      sign_in:
        'ログインが切れています。ログインし直してから、もう一度ドロップしてください。',
      invitation_only:
        'いまは招待制です。登録された作者だけが、スライドを置けます。',
      deck_limit:
        '置けるスライドの本数の上限に達しています。使わないスライドを削除してから、もう一度ドロップしてください。',
      not_found:
        'このスライドが見つかりません。ページを読み込み直してください。',
      refused: 'いまは、このアカウントではスライドを受け取れません。',
      invalid:
        '受け取れないファイルが含まれています。ファイルの名前と種類を確かめてください。',
      busy: '別の受け取りが進んでいます。少し待ってから、もう一度ドロップしてください。',
      failed: '受け取りを終えられませんでした。もう一度ドロップしてください。',
    } satisfies Record<Exclude<SendFailure, 'limit'>, string>,
  },
  en: {
    picked: 'These slides will be put up',
    pickedFile: (name: string, size: string) => `${name} (${size})`,
    signInToContinue: 'Sign in with GitHub to continue',
    pickAnother: 'Choose another file',
    pickedNote:
      'After you sign in, you come back to this page and the file is received by itself. Only you can see the slides until you publish.',
    notKept:
      'This browser could not keep the file. Sign in, then drop the file once more.',
    notReceived: 'The slides were not received',
    notReceivedNote:
      'The file is held only while this page is open. After leaving the page, choose it again.',
    sendAgain: 'Send again',
    visitorUnknown:
      'Could not check whether you are signed in. Nothing was sent. Try again in a moment.',
    keptUnknown:
      'Could not check whether you are signed in. The file you picked is still kept. Read the page again in a moment.',
    receiving: 'Receiving',
    receivingNote: 'When it is done, the page to check these slides opens.',
    progress: (received: number, total: number) =>
      `Received ${received} of ${total} files`,
    refusals: {
      unsupported_kind: () => 'Choose an HTML (.html) or a zip file.',
      empty: () => 'The file is empty.',
      too_many_files: (count: number, limit: number) =>
        `There are ${count} files. One version holds up to ${limit}.`,
      file_too_large: (path: string, size: string, limit: string) =>
        `${path} is ${size}. One file may be up to ${limit}.`,
      version_too_large: (size: string, limit: string) =>
        `The files are ${size} together. One version may be up to ${limit}.`,
      unsupported_file: (path: string) =>
        `${path} is a kind of file that cannot be put here.`,
      unsupported_path: {
        length: (path: string) =>
          `${path} cannot be received: its name is too long. A path, folders included, may be up to 512 bytes.`,
        reserved_folder: (path: string) =>
          `${path} cannot be received: a folder named _preview is used by the service.`,
        character: (path: string) =>
          `${path} cannot be received: its name has a character that cannot be used. %, ?, #, :, \\, control characters and invisible joining characters are not allowed.`,
        hidden: (path: string) =>
          `${path} cannot be received: files and folders whose name starts with a dot, or is empty, cannot be put here.`,
        reserved_name: (path: string) =>
          `${path} cannot be received: files and folders named node_modules, credentials, secrets and the like cannot be put here.`,
        program: (path: string) =>
          `${path} cannot be received: names of kinds that run as programs, such as .php, .py and .sh, cannot be put here.`,
        file_and_folder: (path: string) =>
          `${path} cannot be received: it names both a file and a folder.`,
      },
      no_index:
        'No index.html was found at the top of the zip, or at the top of the one folder in it.',
      invalid_zip:
        'The zip could not be read. Make it again, then drop it once more.',
      unsupported_zip: {
        encrypted: 'A zip with a password cannot be received.',
        symlink:
          'The zip holds a symbolic link, so it cannot be received. Make it again with the real file in place of the link.',
        zip64: 'This zip is too large or holds too many files to be received.',
        compression:
          'A zip compressed this way cannot be received. Make it again with the standard method (deflate).',
        names:
          'The file names in the zip are not UTF-8, so it cannot be received. Make it again with UTF-8 names.',
      },
      unsafe_path: (path: string) =>
        `${path} in the zip names a place outside the slides, so it cannot be received.`,
      duplicate_path: (path: string) => `${path} is in the zip twice.`,
    },
    failures: {
      sign_in:
        'You are signed out. Sign in again, then drop the file once more.',
      invitation_only:
        'This is by invitation for now. Only registered authors can put slides here.',
      deck_limit:
        'You have as many slides as one account may hold. Delete one you no longer use, then drop the file once more.',
      not_found: 'These slides were not found. Reload the page.',
      refused: 'This account cannot receive slides right now.',
      invalid:
        'Some of the files cannot be received. Check their names and kinds.',
      busy: 'Another upload is in progress. Wait a moment, then drop the file once more.',
      failed: 'The upload did not finish. Drop the file once more.',
    },
  },
})

/** The words of a drop zone while it works, by language. */
export const dropText = (lang: Lang) => ({
  picked: text[lang].picked,
  pickedFile: text[lang].pickedFile,
  signInToContinue: text[lang].signInToContinue,
  pickAnother: text[lang].pickAnother,
  pickedNote: text[lang].pickedNote,
  notKept: text[lang].notKept,
  notReceived: text[lang].notReceived,
  notReceivedNote: text[lang].notReceivedNote,
  sendAgain: text[lang].sendAgain,
  visitorUnknown: text[lang].visitorUnknown,
  keptUnknown: text[lang].keptUnknown,
  receiving: text[lang].receiving,
  receivingNote: text[lang].receivingNote,
  progress: text[lang].progress,
})

/** Why a drop was not sent, naming the limit it is over. */
export function refusalMessage(refusal: DropRefusal, lang: Lang): string {
  const t = text[lang].refusals
  switch (refusal.reason) {
    case 'unsupported_kind':
      return t.unsupported_kind()
    case 'empty':
      return t.empty()
    case 'too_many_files':
      return t.too_many_files(refusal.count, refusal.limit)
    case 'file_too_large':
      return t.file_too_large(
        refusal.path,
        formatBytes(refusal.size),
        formatBytes(refusal.limit),
      )
    case 'version_too_large':
      return t.version_too_large(
        formatBytes(refusal.size),
        formatBytes(refusal.limit),
      )
    case 'unsupported_file':
      return t.unsupported_file(refusal.path)
    case 'unsupported_path':
      return t.unsupported_path[refusal.problem](refusal.path)
    case 'no_index':
      return t.no_index
    case 'invalid_zip':
      return t.invalid_zip
    case 'unsupported_zip':
      return t.unsupported_zip[refusal.feature]
    case 'unsafe_path':
      return t.unsafe_path(refusal.path)
    case 'duplicate_path':
      return t.duplicate_path(refusal.path)
  }
}

/** Why sending did not finish. A limit of the service is named by its reason. */
export function failureMessage(
  failure: Readonly<{ reason: SendFailure; limit?: string | undefined }>,
  lang: Lang,
): string {
  if (failure.reason === 'limit')
    return failure.limit
      ? reasonLabel(failure.limit, lang)
      : text[lang].failures.invalid
  return text[lang].failures[failure.reason]
}
