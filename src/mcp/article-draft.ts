import {
  editingBody,
  isStale,
  keptStateOf,
  nextFields,
  type ArticleFields,
  type KeptState,
} from '../articles/article'

/** An article as the tools read it: what it holds, at which revision. */
export type RevisedArticle = ArticleFields & Readonly<{ revision: number }>

/**
 * How the tools name an article's state to an agent: a draft, published,
 * or published with changes in the author's working draft that readers do
 * not see yet.
 */
export type AgentState = 'draft' | 'published' | 'published_with_changes'

const AGENT_STATES: Readonly<Record<KeptState, AgentState>> = {
  draft: 'draft',
  published: 'published',
  pending: 'published_with_changes',
}

/** A related link as the tools list it; the id removes it. */
export type LinkView = Readonly<{
  id: string
  kind: string
  url: string
  title: string | null
}>

/** The pages the answers point the author to. */
export type ArticleUrls = Readonly<{ editUrl: string; manageUrl: string }>

/** Why a write is refused before anything is written. */
export type RevisionRefusal = 'revision_required' | 'revision_mismatch'

/**
 * What a write goes ahead on: the revision the agent read (null: it read
 * no article), or why it does not. A slide with an article takes a write
 * only with the revision it is at; a write without one would replace what
 * the agent never read. The store holds the write to that revision too, so
 * a save that lands in between is not overwritten either.
 */
export function writeBasis(
  stored: number | null,
  sent: number | undefined,
):
  | Readonly<{ ok: true; known: number | null }>
  | Readonly<{ ok: false; reason: RevisionRefusal }> {
  if (sent === undefined)
    return stored === null
      ? { ok: true, known: null }
      : { ok: false, reason: 'revision_required' }
  return isStale(sent, stored)
    ? { ok: false, reason: 'revision_mismatch' }
    : { ok: true, known: sent }
}

export const REVISION_MESSAGES: Readonly<Record<RevisionRefusal, string>> = {
  revision_required:
    'The slide already has an article, so nothing was written. Call get_article_draft to read its text and revision, make your change to that text, and call put_article_draft again with that revision.',
  revision_mismatch:
    'The article changed after you read it (the author or another agent saved it), so nothing was written. Call get_article_draft to read the current text and revision, make your change to that text, and call put_article_draft again with the new revision.',
}

const READ_STEPS: Readonly<Record<AgentState, string>> = {
  draft:
    'body is the draft, which only the author sees. To change it, pass the whole new text and this revision to put_article_draft.',
  published:
    'body is the published text readers see. To change it, pass the whole new text and this revision to put_article_draft: it goes into the author’s working draft, which readers do not see until the author presses “Update published article” on editUrl.',
  published_with_changes:
    'body is the author’s working draft of the published article: changes readers do not see yet. Build on it rather than on the published text. To change it, pass the whole new text and this revision to put_article_draft; readers see it only once the author presses “Update published article” on editUrl.',
}

const WRITTEN_STEPS: Readonly<Record<AgentState, string>> = {
  draft:
    'Saved as a draft that only the author sees. Ask the author to open editUrl to read and preview it, then press “Publish the article” in the Article area of the slide’s manage page (manageUrl). Nothing is public until they do.',
  published:
    'The text is the same as the published one, so no change waits: readers see the published article as before, and the author has nothing to update.',
  published_with_changes:
    'Saved in the author’s working draft of the published article. Readers still see the published text. Ask the author to open editUrl, check the change, and press “Update published article” there to show it to readers.',
}

/**
 * What get_article_draft answers for a slide and its article, if any. It
 * holds all of an article an export needs: the text being edited (`body`),
 * the text readers see when the article is published (`publishedBody`), and
 * the slide's related links, which belong to the slide, not to the article.
 */
export function draftView(
  slide: string,
  urls: ArticleUrls,
  article: RevisedArticle | null,
  relatedLinks: readonly LinkView[],
) {
  if (article === null)
    return {
      slide,
      state: 'none' as const,
      revision: null,
      body: null,
      publishedBody: null,
      relatedLinks,
      ...urls,
      nextStep:
        'The slide has no article yet. Call put_article_draft without revision to make one: it becomes a draft that only the author sees.',
    }
  const state = AGENT_STATES[keptStateOf(article)]
  return {
    slide,
    state,
    revision: article.revision,
    body: editingBody(article),
    // A draft has no text readers see.
    publishedBody: article.status === 'published' ? article.body : null,
    relatedLinks,
    ...urls,
    nextStep: READ_STEPS[state],
  }
}

/**
 * What put_article_draft answers once the text is written over `current`:
 * the state by the rule of the editing page's autosave (`nextFields`).
 */
export function writtenView(
  slide: string,
  urls: ArticleUrls,
  current: ArticleFields | null,
  body: string,
  revision: number,
) {
  const state = AGENT_STATES[keptStateOf(nextFields(current, 'autosave', body))]
  return { slide, state, revision, ...urls, nextStep: WRITTEN_STEPS[state] }
}
