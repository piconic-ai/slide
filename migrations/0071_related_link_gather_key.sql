-- Migration number: 0071 	 2026-11-28T01:36:08.125Z
-- The key related links are gathered by on one page (F45-AC5, F45-AC23), and
-- the host name a link's address was written with. New links get them from
-- gatherKeyOf and linkHostOf (src/links/gather.ts). The links kept so far get
-- them here, by the same rules written in SQL: gather_key is normalized_url
-- without the query parts that only say where a video starts (`t` on
-- YouTube, `from` on ニコニコ動画: gatheredWithout in src/links/url-rules.ts),
-- and link_host is the host of url, without a final dot and a port.
-- src/db/related-link-gather-migration.test.ts checks that both give the
-- same. When the rules change, a migration builds gather_key again.
-- Both columns may be NULL so that the Worker before this one, which does
-- not write them, still adds links: such a link is gathered with no other
-- until a later migration builds its key. Nothing is dropped or rebuilt, and
-- normalized_url is left as it is.
ALTER TABLE related_links ADD COLUMN gather_key TEXT;
ALTER TABLE related_links ADD COLUMN link_host TEXT;

WITH
-- The authority of the compared form (after https://), and where its query
-- starts.
whole AS (
  SELECT id, normalized_url AS form,
    substr(normalized_url, 9, instr(substr(normalized_url, 9), '/') - 1) AS authority,
    instr(normalized_url, '?') AS mark
  FROM related_links
  WHERE normalized_url IS NOT NULL
),
-- The host without its port (an IPv6 host holds colons and is no site of
-- the rules).
hosted AS (
  SELECT id, form, mark,
    CASE instr(authority, ':') WHEN 0 THEN authority
      ELSE substr(authority, 1, instr(authority, ':') - 1) END AS host
  FROM whole
),
-- The forms with a query on the sites that leave a name out, and that name.
-- A rule that rewrites the host writes one of its own hosts, so the host of
-- the form tells the site.
ruled AS MATERIALIZED (
  SELECT id,
    substr(form, 1, mark - 1) AS head,
    substr(form, mark + 1) AS query,
    CASE WHEN host IN ('youtube.com', 'm.youtube.com', 'youtu.be') THEN 't' ELSE 'from' END AS dropped
  FROM hosted
  WHERE mark > 0
    AND host IN ('youtube.com', 'm.youtube.com', 'youtu.be', 'nicovideo.jp', 'sp.nicovideo.jp', 'nico.ms')
),
-- The query parts in the order of the form, split at & through a JSON
-- array, without the parts of the name left out.
pieces AS MATERIALIZED (
  SELECT ruled.id, part.key AS key, part.value AS value
  FROM ruled,
    json_each('["' || replace(replace(replace(ruled.query, '\', '\\'), '"', '\"'), '&', '","') || '"]') AS part
  WHERE CASE instr(part.value, '=') WHEN 0 THEN part.value
      ELSE substr(part.value, 1, instr(part.value, '=') - 1) END <> ruled.dropped
),
keys AS (
  SELECT ruled.id,
    ruled.head || coalesce('?' || (
      SELECT group_concat(value, '&' ORDER BY key)
      FROM pieces WHERE pieces.id = ruled.id
    ), '') AS gather_key
  FROM ruled
)
UPDATE related_links SET gather_key = coalesce(
  (SELECT gather_key FROM keys WHERE keys.id = related_links.id),
  normalized_url
);

WITH
-- The address after https:// and before #.
bare AS (
  SELECT id,
    CASE instr(substr(url, 9), '#')
      WHEN 0 THEN substr(url, 9)
      ELSE substr(url, 9, instr(substr(url, 9), '#') - 1)
    END AS rest
  FROM related_links
),
halves AS (
  SELECT id, substr(rest, 1, instr(rest, '/') - 1) AS authority FROM bare
),
-- Where the port starts in the authority (an IPv6 host holds colons).
colon AS (
  SELECT id, authority,
    CASE
      WHEN substr(authority, 1, 1) = '[' THEN
        CASE instr(authority, ']:') WHEN 0 THEN 0 ELSE instr(authority, ']:') + 1 END
      ELSE instr(authority, ':')
    END AS at
  FROM halves
),
split AS (
  SELECT id,
    lower(CASE at WHEN 0 THEN authority ELSE substr(authority, 1, at - 1) END) AS host
  FROM colon
),
hosts AS MATERIALIZED (
  SELECT id,
    CASE WHEN substr(host, -1) = '.' THEN substr(host, 1, length(host) - 1) ELSE host END AS host
  FROM split
)
UPDATE related_links SET link_host = (SELECT host FROM hosts WHERE hosts.id = related_links.id);

CREATE INDEX related_links_gather_key ON related_links (gather_key);
CREATE INDEX related_links_link_host ON related_links (link_host);
