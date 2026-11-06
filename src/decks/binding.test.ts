import { describe, expect, test } from 'vitest'
import {
  bindingDecision,
  bindingRequestSchema,
  storedRefsSchema,
} from './binding'

const request = (overrides: Record<string, unknown> = {}) => ({
  deck: 'talk-2026',
  repository: 'piconic-ai/slide',
  branches: ['main'],
  ...overrides,
})

describe('binding request', () => {
  test('normalizes branches to sorted, unique refs', () => {
    expect(
      bindingRequestSchema.parse(
        request({ branches: ['main', 'release/v1', 'main'] }),
      ).branches,
    ).toEqual(['refs/heads/main', 'refs/heads/release/v1'])
  })

  test.each([
    { deck: '' },
    { deck: 'Talk' },
    { deck: '-talk' },
    { deck: 'talk-' },
    { deck: 'a'.repeat(65) },
    { repository: 'slide' },
    { repository: 'piconic-ai/slide/extra' },
    { repository: 'piconic-ai/..' },
    { repository: '-owner/slide' },
    { branches: [] },
    { branches: Array.from({ length: 11 }, (_, index) => `b${index}`) },
    { branches: ['../main'] },
    { branches: ['main.lock'] },
    { branches: ['a//b'] },
    { branches: ['.hidden'] },
    { branches: ['feature/'] },
    { branches: ['has space'] },
    { branches: ['-flag'] },
    { extra: true },
  ])('rejects %j', (overrides) => {
    expect(bindingRequestSchema.safeParse(request(overrides)).success).toBe(
      false,
    )
  })
})

describe('binding decision', () => {
  const repository = (admin?: boolean) => ({
    id: 1446590227,
    full_name: 'piconic-ai/slide',
    owner: { id: 248307881 },
    ...(admin === undefined ? {} : { permissions: { admin } }),
  })

  test('accepts an administered repository with its numeric IDs', () => {
    expect(bindingDecision(repository(true))).toEqual({
      ok: true,
      repositoryId: '1446590227',
      repositoryOwnerId: '248307881',
      fullName: 'piconic-ai/slide',
    })
  })

  test.each([
    [repository(false), 'not_admin'],
    [repository(), 'not_found'],
    [null, 'not_found'],
  ])('refuses %j as %s', (input, reason) => {
    expect(bindingDecision(input)).toEqual({ ok: false, reason })
  })
})

describe('stored refs', () => {
  test.each(['', 'nope', '[]', '["main"]', '{}'])('rejects %j', (value) => {
    expect(storedRefsSchema.safeParse(value).success).toBe(false)
  })
})
