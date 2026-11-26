import { describe, expect, it } from 'vitest'
import { touchesOf } from './email-touches.mjs'

const options = {
  columns: [
    { table: 'auth_user', column: 'email', drizzle: 'authUser.email' },
    {
      table: 'mail_outbox',
      column: 'to_address',
      drizzle: 'mailOutbox.to_address',
    },
  ],
  ignoredReceivers: ['operator', 'z'],
  accessors: [
    {
      module: 'src/profile/store.ts',
      name: 'readEmail',
      touches: 'auth_user.email',
    },
  ],
}
const touches = (source, path = 'src/a/x-store.ts') =>
  touchesOf(path, source, options)

describe('touchesOf: a column named by drizzle', () => {
  it('Given a table imported and its address column read, Then the column is touched', () => {
    expect(
      touches(`import { authUser } from '../db/auth-schema'
db.select({ email: authUser.email }).from(authUser)`),
    ).toEqual(['auth_user.email'])
  })

  it('Given the table imported under another name, Then the column is still found', () => {
    expect(
      touches(`import { authUser as people } from '../db/auth-schema'
eq(people.email, address)`),
    ).toEqual(['auth_user.email'])
  })

  it("Given a table's other column, Then nothing is touched", () => {
    expect(
      touches(`import { authUser } from '../db/auth-schema'
db.select({ id: authUser.id }).from(authUser)`),
    ).toEqual([])
  })

  it("Given a local of the table's name that was not imported, Then it is not the table but still an object's \`email\`", () => {
    expect(
      touches(`const authUser = { email: 1 }\nuse(authUser.email)`),
    ).toEqual(['.email'])
  })
})

describe('touchesOf: the `email` of an object', () => {
  it.each([
    ['a read', 'const a = user.email'],
    ['an optional read', 'const a = row?.email'],
    ['a read in a call', 'send(session.user.email)'],
    ['a destructuring', 'const { email } = user'],
    ['a destructured parameter', 'async function f({ email, otp }) {}'],
    ['a renamed destructuring', 'const { email: address } = user'],
  ])('Given %s, Then `.email` is touched', (_label, source) => {
    expect(touches(source)).toEqual(['.email'])
  })

  it.each([
    ['the operator’s own address', `const a = c.get('operator').email`],
    ['the operator of a view', 'const a = view.operator.email'],
    ['zod’s validator', 'const a = z.email()'],
    ['another property', 'const a = user.emailVerified'],
    ['a key that is only written', 'const a = { email: typed }'],
    ['a comment', '// user.email is shown here\nconst a = 1'],
  ])('Given %s, Then nothing is touched', (_label, source) => {
    expect(touches(source)).toEqual([])
  })

  it('Given an address read through a computed key, Then it is not seen (a known limit)', () => {
    expect(touches(`const key = 'email'\nconst a = user[key]`)).toEqual([])
  })
})

describe('touchesOf: SQL written as a string', () => {
  it.each([
    ['a plain string', `'SELECT email FROM auth_user WHERE id = ?1'`],
    ['a template', '`DELETE FROM auth_user WHERE email = ${x}`'],
    ['a template with the names in its parts', '`${a} auth_user ${b} email`'],
    ['upper case', `'select EMAIL from AUTH_USER'`],
  ])(
    'Given %s that names the table and the column, Then the column is touched',
    (_label, source) => {
      expect(touches(`database.prepare(${source})`)).toEqual([
        'auth_user.email',
      ])
    },
  )

  it.each([
    ['the table only', `'SELECT id FROM auth_user'`],
    ['the column only', `'email'`],
    ['a longer name', `'SELECT email_verified FROM auth_user'`],
    ['a longer table', `'SELECT email FROM auth_user_old'`],
  ])('Given a string with %s, Then nothing is touched', (_label, source) => {
    expect(touches(`database.prepare(${source})`)).toEqual([])
  })

  it('Given the outbox column in a string, Then it is touched', () => {
    expect(touches(`sql\`SELECT to_address FROM mail_outbox\``)).toEqual([
      'mail_outbox.to_address',
    ])
  })
})

describe('touchesOf: a function that returns an address', () => {
  it.each([
    [
      'from a file beside',
      'src/profile/face-routes.ts',
      `import { readEmail } from './store'`,
    ],
    [
      'from another folder',
      'src/site/settings-routes.ts',
      `import { readEmail } from '../profile/store'`,
    ],
    [
      'under another name',
      'src/site/x.ts',
      `import { readEmail as read } from '../profile/store'`,
    ],
  ])(
    'Given an import %s, Then the column it reads is touched',
    (_label, path, source) => {
      expect(touches(source, path)).toEqual(['auth_user.email'])
    },
  )

  it.each([
    [
      'another function of the file',
      `import { readProfile } from '../profile/store'`,
    ],
    [
      'the name from another file',
      `import { readEmail } from '../other/store'`,
    ],
    ['a package', `import { readEmail } from 'profile/store'`],
  ])('Given %s, Then nothing is touched', (_label, source) => {
    expect(touches(source, 'src/site/x.ts')).toEqual([])
  })
})

describe('touchesOf: what it returns', () => {
  it('Given several touches, Then they are sorted and appear once', () => {
    expect(
      touches(`import { authUser } from '../db/auth-schema'
a.email; b.email
eq(authUser.email, x)
'SELECT email FROM auth_user'`),
    ).toEqual(['.email', 'auth_user.email'])
  })

  it('Given JSX, Then it is read as such', () => {
    expect(
      touches(`const a = <p>{account.email}</p>`, 'src/site/x-page.tsx'),
    ).toEqual(['.email'])
  })

  it('Given an empty file, Then nothing is touched', () => {
    expect(touches('')).toEqual([])
  })
})
