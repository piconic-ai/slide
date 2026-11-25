// Fixed profiles for the two local demo authors. They are written to the
// local D1 only, so a screen shows a name, a place, a site and a bio without
// anyone typing them at /welcome. Pictures come with the profile's own
// settings (F28-AC41), so the initial shows.

const quote = (value) =>
  value === null ? 'NULL' : `'${String(value).replaceAll("'", "''")}'`

/** What an author would have written, as kept in the `profiles` table. */
export const DEMO_PROFILES = {
  722500: {
    name: 'Kenta Demo',
    location: 'Tokyo, Japan',
    website: 'https://example.com/',
    bio: 'Demo author. I give talks about testing UI code, and I write the slides in plain HTML.',
  },
  900001: {
    name: 'Rina Reader',
    location: 'Osaka, Japan',
    website: 'https://example.org/',
    bio: 'Demo reader. I cite other authors’ pages in my own slides.',
  },
}

/** The statement that keeps one demo author's profile, replacing any older one. */
export function profileSql(userId) {
  const profile = DEMO_PROFILES[userId]
  if (!profile) throw new Error(`No demo profile for ${userId}`)
  return `INSERT INTO profiles (user_id,name,location,website,bio)
    VALUES (${quote(userId)},${quote(profile.name)},${quote(profile.location)},
      ${quote(profile.website)},${quote(profile.bio)})
    ON CONFLICT (user_id) DO UPDATE SET name = excluded.name,
      location = excluded.location, website = excluded.website,
      bio = excluded.bio;`
}
