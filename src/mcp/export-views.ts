// What export_account answers. Pure: the account file in, the answer out.
import type { accountInfo } from '../exports/account-info'

type AccountInfo = ReturnType<typeof accountInfo>

/**
 * The answer: the account file as `account.json` has it, and the slides as a
 * short list to go through one by one. The list is made from the file's own
 * slides, so the two always name the same slides.
 */
export const exportAccountView = (info: AccountInfo) => ({
  account: info,
  slides: info.slides.map((slide) => ({
    slide: slide.urlName,
    title: slide.title,
    state: slide.state,
    hiddenByOperator: slide.hiddenByOperator,
  })),
  next: 'Write `account` to a file as account.json. Then, for each slide in `slides`, read its article with get_article_draft.',
})
