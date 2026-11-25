import type { HandleRefusal } from '../auth/handle-rules'
import { messages, type Lang } from '../site/i18n'

/**
 * Why a handle cannot be chosen: its spelling or a reserved word (see
 * `checkHandle`), someone holding it (a person or a community alike), or
 * the 90 days after it was let go of.
 */
export type HandleProblem = HandleRefusal | 'taken' | 'held'

const text = messages<Readonly<Record<HandleProblem, string>>>({
  ja: {
    empty: 'ハンドルを入力してください。',
    too_long: 'ハンドルは 39 文字までです。',
    invalid_characters: 'ハンドルに使えるのは、英小文字、数字、- だけです。',
    leading_hyphen: 'ハンドルは - で始められません。',
    reserved: 'このハンドルは、サービスが使うため選べません。',
    taken: 'このハンドルは、すでに使われています。',
    held: 'このハンドルは、手放されてから 90 日の間は選べません。',
  },
  en: {
    empty: 'Enter a handle.',
    too_long: 'A handle is 39 characters at most.',
    invalid_characters:
      'A handle can use lowercase letters, digits and - only.',
    leading_hyphen: 'A handle cannot start with -.',
    reserved: 'This handle is reserved for the service.',
    taken: 'Someone already uses this handle.',
    held: 'This handle cannot be chosen for 90 days after it was let go of.',
  },
})

/**
 * The sentence shown under a handle field. People and communities get the
 * same words: the sign-up page and the page that makes a community both
 * show these.
 */
export const handleRefusalText = (lang: Lang, problem: HandleProblem) =>
  text[lang][problem]
