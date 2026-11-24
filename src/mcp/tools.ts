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
  'Slide hosts HTML slides. These tools put built static files up for the signed-in author and replace them with new versions.',
  'They cannot publish, unpublish or delete slides, rename a slide URL, or change settings: the author does those in the browser. Everything put up here stays private to the author until they press Publish on the manage page.',
  'Send the built files as a list of paths and contents, not as a zip. The entry file must be index.html at the top level.',
  `Limits: ${megabytes(DEFAULT_UPLOAD_LIMITS.deploymentBytes)} MB per version, ${megabytes(DEFAULT_UPLOAD_LIMITS.fileBytes)} MB per file, ${DEFAULT_UPLOAD_LIMITS.files} files per version, ${DEFAULT_UPLOAD_LIMITS.decks} slides per author.`,
  'They can also save an article draft for a slide and add or remove its related links; the author publishes the article in the browser.',
  'After putting slides up, give the author the manage URL and tell them to check the slides there and press Publish.',
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
  put_article_draft: `Saves text as the article draft of one of the author’s own slides (\`slide\` is the URL name from list_slides; \`body\` is Markdown, at most ${MAX_ARTICLE_CHARS.toLocaleString('en-US')} characters). A draft the slide already has is replaced. A slide whose article is published is refused: the author edits that on the article page. To show a page of slides in the article, write its share URL with the page number (https://…/@handle/slide/3) alone on a line. The draft is visible to the author only; this tool cannot publish. Returns the article page (editUrl) to hand to the author, who reads it and presses Publish there.`,
  add_related_link: `Adds a related link (a video, an article or another page) to one of the author’s own slides, shown under its title in the viewer. \`kind\` (video, article or other) is optional: leave it out and the service reads it from the address (YouTube, Vimeo and similar sites are videos; Zenn, Qiita, note, Hatena Blog and similar are articles; the rest are other). \`url\` must be https:; \`title\` is optional, at most ${MAX_TITLE_LENGTH} characters: leave it out and the link shows its site name (the service never reads the linked page). The answer’s \`titleSource\` says which (given or none). A slide holds at most ${MAX_LINKS} links. Returns the slide’s links, with the id each is removed by, and the manage page (editUrl).`,
  remove_related_link:
    'Removes one related link from one of the author’s own slides. `linkId` is the id add_related_link returns for it. Returns the remaining links and the manage page (editUrl).',
  finish_upload:
    'Completes an upload begun with begin_upload, once every file was sent. Pass the uploadId and credential begin_upload returned. The version is then ready and private to the author; readers keep seeing the earlier public version until the author switches it. If files are missing, the answer names them.',
} as const

/** Why a tool refuses; the agent passes the reason on to the author. */
export type ToolErrorCode = 'not_allowed' | 'unknown_slide' | 'unknown_upload'

const ERROR_MESSAGES: Readonly<Record<ToolErrorCode, string>> = {
  not_allowed:
    'This account cannot put slides up: it is not registered as an author of this service, or it is suspended. Nothing was changed.',
  unknown_slide:
    'The author has no slide with that URL name. Call list_slides to see the names.',
  unknown_upload:
    'The author has no upload with that ID. Call begin_upload to start one.',
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
    manageUrl: new URL(`/slides/${deck.slug}`, origin).href,
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
  manageUrl: new URL(`/slides/${slug}`, origin).href,
  // The author's viewer of this version; an author without a handle has
  // none, and is sent to the manage page.
  previewUrl: new URL(
    handle === null
      ? `/slides/${slug}`
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
