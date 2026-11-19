import { createMcpHandler, McpServer } from '@modelcontextprotocol/server'
import { Hono } from 'hono'
import { z } from 'zod'
import { isAuthor, parseAuthors } from '../auth/authors'
import { listOwnDecks } from '../decks/own-decks-store'
import { resolveDeck } from '../decks/store'
import { readSuspension } from '../publication/suspension-store'
import { parseInventoryStructure } from '../uploads/inventory'
import { readHandle } from '../share/store'
import { withinLimit } from '../site/rate-limit'
import { RETRY_AFTER_SECONDS } from '../site/rate-limit-policy'
import { SERVICE_NAME } from '../site/service'
import { bearerOf, challengeOf, isAllowedOrigin } from './access'
import { readGrant, touchGrant } from './access-store'
import { hashToken } from './authorization'
import { prepareTextFiles, type TextFile } from './files'
import { MCP_PATH, MCP_SCOPE } from './oauth-metadata'
import { finalizeUpload, sendAndFinalize, startVersion } from './receive-api'
import { readUploadSlide, readUploadStatus } from './slides-store'
import {
  putView,
  refusalResult,
  SERVER_INSTRUCTIONS,
  slideView,
  statusView,
  TOOL_DESCRIPTIONS,
  toolError,
  toolResult,
  uploadPlan,
  type ToolResult,
} from './tools'

const now = () => Math.floor(Date.now() / 1000)
const NO_STORE = { 'Cache-Control': 'no-store' }
/** More files than any configuration lets one version hold are not read. */
const MAX_LISTED_FILES = 500

/** What a tool needs of the request it serves. */
type Session = Readonly<{ env: Env; ownerUserId: string }>

/**
 * Whether the owner may still act: a registered author who is not
 * suspended. Asked on every tool call, so removing or suspending an author
 * stops the agents they connected before.
 */
async function mayAct({ env, ownerUserId }: Session): Promise<boolean> {
  return (
    isAuthor(parseAuthors(env.AUTHOR_GITHUB_IDS), ownerUserId) &&
    (await readSuspension(env.DB, ownerUserId)) === null
  )
}

/** Runs a tool for an owner who may act; refuses for one who may not. */
const guarded =
  <Args>(session: Session, run: (args: Args) => Promise<ToolResult>) =>
  async (args: Args): Promise<ToolResult> =>
    (await mayAct(session)) ? run(args) : toolError('not_allowed')

async function listSlides({ env, ownerUserId }: Session): Promise<ToolResult> {
  const [handle, decks] = await Promise.all([
    readHandle(env.DB, ownerUserId),
    listOwnDecks(env.DB, ownerUserId),
  ])
  return toolResult({
    slides: decks.map((deck) => slideView(env.PUBLIC_ORIGIN, handle, deck)),
  })
}

async function getStatus(
  { env, ownerUserId }: Session,
  slug: string,
): Promise<ToolResult> {
  // The slug is looked up among the owner's own slides: another author's
  // slide and one that does not exist are the same answer.
  const found = await resolveDeck(env.DB, ownerUserId, slug)
  const [deck] = found
    ? await listOwnDecks(env.DB, ownerUserId, found.slug)
    : []
  if (!found || !deck) return toolError('unknown_slide')
  const [handle, status] = await Promise.all([
    readHandle(env.DB, ownerUserId),
    readUploadStatus(env.DB, found.id),
  ])
  return toolResult(
    statusView(
      env.PUBLIC_ORIGIN,
      handle,
      deck,
      status.newest,
      status.publicUploadId,
    ),
  )
}

/**
 * Puts text files up as a new version of the owner's slide. The public
 * version is untouched: receiving never writes a deck's publication.
 */
async function replaceSlide(
  session: Session,
  slug: string,
  files: readonly TextFile[],
): Promise<ToolResult> {
  const { env, ownerUserId } = session
  const deck = await resolveDeck(env.DB, ownerUserId, slug)
  if (!deck || deck.deleted) return toolError('unknown_slide')
  const prepared = await prepareTextFiles(files)
  if (!prepared.ok) return refusalResult(prepared.error, prepared.message)
  const start = await startVersion(session, deck, prepared.inventory)
  if (!start.ok) return refusalResult(start.refusal.code, start.refusal.message)
  const sent = await sendAndFinalize(env, start.started, prepared.bytes)
  if (!sent.ok) return refusalResult(sent.refusal.code, sent.refusal.message)
  return toolResult(putView(env.PUBLIC_ORIGIN, deck.slug, sent.uploadId))
}

type ListedFile = Readonly<{ path: string; size: number; sha256: string }>

/** The inventory of the files an agent lists, or null when it is not one. */
function inventoryOf(files: readonly ListedFile[]) {
  try {
    return parseInventoryStructure({ entry: 'index.html', files })
  } catch {
    return null
  }
}

/**
 * Starts an upload the agent sends itself, file by file over HTTP, with the
 * upload's own short-lived credential.
 */
async function beginUpload(
  session: Session,
  slug: string,
  files: readonly ListedFile[],
): Promise<ToolResult> {
  const { env, ownerUserId } = session
  const deck = await resolveDeck(env.DB, ownerUserId, slug)
  if (!deck || deck.deleted) return toolError('unknown_slide')
  const inventory = inventoryOf(files)
  if (!inventory)
    return refusalResult(
      'invalid_files',
      'The list is not a set of static files the service takes. List index.html at the top level, plain relative paths without "..", hidden files or repeats, static web file types only, and each file’s size and lowercase hex SHA-256.',
    )
  const start = await startVersion(session, deck, inventory)
  if (!start.ok) return refusalResult(start.refusal.code, start.refusal.message)
  return toolResult(uploadPlan(env.PUBLIC_ORIGIN, start.started))
}

