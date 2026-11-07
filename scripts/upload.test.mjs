import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
    mkdir,
    mkdtemp,
    readFile,
    readdir,
    rm,
    stat,
    writeFile,
} from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, expect, test } from 'vitest'

const run = promisify(execFile)
const canary = 'private-upload-token-canary'
const unexpected = 'unexpected-private-server-field'
const html = '<h1>Upload boundary test</h1>'
const temporaryDirectories = []
const servers = []
afterEach(async () => {
    await Promise.all(
        servers
            .splice(0)
            .map((server) => new Promise((resolve) => server.close(resolve))),
    )
    await Promise.all(
        temporaryDirectories
            .splice(0)
            .map((path) => rm(path, { recursive: true, force: true })),
    )
})

/**
 * Starts a fake service. `scripted` maps "METHOD path" to responses that are
 * returned, in order, before the default behavior.
 */
async function fixture(scripted = {}) {
    const directory = await mkdtemp(join(tmpdir(), 'slide-upload-test-'))
    temporaryDirectories.push(directory)
    const source = join(directory, 'source')
    await mkdir(source)
    await writeFile(join(source, 'index.html'), html)
    const requests = []
    const server = createServer(async (request, response) => {
        let body = ''
        for await (const chunk of request) body += chunk
        requests.push({
            url: request.url,
            method: request.method,
            authorization: request.headers.authorization,
            body,
        })
        response.setHeader('Content-Type', 'application/json')
        const next = scripted[`${request.method} ${request.url}`]?.shift()
        if (next) {
            response.writeHead(next[0], next[2]).end(JSON.stringify(next[1]))
        } else if (request.url.startsWith('/oidc?')) {
            response.end(JSON.stringify({ value: 'test-oidc-token' }))
        } else if (
            request.url === '/api/decks/talk/uploads' &&
            request.method === 'POST'
        ) {
            response.end(
                JSON.stringify({
                    deploymentId: 'test-deployment',
                    credential: canary,
                    privateField: unexpected,
                }),
            )
        } else if (
            request.url === '/api/uploads/test-deployment' &&
            request.method === 'GET'
        ) {
            response.end(
                JSON.stringify({
                    state: 'uploading',
                    files: [
                        {
                            id: '0',
                            path: 'index.html',
                            size: Buffer.byteLength(html),
                            sha256: createHash('sha256')
                                .update(html)
                                .digest('hex'),
                            received: false,
                        },
                    ],
                }),
            )
        } else if (
            request.url === '/api/uploads/test-deployment/files/0' &&
            request.method === 'PUT'
        ) {
            response.end('{}')
        } else if (
            request.url === '/api/uploads/test-deployment/finalize' &&
            request.method === 'POST'
        ) {
            response.end(
                JSON.stringify({
                    commit: 'c'.repeat(40),
                    state: 'ready',
                    credential: canary,
                    privateField: unexpected,
                }),
            )
        } else {
            response.writeHead(404).end('{}')
        }
    })
    await new Promise((resolve, reject) => {
        server.once('error', reject)
        server.listen(0, '127.0.0.1', resolve)
    })
    servers.push(server)
    const origin = `http://127.0.0.1:${server.address().port}`
    const env = { ...process.env }
    for (const key of Object.keys(env)) {
        if (
            key.startsWith('SLIDE_') ||
            key.startsWith('ACTIONS_') ||
            ['GITHUB_ACTIONS', 'GITHUB_OUTPUT'].includes(key)
        )
            delete env[key]
    }
    env.SLIDE_DECK = 'talk'
    return { directory, source, requests, origin, env }
}

function upload(fixture, env) {
    return run(
        process.execPath,
        ['scripts/upload.mjs', fixture.source, fixture.origin],
        {
            env: { ...fixture.env, ...env },
            timeout: 10_000,
        },
    )
}

