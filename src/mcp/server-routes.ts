import { createMcpHandler, McpServer } from '@modelcontextprotocol/server'
import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { z } from 'zod'
import { MAX_ARTICLE_CHARS } from '../articles/markdown'
import { listOwnDecks } from '../decks/own-decks-store'
import { resolveDeck } from '../decks/store'
import { parseInventoryStructure } from '../uploads/inventory'
import { readHandle } from '../share/store'
import { TITLE_SCAN_BYTES, titleOf } from '../uploads/title'
import { withinLimit } from '../site/rate-limit'
import { RETRY_AFTER_SECONDS } from '../site/rate-limit-policy'
import { SERVICE_NAME } from '../site/service'
import { readBounded, type UploadTarget } from '../uploads/api'
import { bearerOf, challengeOf, isAllowedOrigin } from './access'
import { readGrant, touchGrant } from './access-store'
import { hashToken } from './authorization'
import {
  addRelatedLink,
  getArticleDraft,
  putArticleDraft,
  removeRelatedLink,
} from './article-api'
import { exportAccount } from './export-api'
import { getSlideFiles } from './slide-files-api'
import { MAX_CURSOR_LENGTH } from './files-page'
import { mayAct } from './may-act-store'
import { prepareTextFiles, type TextFile } from './files'
import { LINK_KINDS, MAX_TITLE_LENGTH, MAX_URL_LENGTH } from '../links/link'
import { MCP_PATH } from './oauth-metadata'
import { canExport, type Scope } from './scope'
import { finalizeUpload, sendAndFinalize, startFor } from './receive-api'
import { readNewestUpload, readUploadSlide } from './slides-store'
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
import { outcomeOf, recordToolUse, type ToolName } from './tool-use'
import { withHelpUrl } from './refusal-help'
import { record } from '../metrics/record-routes'

/** The article's limit counts characters; the argument allows for UTF-16. */
const MAX_ARGUMENT_CHARS = MAX_ARTICLE_CHARS * 2 + 1000

const now = () => Math.floor(Date.now() / 1000)
const NO_STORE = { 'Cache-Control': 'no-store' }
/** More files than any configuration lets one version hold are not read. */
const MAX_LISTED_FILES = 500

/** What a tool needs of the request it serves. */
type Session = Readonly<{
  env: Env
  ownerUserId: string
  /** The connection itself: the addresses of files are made for it alone. */
  grantId: string
  /** What the connection was allowed; see scope.ts. */
  scopes: readonly Scope[]
}>

/**
 * Runs a tool for an owner who may act; refuses for one who may not. The
 * call is counted once, by tool and outcome only (D-71): a count that fails
 * is no reason to fail the answer.
 */
const guarded =
  <Args>(
    session: Session,
    tool: ToolName,
    run: (args: Args) => Promise<ToolResult>,
  ) =>
  async (args: Args): Promise<ToolResult> => {
    const result = (await mayAct(session.env.DB, session.ownerUserId))
      ? await run(args)
      : toolError('not_allowed')
    try {
      recordToolUse(session.env, { tool, outcome: outcomeOf(result) })
    } catch {
      // Counting never changes what the agent is told.
    }
    // The write to Analytics Engine is made here, a routes file: `tool-use.ts`
    // is in the pure layer and may not reach the binding (F40-AC9).
    record(session.env, { name: 'mcp_tool_called', tool })
    return withHelpUrl(result, session.env.PUBLIC_ORIGIN)
  }

/**
 * Like `guarded`, for a tool that reads the author's data out: only a
 * connection allowed the export scope may call it. One made before the scope
 * existed is told to connect again (F23-AC47); the suspended are refused
 * first, as for every tool (F23-AC49).
 */
