import { SERVICE_NAME } from '../site/service'
import { MAX_ARTICLE_CHARS } from '../articles/markdown'
import { deckSlugSchema } from '../decks/deck-id'
import { ownDeckName, type OwnDeck } from '../decks/own-decks'
import { MAX_LINKS, MAX_TITLE_LENGTH } from '../links/link'
import type { Handle } from '../share/handle'
import { ownerViewerPath } from '../share/path'
import { DEFAULT_UPLOAD_LIMITS } from '../uploads/limits'

const megabytes = (bytes: number) => Math.round(bytes / (1024 * 1024))

/**
 * What the server tells an agent about itself before any tool is called:
 * what it can do, what it cannot, and the limits.
 */
export const SERVER_INSTRUCTIONS = [
  `${SERVICE_NAME} hosts HTML slides. These tools put built static files up for the signed-in author and replace them with new versions.`,
  'They cannot publish, unpublish or delete slides, rename a slide URL, or change settings: the author does those in the browser. Everything put up here stays private to the author until they press Publish on the manage page.',
  'Send the built files as a list of paths and contents, not as a zip. The entry file must be index.html at the top level.',
  `Limits: ${megabytes(DEFAULT_UPLOAD_LIMITS.deploymentBytes)} MB per version, ${megabytes(DEFAULT_UPLOAD_LIMITS.fileBytes)} MB per file, ${DEFAULT_UPLOAD_LIMITS.files} files per version, ${DEFAULT_UPLOAD_LIMITS.decks} slides per author.`,
  'They can also read and write the article of a slide and add or remove its related links. Read the article with get_article_draft before writing it, and pass the revision read. A change to a published article goes into the author’s working draft, which readers do not see; the author publishes the article, and updates a published one, in the browser.',
  'After putting slides up, give the author the manage URL and tell them to check the slides there and press Publish.',
  'They can also read the author’s data out, so the author can keep a copy. To write out everything, in this order: call export_account and save its `account` as account.json; call list_slides; then for each slide call get_slide_files (again with `nextCursor` until it is null) and download every file from its `url`, saving it under the slide’s name, the version (`published` or `prepared`) and the file’s `path`, checking the bytes against `sha256`; then call get_article_draft and save its `body` (and `publishedBody` when it is not null) as the article, with `relatedLinks`. A file’s `url` stops working after an hour: call get_slide_files again for new ones. A connection made before this was added is refused, with a reason that tells the author to connect the agent again.',
].join(' ')