test('GitHub Actions publishes only the allowlisted report after a real HTTP upload', async () => {
    const f = await fixture()
    const report = join(f.directory, 'report.json')
    const githubOutput = join(f.directory, 'github-output')
    const { stdout, stderr } = await upload(f, {
        GITHUB_ACTIONS: 'true',
        GITHUB_OUTPUT: githubOutput,
        SLIDE_REPORT_FILE: report,
        ACTIONS_ID_TOKEN_REQUEST_URL: `${f.origin}/oidc`,
        ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'oidc-request-token',
    })
    const expected = {
        deploymentId: 'test-deployment',
        commit: 'c'.repeat(40),
        state: 'ready',
        statusUrl: `${f.origin}/uploads/test-deployment`,
        publicationApplied: false,
    }
    const reportText = await readFile(report, 'utf8')
    const outputText = await readFile(githubOutput, 'utf8')
    expect(JSON.parse(reportText)).toEqual(expected)
    const maskCommand = `::add-mask::${canary}\n`
    expect(stdout.startsWith(maskCommand)).toBe(true)
    const publicStdout = stdout.slice(maskCommand.length)
    expect(JSON.parse(publicStdout)).toEqual(expected)
    expect(outputText).toBe(
        Object.entries(expected)
            .map(([key, value]) => `${key}=${value}\n`)
            .join(''),
    )
    for (const output of [reportText, outputText, publicStdout, stderr]) {
        expect(output).not.toContain(canary)
        expect(output).not.toContain(unexpected)
        expect(output).not.toContain('privateField')
    }
    expect(
        f.requests.find((request) => request.method === 'PUT'),
    ).toMatchObject({
        authorization: `Bearer ${canary}`,
        body: html,
    })
    expect(f.requests.at(-1).url).toBe('/api/uploads/test-deployment/finalize')
})

test('local private receipts retain the credential with owner-only permissions', async () => {
    const f = await fixture()
    const receipt = join(f.directory, 'private-receipt.json')
    const { stdout } = await upload(f, {
        SLIDE_DEPLOYMENT_ID: 'test-deployment',
        SLIDE_UPLOAD_CREDENTIAL: canary,
        SLIDE_CREDENTIAL_FILE: receipt,
    })
    expect(JSON.parse(await readFile(receipt, 'utf8'))).toEqual({
        deploymentId: 'test-deployment',
        credential: canary,
        api: f.origin,
        statusUrl: `${f.origin}/uploads/test-deployment`,
    })
    expect((await stat(receipt)).mode & 0o777).toBe(0o600)
    expect(stdout).not.toContain(canary)
    await expect(
        upload(f, {
            SLIDE_DEPLOYMENT_ID: 'test-deployment',
            SLIDE_UPLOAD_CREDENTIAL: canary,
            SLIDE_CREDENTIAL_FILE: receipt,
        }),
    ).rejects.toThrow()
    expect(JSON.parse(await readFile(receipt, 'utf8')).credential).toBe(canary)
})

test('GitHub Actions rejects private receipts before authentication, network access or writes', async () => {
    const f = await fixture()
    await expect(
        upload(f, {
            GITHUB_ACTIONS: 'true',
            SLIDE_CREDENTIAL_FILE: join(f.directory, 'private-receipt.json'),
            SLIDE_REPORT_FILE: join(f.directory, 'report.json'),
            GITHUB_OUTPUT: join(f.directory, 'github-output'),
            ACTIONS_ID_TOKEN_REQUEST_URL: `${f.origin}/oidc`,
            ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'oidc-request-token',
        }),
    ).rejects.toThrow('SLIDE_CREDENTIAL_FILE is only supported locally')
    expect(f.requests).toEqual([])
    expect(await readdir(f.directory)).toEqual(['source'])
})

test.each(['SLIDE_CREDENTIAL_FILE', 'GITHUB_OUTPUT'])(
    'rejects a public report sharing the %s path before network access',
    async (key) => {
        const f = await fixture()
        const path = join(f.directory, 'output.json')
        await expect(
            upload(f, {
                SLIDE_REPORT_FILE: path,
                [key]: join(f.directory, '.', 'output.json'),
            }),
        ).rejects.toThrow('Output files must use different paths')
        expect(f.requests).toEqual([])
        expect(await readdir(f.directory)).toEqual(['source'])
    },
)

const actions = (f) => ({
    GITHUB_ACTIONS: 'true',
    SLIDE_RETRY_DELAY_MS: '1',
    ACTIONS_ID_TOKEN_REQUEST_URL: `${f.origin}/oidc`,
    ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'oidc-request-token',
})
const calls = (f, method, url) =>
    f.requests.filter(
        (request) => request.method === method && request.url === url,
    ).length

