/**
 * How many communities an author follows, as the reader of the profile may
 * see them: the count beside the "communities" tab. Always 0 until the work
 * on following communities adds the table it reads.
 */
export const countFollowedCommunities = async (
  _database: D1Database,
  _query: Readonly<{ of: string; viewer: string | null }>,
): Promise<number> => 0