const guardedExport = <Args>(
  session: Session,
  tool: ToolName,
  run: (args: Args) => Promise<ToolResult>,
) =>
  guarded(session, tool, async (args: Args) =>
    canExport(session.scopes) ? run(args) : toolError('reconnect_required'),
  )

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
  const [handle, newest] = await Promise.all([
    readHandle(env.DB, ownerUserId),
    readNewestUpload(env.DB, found.id),
  ])
  return toolResult(statusView(env.PUBLIC_ORIGIN, handle, deck, newest))
}

/**
 * Puts text files up through the same start, per-file send and finalize as
 * any upload. Receiving never writes a deck's publication, so what readers
 * see is untouched: a new slide is private, and a public slide keeps its
 * public version.
 */
async function putFiles(
  session: Session,
  target: (files: PreparedText) => UploadTarget,
  files: readonly TextFile[],
): Promise<ToolResult> {
  const prepared = await prepareTextFiles(files)
  if (!prepared.ok) return refusalResult(prepared.error, prepared.message)
  const start = await startFor(session, target(prepared), prepared.inventory)
  if (!start.ok) return refusalResult(start.refusal.code, start.refusal.message)
  const { started } = start
  const sent = await sendAndFinalize(session.env, started, prepared.bytes)
  if (!sent.ok) return refusalResult(sent.refusal.code, sent.refusal.message)
  return toolResult(
    putView(
      session.env.PUBLIC_ORIGIN,
      started.slug,
      sent.uploadId,
      await readHandle(session.env.DB, session.ownerUserId),
    ),
  )
}
type PreparedText = Extract<
  Awaited<ReturnType<typeof prepareTextFiles>>,
  { ok: true }
>

async function replaceSlide(
  session: Session,
  slug: string,
  files: readonly TextFile[],
): Promise<ToolResult> {
  const deck = await resolveDeck(session.env.DB, session.ownerUserId, slug)
  if (!deck || deck.deleted) return toolError('unknown_slide')
  return putFiles(session, () => ({ kind: 'version', deck }), files)
}

/**
 * The name a new slide's URL is made from: the title the agent gives, or
 * else the `<title>` of its index.html, as a dropped file's is read.
 */
function nameOf(title: string | undefined, prepared: PreparedText) {
  const head = new TextDecoder().decode(
    prepared.bytes.get('index.html')?.subarray(0, TITLE_SCAN_BYTES),
  )
  return { title: title ?? titleOf(head) }
}

/** Makes a new slide of the owner's from text files. */
const putSlide = (
  session: Session,
  title: string | undefined,
  files: readonly TextFile[],
) =>
  putFiles(
    session,
    (prepared) => ({ kind: 'new', name: nameOf(title, prepared) }),
    files,
  )

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
  args: BeginArguments,
): Promise<ToolResult> {
  const { env, ownerUserId } = session
  const inventory = inventoryOf(args.files)
  if (!inventory)
    return refusalResult(
      'invalid_files',
      'The list is not a set of static files the service takes. List index.html at the top level, plain relative paths without "..", hidden files or repeats, static web file types only, and each file’s size and lowercase hex SHA-256.',
    )
  const target = await targetOf(env, ownerUserId, args)
  if (!target) return toolError('unknown_slide')
  const start = await startFor(session, target, inventory)
  if (!start.ok) return refusalResult(start.refusal.code, start.refusal.message)
  return toolResult(uploadPlan(env.PUBLIC_ORIGIN, start.started))
}
type BeginArguments = Readonly<{
  slide?: string
  title?: string
  files: readonly ListedFile[]
}>

/**
 * What an upload is begun for: the owner's own slide the agent names, or,
 * when it names none, a new slide. Null when the slide named is not theirs.
 */