test('an expired credential is renewed with a fresh OIDC token and the same session continues', async () => {
    const renewed = 'renewed-upload-credential-canary'
    const f = await fixture({
        'POST /api/decks/talk/uploads': [
            [201, { deploymentId: 'test-deployment', credential: canary }],
            [201, { deploymentId: 'test-deployment', credential: renewed }],
        ],
        'PUT /api/uploads/test-deployment/files/0': [
            [401, { error: 'expired', code: 'credential_expired' }],
        ],
    })
    const { stdout } = await upload(f, actions(f))
    expect(stdout).toContain('"state": "ready"')
    // The renewed credential is masked before anything else is printed.
    expect(stdout).toContain(`::add-mask::${renewed}`)
    expect(
        f.requests.filter(({ method }) => method === 'PUT').at(-1)
            ?.authorization,
    ).toBe(`Bearer ${renewed}`)
    expect(calls(f, 'POST', '/api/decks/talk/uploads')).toBe(2)
    expect(
        f.requests.filter((request) => request.url.startsWith('/oidc?')).length,
    ).toBe(2)
    expect(calls(f, 'PUT', '/api/uploads/test-deployment/files/0')).toBe(2)
})

test('files the service could not verify are resent before finalizing again', async () => {
    const f = await fixture({
        'POST /api/uploads/test-deployment/finalize': [
            [
                409,
                {
                    error: 'Files are missing',
                    code: 'files_missing',
                    missing: ['index.html'],
                },
            ],
        ],
    })
    await upload(f, actions(f))
    expect(calls(f, 'PUT', '/api/uploads/test-deployment/files/0')).toBe(2)
    expect(calls(f, 'POST', '/api/uploads/test-deployment/finalize')).toBe(2)
})

test('transient conflicts are retried and a busy start waits for its turn', async () => {
    const f = await fixture({
        'POST /api/decks/talk/uploads': [
            [429, { error: 'busy', code: 'upload_busy' }],
        ],
        'PUT /api/uploads/test-deployment/files/0': [
            [409, { error: 'Another file is being received; retry' }],
        ],
    })
    const { stdout } = await upload(f, actions(f))
    expect(stdout).toContain('"state": "ready"')
    expect(calls(f, 'POST', '/api/decks/talk/uploads')).toBe(2)
    expect(calls(f, 'PUT', '/api/uploads/test-deployment/files/0')).toBe(2)
})

test('a refused start reports its reason and stops without sending files', async () => {
    const f = await fixture({
        'POST /api/decks/talk/uploads': [
            [
                413,
                {
                    error: 'An upload file exceeds the file byte limit',
                    code: 'start_rejected',
                    reason: 'file_too_large',
                    deploymentId: 'refused',
                },
            ],
        ],
    })
    await expect(upload(f, actions(f))).rejects.toThrow(
        'Upload refused (file_too_large)',
    )
    expect(f.requests.some((request) => request.method === 'PUT')).toBe(false)
})

test.each([
    ['session_expired', 409],
    ['session_failed', 409],
])('a %s session stops instead of retrying', async (code, status) => {
    const f = await fixture({
        'PUT /api/uploads/test-deployment/files/0': [
            [status, { error: code, code }],
        ],
    })
    await expect(upload(f, actions(f))).rejects.toThrow(`(${status})`)
    expect(calls(f, 'PUT', '/api/uploads/test-deployment/files/0')).toBe(1)
})

test('a credential that expires while resuming locally cannot be renewed without Actions', async () => {
    const f = await fixture({
        'GET /api/uploads/test-deployment': [
            [401, { error: 'expired', code: 'credential_expired' }],
        ],
    })
    await expect(
        upload(f, {
            SLIDE_DEPLOYMENT_ID: 'test-deployment',
            SLIDE_UPLOAD_CREDENTIAL: canary,
        }),
    ).rejects.toThrow('Run in GitHub Actions')
})

test('the OIDC audience follows the service URL so another host cannot replay the token', async () => {
    const f = await fixture()
    await upload(f, actions(f))
    const request = f.requests.find(({ url }) => url.startsWith('/oidc?'))
    expect(new URL(request.url, f.origin).searchParams.get('audience')).toBe(
        f.origin,
    )
})

