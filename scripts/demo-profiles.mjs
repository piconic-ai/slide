// Fixed profiles for the two local demo authors. They are written to the
// local D1 only, with no call to GitHub, so a screen shows a picture or an
// initial, a name, a place, a site and a bio without the network. The picture
// is a URL in the form the page policy allows (AVATAR_ORIGIN); the second
// author has none, so the initial shows.

const quote = (value) =>
  value === null ? 'NULL' : `'${String(value).replaceAll("'", "''")}'`

/** What GitHub would have answered, as saved in the `profiles` table. */
export const DEMO_PROFILES = {
  722500: {
    login: 'kfly8',
    name: 'Kenta Demo',
    avatarUrl: 'https://avatars.githubusercontent.com/u/722500?v=4',
    location: 'Tokyo, Japan',
    website: 'https://example.com/',
    bio: 'Demo author. I give talks about testing UI code, and I write the slides in plain HTML.',
  },
  900001: {
    login: 'demo-reader',
    name: 'Rina Reader',
    avatarUrl: null,
    location: 'Osaka, Japan',
    website: 'https://example.org/',
    bio: 'Demo reader. I cite other authors’ pages in my own slides.',
  },
}

/** The statement that keeps one demo author's profile, replacing any older one. */
export function profileSql(userId, now) {
  const profile = DEMO_PROFILES[userId]
  if (!profile) throw new Error(`No demo profile for ${userId}`)
  return `INSERT INTO profiles
      (user_id,login,name,avatar_url,location,website,bio,has_sponsors,synced_at)
    VALUES (${quote(userId)},${quote(profile.login)},${quote(profile.name)},
      ${quote(profile.avatarUrl)},${quote(profile.location)},${quote(profile.website)},
      ${quote(profile.bio)},0,${now})
    ON CONFLICT (user_id) DO UPDATE SET login = excluded.login,
      name = excluded.name, avatar_url = excluded.avatar_url,
      location = excluded.location, website = excluded.website,
      bio = excluded.bio, synced_at = excluded.synced_at;`
}