/** Finalizes an upload of the owner's own slide with its credential. */
async function finishUpload(
  { env, ownerUserId }: Session,
  uploadId: string,
  credential: string,
): Promise<ToolResult> {
  const slug = await readUploadSlide(env.DB, ownerUserId, uploadId)
  if (slug === null) return toolError('unknown_upload')
  const done = await finalizeUpload(env, uploadId, credential)
  if (!done.ok) return refusalResult(done.refusal.code, done.refusal.message)
  return toolResult(putView(env.PUBLIC_ORIGIN, slug, uploadId))
}

const READ_ONLY = { readOnlyHint: true, openWorldHint: false }
// Adds a version; never removes or overwrites one, and reaches nothing else.
const ADDITIVE = {
  readOnlyHint: false,
  destructiveHint: false,
  openWorldHint: false,
}
const slideName = z
  .string()
  .max(100)
  .describe('The slide’s URL name, as list_slides returns it in `slide`.')
const textFiles = z
  .array(
    z.object({
      path: z
        .string()
        .describe('Relative path, such as index.html or assets/app.css.'),
      text: z.string().describe('The file’s content, as text.'),
    }),
  )
  .min(1)
  .describe(
    'The built static files as text. Must include index.html at the top level. Not a zip.',
  )
const listedFiles = z
  .array(
    z.object({
      path: z
        .string()
        .describe('Relative path, such as index.html or img/cover.png.'),
      size: z.number().int().nonnegative().describe('Size in bytes.'),
      sha256: z
        .string()
        .describe('SHA-256 of the bytes to be sent, as lowercase hex.'),
    }),
  )
  .min(1)
  .max(MAX_LISTED_FILES)
  .describe(
    'Every file of the version. Must include index.html at the top level.',
  )

/**
 * The MCP server for one request. Its tools act for the owner the access
 * token names and for nobody else; none of them publishes, unpublishes or
 * deletes.
 */
function slideServer(session: Session): McpServer {
  const server = new McpServer(
    { name: SERVICE_NAME.toLowerCase(), version: '1.0.0' },
    { instructions: SERVER_INSTRUCTIONS },
  )
  server.registerTool(
    'list_slides',
    {
      description: TOOL_DESCRIPTIONS.list_slides,
      inputSchema: z.object({}),
      annotations: READ_ONLY,
    },
    guarded(session, () => listSlides(session)),
  )
  server.registerTool(
    'get_status',
    {
      description: TOOL_DESCRIPTIONS.get_status,
      inputSchema: z.object({ slide: slideName }),
      annotations: READ_ONLY,
    },
    guarded(session, ({ slide }: { slide: string }) =>
      getStatus(session, slide),
    ),
  )
  server.registerTool(
    'replace_slide',
    {
      description: TOOL_DESCRIPTIONS.replace_slide,
      inputSchema: z.object({ slide: slideName, files: textFiles }),
      annotations: ADDITIVE,
    },
    guarded(session, (args: { slide: string; files: TextFile[] }) =>
      replaceSlide(session, args.slide, args.files),
    ),
  )
  server.registerTool(
    'begin_upload',
    {
      description: TOOL_DESCRIPTIONS.begin_upload,
      inputSchema: z.object({ slide: slideName, files: listedFiles }),
      annotations: ADDITIVE,
    },
    guarded(session, (args: { slide: string; files: ListedFile[] }) =>
      beginUpload(session, args.slide, args.files),
    ),
  )
  server.registerTool(
    'finish_upload',
    {
      description: TOOL_DESCRIPTIONS.finish_upload,
      inputSchema: z.object({
        uploadId: z.string().max(100).describe('From begin_upload.'),
        credential: z
          .string()
          .regex(/^[A-Za-z0-9._~-]{20,200}$/)
          .describe('From begin_upload.'),
      }),
      annotations: ADDITIVE,
    },
    guarded(session, (args: { uploadId: string; credential: string }) =>
      finishUpload(session, args.uploadId, args.credential),
    ),
  )
  return server
}

/**
 * The MCP endpoint. It acts on a bearer token alone and never reads a
 * cookie: the author's browser session means nothing here.
 */
export const mcpServerRoutes = new Hono<{ Bindings: Env }>()

mcpServerRoutes.all(MCP_PATH, async (c) => {
  const origin = c.env.PUBLIC_ORIGIN
  if (!isAllowedOrigin(c.req.header('origin'), origin))
    return c.json({ error: 'Origin not allowed' }, 403, NO_STORE)
  if (c.req.method !== 'POST')
    return c.json({ error: 'Method not allowed' }, 405, {
      ...NO_STORE,
      Allow: 'POST',
    })
  if (!(await withinLimit(c.env, 'uploads', c.req.raw)))
    return c.json({ error: 'Too many requests; retry later' }, 429, {
      ...NO_STORE,
      'Retry-After': String(RETRY_AFTER_SECONDS),
    })
  const token = bearerOf(c.req.header('authorization'))
  const at = now()
  const grant = token && (await readGrant(c.env.DB, await hashToken(token), at))
  if (!token || !grant)
    return c.json({ error: 'Authorization required' }, 401, {
      ...NO_STORE,
      'WWW-Authenticate': challengeOf(origin, token !== null),
    })
  await touchGrant(c.env.DB, grant.id, at)
  const session = { env: c.env, ownerUserId: grant.ownerUserId }
  const response = await createMcpHandler(() => slideServer(session)).fetch(
    c.req.raw,
    { authInfo: { token, clientId: grant.clientId, scopes: [MCP_SCOPE] } },
  )
  response.headers.set('Cache-Control', 'no-store')
  return response
})