test('a concurrent credential rotation is retried', async () => {
    const f = await fixture({
        'GET /api/uploads/test-deployment': [
            [409, { error: 'changed', code: 'session_changed' }],
        ],
    })
    const { stdout } = await upload(f, actions(f))
    expect(stdout).toContain('"state": "ready"')
})

test('a rate-limited request waits for Retry-After before retrying', async () => {
    const limited = [
        429,
        { error: 'Too many requests; retry later', code: 'rate_limited' },
        { 'Retry-After': '1' },
    ]
    const f = await fixture({
        'PUT /api/uploads/test-deployment/files/0': [limited],
    })
    const started = Date.now()
    const { stdout } = await upload(f, actions(f))
    expect(Date.now() - started).toBeGreaterThanOrEqual(1000)
    expect(stdout).toContain('"state": "ready"')
    expect(calls(f, 'PUT', '/api/uploads/test-deployment/files/0')).toBe(2)
})

test('retries stop after five transient failures', async () => {
    const busy = [429, { error: 'busy', code: 'upload_busy' }]
    const f = await fixture({
        'PUT /api/uploads/test-deployment/files/0': Array.from(
            { length: 6 },
            () => busy,
        ),
    })
    await expect(upload(f, actions(f))).rejects.toThrow('(429)')
    expect(calls(f, 'PUT', '/api/uploads/test-deployment/files/0')).toBe(5)
})

test('finalize gives up after three rounds of missing files', async () => {
    const missing = [
        409,
        {
            error: 'Files are missing',
            code: 'files_missing',
            missing: ['index.html'],
        },
    ]
    const f = await fixture({
        'POST /api/uploads/test-deployment/finalize': [
            missing,
            missing,
            missing,
        ],
    })
    await expect(upload(f, actions(f))).rejects.toThrow('(409)')
    expect(calls(f, 'POST', '/api/uploads/test-deployment/finalize')).toBe(3)
})

test('a result that could inject step outputs is refused', async () => {
    const f = await fixture({
        'POST /api/uploads/test-deployment/finalize': [
            [200, { commit: 'abc\nstate=evil', state: 'ready' }],
        ],
    })
    const githubOutput = join(f.directory, 'github-output')
    await expect(
        upload(f, { ...actions(f), GITHUB_OUTPUT: githubOutput }),
    ).rejects.toThrow('unexpected result')
    await expect(readFile(githubOutput, 'utf8')).rejects.toThrow()
})

test.each([
    ['true', { publication: { published: true } }],
    ['false', { publication: { published: false } }],
    ['', {}],
])(
    'SLIDE_PUBLISHED=%j sends the matching publication request and reports whether it applied',
    async (published, extra) => {
        const f = await fixture({
            'POST /api/uploads/test-deployment/finalize': [
                [
                    200,
                    {
                        commit: 'c'.repeat(40),
                        state: 'ready',
                        publication: { applied: published !== '' },
                    },
                ],
            ],
        })
        const { stdout } = await upload(f, {
            SLIDE_PUBLISHED: published,
            SLIDE_UPLOAD_CREDENTIAL: canary,
            SLIDE_DEPLOYMENT_ID: 'test-deployment',
        })
        expect(JSON.parse(stdout.slice(stdout.indexOf('{')))).toMatchObject({
            publicationApplied: published !== '',
        })
        const resumed = await upload(f, {
            SLIDE_PUBLISHED: published,
            ACTIONS_ID_TOKEN_REQUEST_URL: `${f.origin}/oidc`,
            ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'oidc-request-token',
        })
        expect(resumed.stdout).toContain('"deploymentId"')
        const start = f.requests.find(
            (request) => request.url === '/api/decks/talk/uploads',
        )
        expect(JSON.parse(start.body)).toEqual({
            entry: 'index.html',
            files: [expect.objectContaining({ path: 'index.html' })],
            ...extra,
        })
    },
)

test('an invalid SLIDE_PUBLISHED is refused before any request', async () => {
    const f = await fixture()
    await expect(upload(f, { SLIDE_PUBLISHED: 'yes' })).rejects.toThrow(
        /SLIDE_PUBLISHED must be true, false, or empty/,
    )
    expect(f.requests).toEqual([])
})
