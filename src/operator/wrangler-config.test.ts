import { readFile } from 'node:fs/promises'
import { expect, test } from 'vitest'
import { parseOperatorConfig } from './config'

/** The checked-in Worker configuration, with its comments removed. */
async function wranglerConfig() {
  const text = await readFile('wrangler.jsonc', 'utf8')
  const json = text.replace(/^\s*\/\/.*$/gm, '').replace(/,(\s*[}\]])/g, '$1')
  return JSON.parse(json) as {
    routes: { pattern: string; custom_domain?: boolean }[]
    vars: Record<string, string | undefined>
    workers_dev?: boolean
  }
}

test('F17-AC19: Given the checked-in Worker configuration, When the operator origin is parsed, Then it is usable and names a host the Worker is routed on, so that host never falls through to another app', async () => {
  const { routes, vars } = await wranglerConfig()
  const config = parseOperatorConfig({
    origin: vars.OPERATOR_ORIGIN,
    teamDomain: vars.ACCESS_TEAM_DOMAIN,
    audience: vars.ACCESS_AUD,
    publicOrigin: vars.PUBLIC_ORIGIN ?? '',
    contentOrigin: vars.CONTENT_ORIGIN,
  })
  expect(config).not.toBeNull()
  expect(routes.map((route) => route.pattern)).toContain(config?.host)
})

test('F17-AC19: Given the checked-in Worker configuration, When its routes are listed, Then every custom domain is the management host or the operator host', async () => {
  const { routes, vars } = await wranglerConfig()
  const known = [vars.PUBLIC_ORIGIN, vars.OPERATOR_ORIGIN].map(
    (origin) => new URL(origin ?? '').hostname,
  )
  const domains = routes
    .filter((route) => route.custom_domain)
    .map((route) => route.pattern)
  expect(domains.toSorted()).toEqual(known.toSorted())
})

test('F17-AC12: Given the checked-in Worker configuration, When Access settings are present, Then both are, and they parse', async () => {
  const { vars } = await wranglerConfig()
  const set = [vars.ACCESS_TEAM_DOMAIN, vars.ACCESS_AUD].filter(Boolean)
  if (set.length === 0) return
  const config = parseOperatorConfig({
    origin: vars.OPERATOR_ORIGIN,
    teamDomain: vars.ACCESS_TEAM_DOMAIN,
    audience: vars.ACCESS_AUD,
    publicOrigin: vars.PUBLIC_ORIGIN ?? '',
    contentOrigin: vars.CONTENT_ORIGIN,
  })
  expect(config?.access).not.toBeNull()
})