export const TOOL_DESCRIPTIONS = {
  list_slides:
    'Lists the author’s own slides: each one’s URL name, title, whether readers can see it, its manage page, and its share URL when public.',
  get_status:
    'Tells whether one of the author’s slides is public, and how its newest upload stands: still receiving files, ready, failed or expired. `slide` is the URL name from list_slides.',
  put_slide:
    'Puts new slides up for the author, from text files passed here: index.html and any css, js, svg or json beside it, up to 1 MB of text in total. For anything larger, or with images or other binary files, use begin_upload. The slides get a URL name made from their title and are private to the author: nobody else can open them until the author presses Publish on the manage page. Returns the manage page and an author-only preview to hand to the author. To put a new version of slides that already exist, use replace_slide instead. This tool cannot publish.',
  replace_slide:
    'Puts a new version of one of the author’s own slides up, from text files passed here: index.html and any css, js, svg or json beside it, up to 1 MB of text in total. For anything larger, or with images or other binary files, use begin_upload. The slide’s share URL stays the same. The new version is private to the author: readers keep seeing the version that was public before until the author switches it on the manage page. An author has one upload open at a time: starting one here gives up another upload of theirs that is waiting between files (from a browser or another agent), and is refused as upload_busy while that one is receiving a file. This tool cannot publish.',
  begin_upload: `Starts putting slides up when the files do not fit in a call: new slides when \`slide\` is left out, or a new version of the author’s own slides it names. Use it for more than 1 MB of text, or images, fonts or other binary files. Pass every file’s path, size in bytes and SHA-256 (lowercase hex) of exactly the bytes you will send. The answer gives a URL per file and a credential good for one hour and for this upload only: PUT each file’s bytes to its URL with the Authorization header given, then call finish_upload. An author has one upload open at a time: beginning one gives up another upload of theirs that is waiting between files, and is refused as upload_busy while that one is receiving a file. Disconnecting the agent in the settings ends its unfinished uploads. This tool cannot publish.`,
  get_article_draft:
    'Reads the article of one of the author’s own slides as it is being edited (`slide` is the URL name from list_slides). Returns `body` (Markdown): a draft’s text, or for a published article the author’s working draft when there is one (changes readers do not see yet), else the published text. Also returns `state` (none, draft, published or published_with_changes), the `revision` to pass to put_article_draft, `publishedBody` (the text readers see now, or null for a draft or no article), the slide’s `relatedLinks`, and the article page (editUrl). Call it before put_article_draft and build on the text it returns. With state none the slide has no article yet, and put_article_draft without revision makes one as a draft.',
  put_article_draft: `Writes the article of one of the author’s own slides (\`slide\` is the URL name from list_slides; \`body\` is the whole text as Markdown, at most ${MAX_ARTICLE_CHARS.toLocaleString('en-US')} characters). Read it with get_article_draft first and pass the \`revision\` it returned; leave revision out only when the slide has no article, and a draft is made. A draft’s text is replaced. For a published article the text goes into the author’s working draft: readers keep seeing the published text until the author presses Update published article on the article page. A revision that is not the article’s current one is refused as revision_mismatch (the author or another agent saved since you read): read again and build on the new text. To show a page of slides in the article, write its share URL with the page number (https://…/@handle/slide/3) alone on a line. Only the author sees what this tool writes; this tool cannot publish. Returns the new revision, the state, the article page (editUrl) to hand to the author, and what the author does next.`,
  add_related_link: `Adds a related link (a video, an article, an event or another page) to one of the author’s own slides, shown under its title in the viewer. \`kind\` (video, article, event or other) is optional: leave it out and the service reads it from the address (event pages on connpass, Doorkeeper and Luma are events; YouTube, Vimeo and similar sites are videos; Zenn, Qiita, note, Hatena Blog and similar are articles; the rest are other). Give the page of the event the slides were presented at as an event: once the slide is public, it is listed on the page of links of that event (/link/ followed by the event’s address without https://) on ${SERVICE_NAME}, with the other public slides that link to the same event. \`url\` must be https:; \`title\` is optional, at most ${MAX_TITLE_LENGTH} characters: leave it out and the link shows its site name (the service never reads the linked page). The answer’s \`titleSource\` says which (given or none). A slide holds at most ${MAX_LINKS} links. Returns the slide’s links, with the id each is removed by, and the manage page (editUrl).`,
  remove_related_link:
    'Removes one related link from one of the author’s own slides. `linkId` is the id add_related_link returns for it. Returns the remaining links and the manage page (editUrl).',
  get_slide_files:
    'Lists the files of one of the author’s own slides so they can be saved: for the version readers see (`published`) and for a newer version the author has not switched on yet (`prepared`), each file’s `path`, `size`, `sha256` (lowercase hex) and a `url` that returns exactly the bytes that were put up. Private and unlisted slides are included. `slide` is the URL name from list_slides. At most 100 files come back at once: while `nextCursor` is not null, call again with it as `cursor`. GET each `url` as it is, without an Authorization header. Each is good for one hour and for that one file (call this tool again for new ones when they have run out), and each is a secret: do not show it to the author or write it to a log. Write each file under its `path` inside a folder of your own, never outside it (never a path with “..” in it or one that starts with “/”), and check the saved bytes against `sha256`. A version that cannot be saved faithfully comes back with status unavailable, a reason and a message instead of files: tell the author. File contents never come back in this answer. It reads only. Full order of writing everything out: export_account, list_slides, then get_slide_files and get_article_draft for each slide.',
  export_account:
    'Reads out the author’s account so they can keep a copy: `account` holds the information the settings export as account.json (profile, email address, who they follow, mutes and blocks, communities they run, connected agents, and their slides), and `slides` is the short list of every slide of theirs, private and unlisted ones included: its URL name (`slide`), `title`, and `state` (draft, public or paused). Write `account` to a file as account.json. Contains the author’s own email address: keep it out of logs and shared places. It reads only; it changes nothing. First step of writing everything out: then list_slides (or the `slides` here), and get_slide_files and get_article_draft for each slide.',
  finish_upload:
    'Completes an upload begun with begin_upload, once every file was sent. Pass the uploadId and credential begin_upload returned. The version is then ready and private to the author; readers keep seeing the earlier public version until the author switches it. If files are missing, the answer names them.',
} as const

