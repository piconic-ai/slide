-- Migration number: 0052 	 2026-11-25T18:55:04.147Z
-- The address a related link leads to and is shown as (F27-AC59〜F27-AC61):
-- its url without the tracking parts of the query, Luma's tk and Medium's
-- source. New links get it from sanitizedUrlOf (src/links/sanitize.ts). The
-- links kept so far get it here, from the url they keep (the href), by the
-- same rule written in SQL. src/db/related-link-sanitized-migration.test.ts
-- checks that both give the same address. When the rule changes, a migration
-- builds the address again.
-- The column may be NULL so that the Worker before this one, which does not
-- write it, still adds links. Nothing is dropped or rebuilt.
ALTER TABLE related_links ADD COLUMN sanitized_url TEXT;

WITH
-- The address before #, and the # with what follows it.
bare AS (
  SELECT id, url,
    CASE instr(url, '#') WHEN 0 THEN url ELSE substr(url, 1, instr(url, '#') - 1) END AS address,
    CASE instr(url, '#') WHEN 0 THEN '' ELSE substr(url, instr(url, '#')) END AS fragment
  FROM related_links
),
-- The authority (after https://), the address before ?, and the query.
halves AS (
  SELECT id, url, fragment,
    substr(address, 9, instr(substr(address, 9), '/') - 1) AS authority,
    substr(address, 1, instr(address, '?') - 1) AS head,
    substr(address, instr(address, '?') + 1) AS query
  FROM bare
  WHERE instr(address, '?') > 0
),
-- The host without its port (an IPv6 host holds colons and is no site of
-- the rules) and one final dot.
hosted AS (
  SELECT id, url, fragment, head, query,
    CASE
      WHEN substr(authority, 1, 1) = '[' OR instr(authority, ':') = 0 THEN authority
      ELSE substr(authority, 1, instr(authority, ':') - 1)
    END AS host
  FROM halves
),
dotless AS (
  SELECT id, url, fragment, head, query,
    CASE WHEN substr(host, -1) = '.' THEN substr(host, 1, length(host) - 1) ELSE host END AS host
  FROM hosted
),
-- The site of the host without one leading www.
sited AS MATERIALIZED (
  SELECT id, url, fragment, head, query,
    CASE
      WHEN host IN ('lu.ma', 'luma.com', 'www.lu.ma', 'www.luma.com') THEN 'luma'
      WHEN host IN ('medium.com', 'www.medium.com') OR substr(host, -11) = '.medium.com' THEN 'medium'
      ELSE ''
    END AS site
  FROM dotless
),
-- The query parts as written, empty ones too, split at & through a JSON array.
pieces AS MATERIALIZED (
  SELECT sited.id, sited.site, part.key AS key, part.value AS value,
    CASE instr(part.value, '=') WHEN 0 THEN part.value
      ELSE substr(part.value, 1, instr(part.value, '=') - 1) END AS name
  FROM sited,
    json_each('["' || replace(replace(replace(sited.query, '\', '\\'), '"', '\"'), '&', '","') || '"]') AS part
),
-- The parts the address keeps.
kept AS MATERIALIZED (
  SELECT id, key, value FROM pieces
  WHERE substr(name, 1, 4) <> 'utm_'
    AND name NOT IN ('fbclid', 'gclid', 'mc_cid', 'mc_eid', 'msclkid', 'yclid', 'dclid', 'igshid', 'ref_src', '_ga', '_gl')
    AND NOT (site = 'luma' AND name = 'tk')
    AND NOT (site = 'medium' AND name = 'source')
),
counted AS (
  SELECT sited.id, sited.url, sited.fragment, sited.head,
    (SELECT count(*) FROM pieces WHERE pieces.id = sited.id) AS parts,
    (SELECT count(*) FROM kept WHERE kept.id = sited.id) AS kept_parts,
    coalesce((SELECT group_concat(value, '&' ORDER BY key) FROM kept WHERE kept.id = sited.id), '') AS kept_query
  FROM sited
),
-- An address that loses no part stays as it is.
sanitized AS (
  SELECT id,
    CASE
      WHEN kept_parts = parts THEN url
      ELSE head || CASE kept_query WHEN '' THEN '' ELSE '?' || kept_query END || fragment
    END AS href
  FROM counted
)
UPDATE related_links SET sanitized_url = coalesce(
  (SELECT href FROM sanitized WHERE sanitized.id = related_links.id),
  url
);
