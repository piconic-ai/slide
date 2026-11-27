import { expect, test } from 'vitest'
import { homePagePolicy, topPagePolicy } from '../decks/pages'
import { policyCovers } from './router-policy'

const CONTENT = new URL('https://content.example')
const ORIGIN = 'https://slide.example'
const directive = (policy: string, name: string) =>
  policy
    .split('; ')
    .find((part) => part.startsWith(`${name} `))
    ?.split(' ')
    .slice(1)

test('F44-AC27: Given the origin of the service, When the top policy is made, Then it frames the embed pages of that origin and nothing else', () => {
  const policy = topPagePolicy(CONTENT, ORIGIN)
  expect(directive(policy, 'frame-src')).toEqual([`${ORIGIN}/embed/`])
  expect(policy.match(/frame-src/g)).toHaveLength(1)
})

test('F44-AC27: Given the shared home policy, When the top policy is made, Then it keeps every other directive of it', () => {
  for (const content of [CONTENT, null]) {
    const shared = homePagePolicy(content)
    const top = topPagePolicy(content, ORIGIN)
    expect(top.startsWith(`${shared}; `)).toBe(true)
    expect(top.replace(/; frame-src [^;]*$/, '')).toBe(shared)
  }
})

test('F44-AC27: Given the shared home policy, When it is made, Then it frames nothing, as the articles, communities and slides pages need', () => {
  for (const content of [CONTENT, null])
    expect(homePagePolicy(content)).not.toContain('frame-src')
})

test('F44-AC27: Given the top policy and the shared one, When a move between them is judged, Then moving from the top to the others needs no page load, and moving to the top from the others does', () => {
  const shared = homePagePolicy(CONTENT)
  const top = topPagePolicy(CONTENT, ORIGIN)
  expect(policyCovers(top, shared, false)).toBe(true)
  expect(policyCovers(shared, top, false)).toBe(false)
})
