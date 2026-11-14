import type { Post } from './post'
import type { StoredPost } from './store'

/** One post about a deck, at the time it was made. */
export type TimelineItem = Readonly<{
  id: string
  post: Post
  at: number
}>

/**
 * The posts about a deck as a timeline, newest first. A post whose own time
 * is unknown counts from when it was added. A post's author states its time,
 * so one that claims to be later than when it was added counts from then too.
 */
export function timelineOf(posts: readonly StoredPost[]): TimelineItem[] {
  return posts
    .map((item) => ({
      id: item.id,
      post: item.post,
      at: Math.min(item.postedAt ?? item.addedAt, item.addedAt),
    }))
    .sort((a, b) => b.at - a.at)
}
