import { ownDeckName, type OwnDeck } from '../decks/own-decks'
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
  'After putting slides up, give the author the manage URL and tell them to check the slides there and press Publish.',
].join(' ')

export const TOOL_DESCRIPTIONS = {
  list_slides:
    'Lists the author’s own slides: each one’s URL name, title, whether readers can see it, its manage page, and its share URL when public.',
  get_status:
    'Tells whether one of the author’s slides is public, and how its newest upload stands: still receiving files, ready, failed or expired. `slide` is the URL name from list_slides.',
} as const

export type ToolName = keyof typeof TOOL_DESCRIPTIONS

/** Why a tool refuses; the agent passes the reason on to the author. */
export type ToolErrorCode = 'not_allowed' | 'unknown_slide'

const ERROR_MESSAGES: Readonly<Record<ToolErrorCode, string>> = {
  not_allowed:
    'This account cannot put slides up: it is not registered as an author of this service, or it is suspended. Nothing was changed.',
  unknown_slide:
    'The author has no slide with that URL name. Call list_slides to see the names.',
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
  details: Structured = {},
): ToolResult => ({
  ...toolResult({ ...details, error: code, message }),
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
 * upload that is not the public version waits for the author: uploads never
 * change what readers see.
 */
export function statusView(
  origin: string,
  handle: string | null,
  deck: OwnDeck,
  newest: NewestUpload | null,
  publicUploadId: string | null,
) {
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