/** Why a tool refuses; the agent passes the reason on to the author. */
export type ToolErrorCode =
  | 'not_allowed'
  | 'unknown_slide'
  | 'unknown_upload'
  | 'unknown_account'
  | 'reconnect_required'
  | 'unavailable'
  | 'invalid_cursor'
  | 'stale_cursor'

const ERROR_MESSAGES: Readonly<Record<ToolErrorCode, string>> = {
  not_allowed:
    'This account cannot put slides up: it is not registered as an author of this service, or it is suspended. Nothing was changed.',
  unknown_slide:
    'The author has no slide with that URL name. Call list_slides to see the names.',
  unknown_upload:
    'The author has no upload with that ID. Call begin_upload to start one.',
  unknown_account:
    'The author has no account on this service yet (they have not chosen a handle). Nothing was read.',
  unavailable:
    'The service cannot make addresses to fetch files from at the moment (it is not set up for it). Nothing was listed. Tell the author, and ask them to let the service’s operator know.',
  invalid_cursor:
    'The cursor is not one this tool returned. Call get_slide_files again without a cursor to start from the first file.',
  stale_cursor:
    'The slide changed since that cursor was made (a new version was put up, or the version it listed is no longer exported). Call get_slide_files again without a cursor to start from the first file.',
  // Said to the author as it is, by the agent, so it names what to do on
  // which screen (F23-AC47).
  reconnect_required:
    'This connection was made before slide.community could export data, so it is not allowed to read your slides out. Nothing was read. Ask the author to disconnect this agent under “Put slides up from an AI agent” in the slide.community settings and connect it again, allowing the new permission on the screen that appears; then call this tool again.',
}

type Structured = Readonly<Record<string, unknown>>
/** The result of a tool: text for the model and the same as data. */
export type ToolResult = {
  content: { type: 'text'; text: string }[]
  structuredContent: Record<string, unknown>
  isError?: true
}

/** A tool's answer, as JSON text and as the same structured value. */
export const toolResult = (value: Structured): ToolResult => ({
  content: [{ type: 'text', text: JSON.stringify(value, null, 2) }],
  structuredContent: { ...value },
})

/**
 * A refusal, returned as the tool's result rather than as a protocol
 * error, so the agent reads the reason and can tell the author.
 */
export const toolError = (
  code: ToolErrorCode,
  message: string = ERROR_MESSAGES[code],
): ToolResult => refusalResult(code, message)

/** A refusal with a code of its own, such as a limit an upload met. */
export const refusalResult = (code: string, message: string): ToolResult => ({
  ...toolResult({ error: code, message }),
  isError: true,
})

/** Where one slide's pages are, as absolute URLs. */
export type SlideLinks = Readonly<{
  manageUrl: string
  shareUrl: string | null
}>

/**
 * The links of the author's slide. A share URL exists only while readers
 * can open the slide and the author has a handle.
 */
