/**
 * How many people follow a community, beside its followers tab. Always 0
 * until the work on following communities adds the table it reads.
 */
export const countCommunityFollowers = async (
  _database: D1Database,
  _communityId: number,
): Promise<number> => 0
