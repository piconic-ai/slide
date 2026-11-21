import { drizzle } from 'drizzle-orm/d1'
import { keepArticle } from '../articles/store'
import { citations, follows } from '../db/schema'
import { addLink } from '../links/store'
import {
  INVITED_ID,
  OWNER_ID,
  seedPublic,
  signIn,
} from '../publication/test-support'

/**
 * Test fixture: two signed-in authors with profiles, slides that cite each
 * other, a published article, related links and a follow, so that every page
 * of the second scope has something to show. Returns what a test needs to
 * open the pages as each of them.
 */
export async function seedIntegration(env: Env) {
  const db = env.DB
  const orm = drizzle(db)
  const owner = await signIn(env, 'owner', {
    name: 'Owner Name',
    bio: 'I write talks.',
    location: 'Tokyo',
    website: 'https://example.com/owner',
  })
  const bob = await signIn(env, 'bob', { id: INVITED_ID, name: 'Bob Builder' })
  const talk = await seedPublic(db, 'talk', 1000, 'A talk')
  const reply = await seedPublic(db, 'reply', 2000, 'A reply', INVITED_ID)
  await orm.insert(citations).values({
    deployment_id: reply,
    target_handle: 'owner',
    target_slug: 'talk',
    target_page: 2,
  })
  await keepArticle(db, {
    deckId: 'talk',
    body: 'The talk, as text. See [the reply](/@bob/reply).',
    status: 'published',
    citations: [{ handle: 'bob', slug: 'reply', page: 0 }],
    now: 10,
  })
  for (const kind of ['video', 'article', 'other'] as const)
    await addLink(db, {
      deckId: 'talk',
      ownerUserId: OWNER_ID,
      link: { kind, url: `https://example.com/${kind}`, title: `A ${kind}` },
      now: 10,
    })
  await orm.insert(follows).values([
    { follower_user_id: OWNER_ID, followee_user_id: INVITED_ID, created_at: 1 },
    { follower_user_id: INVITED_ID, followee_user_id: OWNER_ID, created_at: 1 },
  ])
  return { owner, bob, talk, reply }
}