async function targetOf(
  env: Env,
  ownerUserId: string,
  { slide, title }: BeginArguments,
): Promise<UploadTarget | null> {
  if (slide === undefined) return { kind: 'new', name: { title } }
  const deck = await resolveDeck(env.DB, ownerUserId, slide)
  return deck && !deck.deleted ? { kind: 'version', deck } : null
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
  return toolResult(
    putView(
      env.PUBLIC_ORIGIN,
      slug,
      uploadId,
      await readHandle(env.DB, ownerUserId),
    ),
  )
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
    { name: SERVICE_NAME, version: '1.0.0' },
    { instructions: SERVER_INSTRUCTIONS },
  )
  server.registerTool(
    'list_slides',
    {
      description: TOOL_DESCRIPTIONS.list_slides,
      inputSchema: z.object({}),
      annotations: READ_ONLY,
    },
    guarded(session, 'list_slides', () => listSlides(session)),
  )
  server.registerTool(
    'get_status',
    {
      description: TOOL_DESCRIPTIONS.get_status,
      inputSchema: z.object({ slide: slideName }),
      annotations: READ_ONLY,
    },
    guarded(session, 'get_status', ({ slide }: { slide: string }) =>
      getStatus(session, slide),
    ),
  )
  server.registerTool(
    'put_slide',
    {
      description: TOOL_DESCRIPTIONS.put_slide,
      inputSchema: z.object({
        files: textFiles,
        title: z
          .string()
          .max(200)
          .optional()
          .describe(
            'The slides’ title, which names their URL. Left out, the <title> of index.html is used.',
          ),
      }),
      annotations: ADDITIVE,
    },
    guarded(
      session,
      'put_slide',
      (args: { files: TextFile[]; title?: string }) =>
        putSlide(session, args.title, args.files),
    ),
  )
  server.registerTool(
    'replace_slide',
    {
      description: TOOL_DESCRIPTIONS.replace_slide,
      inputSchema: z.object({ slide: slideName, files: textFiles }),
      annotations: ADDITIVE,
    },
    guarded(
      session,
      'replace_slide',
      (args: { slide: string; files: TextFile[] }) =>
        replaceSlide(session, args.slide, args.files),
    ),
  )
  server.registerTool(
    'begin_upload',
    {
      description: TOOL_DESCRIPTIONS.begin_upload,
      inputSchema: z.object({
        slide: slideName
          .optional()
          .describe(
            'The URL name of the slides to put a new version of. Left out, new slides are made.',
          ),
        title: z
          .string()
          .max(200)
          .optional()
          .describe('For new slides: their title, which names their URL.'),
        files: listedFiles,
      }),
      annotations: ADDITIVE,
    },
    guarded(session, 'begin_upload', (args: BeginArguments) =>
      beginUpload(session, args),
    ),
  )
  server.registerTool(
    'get_article_draft',
    {
      description: TOOL_DESCRIPTIONS.get_article_draft,
      inputSchema: z.object({ slide: slideName }),
      annotations: READ_ONLY,
    },
    guarded(session, 'get_article_draft', ({ slide }: { slide: string }) =>
      getArticleDraft(session, slide),
    ),
  )
  server.registerTool(
    'put_article_draft',
    {
      description: TOOL_DESCRIPTIONS.put_article_draft,
      inputSchema: z.object({
        slide: slideName,
        body: z
          .string()
          .max(MAX_ARGUMENT_CHARS)
          .describe(
            'The whole article as Markdown. A page of slides is a share URL with its page number, alone on a line.',
          ),
        revision: z
          .number()
          .int()
          .nonnegative()
          .optional()
          .describe(
            'The revision get_article_draft returned. Required when the slide has an article; left out only to make a new one.',
          ),
      }),
      // Replaces a draft or the author's working draft; never what readers see.
      annotations: { ...ADDITIVE, destructiveHint: true },
    },
    guarded(
      session,
      'put_article_draft',
      (args: { slide: string; body: string; revision?: number }) =>
        putArticleDraft(session, args.slide, args.body, args.revision),
    ),
  )
  server.registerTool(
    'add_related_link',
    {
      description: TOOL_DESCRIPTIONS.add_related_link,
      inputSchema: z.object({
        slide: slideName,
        kind: z.enum(LINK_KINDS).optional(),
        url: z.string().max(MAX_URL_LENGTH + 100),
        title: z
          .string()
          .max(MAX_TITLE_LENGTH * 4)
          .optional(),
      }),
      annotations: ADDITIVE,
    },
    guarded(
      session,
      'add_related_link',
      (args: { slide: string; kind?: string; url: string; title?: string }) =>
        addRelatedLink(session, args.slide, args),
    ),
  )
  server.registerTool(
    'remove_related_link',
    {
      description: TOOL_DESCRIPTIONS.remove_related_link,
      inputSchema: z.object({
        slide: slideName,
        linkId: z.string().max(100),
      }),
      annotations: { ...ADDITIVE, destructiveHint: true },
    },
    guarded(
      session,
      'remove_related_link',
      (args: { slide: string; linkId: string }) =>
        removeRelatedLink(session, args.slide, args.linkId),
    ),
  )
  server.registerTool(
    'export_account',
    {
      description: TOOL_DESCRIPTIONS.export_account,
      inputSchema: z.object({}),
      annotations: READ_ONLY,
    },
    guardedExport(session, 'export_account', () => exportAccount(session)),
  )
  server.registerTool(
    'get_slide_files',
    {
      description: TOOL_DESCRIPTIONS.get_slide_files,
      inputSchema: z.object({
        slide: slideName,
        cursor: z
          .string()
          .max(MAX_CURSOR_LENGTH)
          .optional()
          .describe(
            'The nextCursor of the previous answer, to get the files after it. Left out, the list starts at the first file.',
          ),
      }),
      annotations: READ_ONLY,
    },
    guardedExport(
      session,
      'get_slide_files',
      (args: { slide: string; cursor?: string }) =>
        getSlideFiles(session, args.slide, args.cursor),
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
    guarded(
      session,
      'finish_upload',
      (args: { uploadId: string; credential: string }) =>
        finishUpload(session, args.uploadId, args.credential),
    ),
  )
  return server
}

