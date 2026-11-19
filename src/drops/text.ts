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
    receiving: '受け取っています',
    receivingNote: '終わると、このスライドの管理ページが開きます。',
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
      no_index:
        'zip の直下か、zip の中のただ 1 つのフォルダの直下に、index.html が見つかりません。',
      invalid_zip:
        'zip を読めませんでした。作り直してから、もう一度ドロップしてください。',
      unsupported_zip: {
        encrypted: 'パスワード付きの zip は受け取れません。',
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
    receiving: 'Receiving',
    receivingNote: 'When it is done, the page to manage these slides opens.',
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
      no_index:
        'No index.html was found at the top of the zip, or at the top of the one folder in it.',
      invalid_zip:
        'The zip could not be read. Make it again, then drop it once more.',
      unsupported_zip: {
        encrypted: 'A zip with a password cannot be received.',
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
  failure: Readonly<{ reason: SendFailure; limit?: string }>,
  lang: Lang,
): string {
  if (failure.reason === 'limit')
    return failure.limit
      ? reasonLabel(failure.limit, lang)
      : text[lang].failures.invalid
  return text[lang].failures[failure.reason]
}