export function slideLinks(
  origin: string,
  handle: string | null,
  deck: Pick<OwnDeck, 'slug' | 'isPublic'>,
): SlideLinks {
  return {
    manageUrl: new URL(`/my/slides/${deck.slug}`, origin).href,
    shareUrl:
      deck.isPublic && handle !== null
        ? new URL(`/@${handle}/${deck.slug}`, origin).href
        : null,
  }
}

const isoOf = (seconds: number) => new Date(seconds * 1000).toISOString()

/** One slide as the tools describe it. */
export const slideView = (
  origin: string,
  handle: string | null,
  deck: OwnDeck,
) => ({
  slide: deck.slug,
  title: ownDeckName(deck),
  visibility: deck.isPublic ? ('public' as const) : ('private' as const),
  ...slideLinks(origin, handle, deck),
  updatedAt: isoOf(deck.updatedAt),
})

/** The newest upload of a slide, whatever became of it. */
export type NewestUpload = Readonly<{
  id: string
  state: 'uploading' | 'ready' | 'failed' | 'expired'
  createdAt: number
  readyAt: number | null
}>

/**
 * A slide's status: whether it is public, and its newest upload. A ready
 * upload that is not the version readers see waits for the author: uploads
 * never change what readers see.
 */
export function statusView(
  origin: string,
  handle: string | null,
  deck: OwnDeck,
  newest: NewestUpload | null,
) {
  // While a slide is public, the version its lists show is the public one.
  const publicUploadId = deck.isPublic
    ? (deck.shown?.deploymentId ?? null)
    : null
  return {
    ...slideView(origin, handle, deck),
    newestUpload: newest && {
      uploadId: newest.id,
      state: newest.state,
      startedAt: isoOf(newest.createdAt),
      readyAt: newest.readyAt === null ? null : isoOf(newest.readyAt),
      isPublicVersion: newest.id === publicUploadId,
    },
  }
}

/**
 * What a tool returns once a version is ready (D-63): the manage page, the
 * author-only preview, and what a person does next. The sentence is for the
 * agent to pass on in the author's language.
 */
export const putView = (
  origin: string,
  slug: string,
  uploadId: string,
  /** The author's handle: with it, the preview is the author's viewer. */
  handle: Handle | null,
) => ({
  slide: slug,
  uploadId,
  visibility: 'private' as const,
  manageUrl: new URL(`/my/slides/${slug}`, origin).href,
  // The author's viewer of this version; an author without a handle has
  // none, and is sent to the manage page.
  previewUrl: new URL(
    handle === null
      ? `/my/slides/${slug}`
      : ownerViewerPath(handle, deckSlugSchema.parse(slug), uploadId),
    origin,
  ).href,
  nextStep:
    'The files are up and visible to the author only. Ask the author to open manageUrl in a browser, check the slides (previewUrl opens this version in the viewer, where only the author sees it), and press Publish there. Nothing is public until they do; a slide that was already public keeps showing its earlier version until they switch it.',
})

/** One file of a started upload, as the upload routes list it. */
type StartedFile = Readonly<{ id: string; path: string; received: boolean }>

/**
 * What begin_upload returns: where to send each file that has not arrived,
 * and the credential to send it with. The credential is the upload's own:
 * it opens nothing but this upload, and stops after an hour.
 */
export const uploadPlan = (
  origin: string,
  started: Readonly<{
    deploymentId: string
    credential: string
    credentialExpiresAt: number
    files: readonly StartedFile[]
  }>,
) => ({
  uploadId: started.deploymentId,
  credential: started.credential,
  credentialExpiresAt: isoOf(started.credentialExpiresAt),
  files: started.files
    .filter((file) => !file.received)
    .map((file) => ({
      path: file.path,
      method: 'PUT' as const,
      url: new URL(
        `/api/uploads/${started.deploymentId}/files/${file.id}`,
        origin,
      ).href,
    })),
  headers: { Authorization: `Bearer ${started.credential}` },
  next: 'PUT the exact bytes of each file to its url with the Authorization header above (one request per file, one at a time). Then call finish_upload with this uploadId and credential.',
})
