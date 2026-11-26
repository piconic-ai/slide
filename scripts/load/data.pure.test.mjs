import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { datasetStatements, LARGE_DATASET } from './dataset-sql.mjs'
import { localAuthors, MOST_AUTHORS } from './local-authors.mjs'

describe('the data of a large database', () => {
  it('COST-AC5: Given the large size, When the statements are made, Then each inserts a series of the size it names', () => {
    const statements = datasetStatements(LARGE_DATASET)
    const text = statements.join('\n')
    expect(text).toContain('i < 10000)')
    expect(text).toContain(`i < ${LARGE_DATASET.people})`)
    expect(text).toContain(
      `i < ${LARGE_DATASET.people * LARGE_DATASET.followsPerPerson})`,
    )
    expect(text).toContain(
      `i < ${LARGE_DATASET.slides * LARGE_DATASET.filesPerSlide})`,
    )
    // Every statement is one: nothing in it ends a statement early.
    for (const statement of statements) expect(statement).not.toContain(';')
    expect(statements.length).toBeGreaterThanOrEqual(10)
  })

  it('COST-AC5: Given the same size twice, When the statements are made, Then they are the same', () => {
    expect(datasetStatements(LARGE_DATASET)).toEqual(
      datasetStatements({ ...LARGE_DATASET }),
    )
  })

  it('COST-AC5: Given a smaller size, When the statements are made, Then the numbers follow it', () => {
    const text = datasetStatements({
      ...LARGE_DATASET,
      slides: 77,
      people: 7,
    }).join('\n')
    expect(text).toContain('i < 77)')
    expect(text).toContain('i < 7)')
    expect(text).not.toContain('i < 10000)')
  })
})

describe('authors for a local Worker', () => {
  const make = (count, now = 1_700_000_000_000) =>
    localAuthors({
      count,
      secret: 'local-demo-only-better-auth-secret-000000',
      now,
      token: (index) => `${'t'.repeat(15)}${String(index).padStart(5, '0')}`,
    })

  it('COST-AC5: Given 3 authors, When they are made, Then each has a session, an account and a cookie signed with the secret', () => {
    const { sql, cookies } = make(3)
    expect(cookies).toHaveLength(3)
    expect(new Set(cookies).size).toBe(3)
    for (const index of [1, 2, 3]) {
      expect(sql).toContain(`'load${index}'`)
      const token = `${'t'.repeat(15)}${String(index).padStart(5, '0')}`
      const signature = createHmac(
        'sha256',
        'local-demo-only-better-auth-secret-000000',
      )
        .update(token)
        .digest('base64')
      expect(cookies[index - 1]).toBe(
        `__Host-slide_owner=${encodeURIComponent(`${token}.${signature}`)}`,
      )
    }
    expect(sql).toContain('INSERT INTO accounts')
    expect(sql).toContain('INSERT INTO auth_session')
  })

  it.each([[0], [-1], [1.5], [MOST_AUTHORS + 1], [Number.NaN]])(
    'COST-AC5: Given the count %j, When authors are made, Then it is refused',
    (count) => {
      expect(() => make(count)).toThrow()
    },
  )

  it('COST-AC5: Given a secret that is too short, When authors are made, Then no cookie is signed', () => {
    expect(() =>
      localAuthors({
        count: 1,
        secret: 'short',
        now: 1,
        token: () => 'a'.repeat(16),
      }),
    ).toThrow()
  })
})