/**
 * The largest request read: a megabyte of text in a tool's arguments, with
 * room for what JSON adds when it escapes it.
 */
export const MAX_MESSAGE_BYTES = 3 * 1024 * 1024

type Message =
  | Readonly<{ ok: true; message: unknown }>
  | Readonly<{ ok: false; status: 400 | 413; code: number; message: string }>

/**
 * The one JSON-RPC message of a request. An array of messages is refused:
 * the per-IP budget counts requests, and a batch would run a hundred tool
 * calls for one of them. Clients have had no batches since the 2025-06-18
 * revision.
 */
async function readMessage(request: Request): Promise<Message> {
  let text: string
  try {
    text = new TextDecoder().decode(
      await readBounded(request, MAX_MESSAGE_BYTES),
    )
  } catch (error) {
    if (!(error instanceof HTTPException)) throw error
    return {
      ok: false,
      status: 413,
      code: -32600,
      message: 'Request too large',
    }
  }
  let message: unknown
  try {
    message = JSON.parse(text)
  } catch {
    return { ok: false, status: 400, code: -32700, message: 'Parse error' }
  }
  return Array.isArray(message)
    ? {
        ok: false,
        status: 400,
        code: -32600,
        message: 'Batches are not accepted; send one message per request',
      }
    : { ok: true, message }
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
  const body = await readMessage(c.req.raw)
  if (!body.ok)
    return c.json(
      {
        jsonrpc: '2.0',
        error: { code: body.code, message: body.message },
        id: null,
      },
      body.status,
      NO_STORE,
    )
  await touchGrant(c.env.DB, grant.id, at)
  const session = {
    env: c.env,
    ownerUserId: grant.ownerUserId,
    grantId: grant.id,
    scopes: grant.scopes,
  }
  const response = await createMcpHandler(() => slideServer(session)).fetch(
    c.req.raw,
    {
      authInfo: { token, clientId: grant.clientId, scopes: [...grant.scopes] },
      parsedBody: body.message,
    },
  )
  response.headers.set('Cache-Control', 'no-store')
  return response
})
