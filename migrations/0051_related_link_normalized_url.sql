-- Migration number: 0051 	 2026-11-25T15:14:47.122Z
-- The form a related link is compared in, to tell that a slide has it
-- already (F27-AC44, F27-AC48). New links get it from normalizedUrlOf
-- (src/links/normalize.ts). The links kept so far get it here, from the url
-- they keep (the href), by the same rules written in SQL: the common rules,
-- then connpass, Luma, YouTube, ニコニコ動画, Vimeo, Twitch, Loom and Medium.
-- src/db/related-link-normalized-migration.test.ts checks that both give the
-- same form. When the rules change, a migration builds the form again.
-- The column may be NULL so that the Worker before this one, which does not
-- write it, still adds links. Nothing is dropped or rebuilt.
ALTER TABLE related_links ADD COLUMN normalized_url TEXT;

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
-- The authority, and the path with its query.
halves AS (
  SELECT id,
    substr(rest, 1, instr(rest, '/') - 1) AS authority,
    substr(rest, instr(rest, '/')) AS tail
  FROM bare
),
-- Where the port starts in the authority (an IPv6 host holds colons).
colon AS (
  SELECT id, authority, tail,
    CASE
      WHEN substr(authority, 1, 1) = '[' THEN
        CASE instr(authority, ']:') WHEN 0 THEN 0 ELSE instr(authority, ']:') + 1 END
      ELSE instr(authority, ':')
    END AS at
  FROM halves
),
split AS (
  SELECT id,
    CASE at WHEN 0 THEN authority ELSE substr(authority, 1, at - 1) END AS host,
    CASE at WHEN 0 THEN '' ELSE substr(authority, at + 1) END AS port,
    CASE instr(tail, '?') WHEN 0 THEN tail ELSE substr(tail, 1, instr(tail, '?') - 1) END AS path,
    CASE instr(tail, '?') WHEN 0 THEN '' ELSE substr(tail, instr(tail, '?') + 1) END AS query
  FROM colon
),
-- The common rules: one final dot and one leading www. off the host, the
-- trailing slashes off the path.
dotless AS (
  SELECT id, port, query,
    CASE WHEN substr(host, -1) = '.' THEN substr(host, 1, length(host) - 1) ELSE host END AS host,
    CASE rtrim(path, '/') WHEN '' THEN '/' ELSE rtrim(path, '/') END AS path
  FROM split
),
common AS (
  SELECT id, port, query, path,
    CASE WHEN substr(host, 1, 4) = 'www.' THEN substr(host, 5) ELSE host END AS host
  FROM dotless
),
sited AS MATERIALIZED (
  SELECT id, host, port, path, query,
    CASE
      WHEN host = 'connpass.com' OR substr(host, -13) = '.connpass.com' THEN 'connpass'
      WHEN host IN ('lu.ma', 'luma.com') THEN 'luma'
      WHEN host IN ('youtube.com', 'm.youtube.com', 'youtu.be') THEN 'youtube'
      WHEN host IN ('nicovideo.jp', 'sp.nicovideo.jp', 'nico.ms') THEN 'nico'
      WHEN host IN ('vimeo.com', 'player.vimeo.com') THEN 'vimeo'
      WHEN host IN ('twitch.tv', 'm.twitch.tv') THEN 'twitch'
      WHEN host = 'loom.com' THEN 'loom'
      WHEN host = 'medium.com' OR substr(host, -11) = '.medium.com' THEN 'medium'
      ELSE ''
    END AS site
  FROM common
),
-- The query parts as written, split at & through a JSON array.
pieces AS (
  SELECT sited.id, sited.site, part.key AS key, part.value AS value,
    CASE instr(part.value, '=') WHEN 0 THEN part.value
      ELSE substr(part.value, 1, instr(part.value, '=') - 1) END AS name
  FROM sited,
    json_each('["' || replace(replace(replace(sited.query, '\', '\\'), '"', '\"'), '&', '","') || '"]') AS part
  WHERE part.value <> ''
),
-- Without the tracking parts and the parts a site leaves out.
kept AS MATERIALIZED (
  SELECT id, key, value, name FROM pieces
  WHERE substr(name, 1, 4) <> 'utm_'
    AND name NOT IN ('fbclid', 'gclid', 'mc_cid', 'mc_eid', 'msclkid', 'yclid', 'dclid', 'igshid', 'ref_src', '_ga', '_gl')
    AND NOT (site = 'luma' AND name = 'tk')
    AND NOT (site = 'medium' AND name = 'source')
    AND NOT (site = 'youtube' AND name IN ('si', 'feature', 'pp'))
),
-- What the rules of the sites read: the first v and h parts, and the path
-- past its first character and past its seventh.
reads AS (
  SELECT id, host, port, path, site,
    (SELECT substr(value, 3) FROM kept
      WHERE kept.id = sited.id AND substr(value, 1, 2) = 'v=' ORDER BY key LIMIT 1) AS v,
    (SELECT substr(value, 3) FROM kept
      WHERE kept.id = sited.id AND substr(value, 1, 2) = 'h=' ORDER BY key LIMIT 1) AS h,
    substr(path, 2) AS first_tail,
    substr(path, 8) AS seven_tail
  FROM sited
),
-- The segments of the path: the first one, and what follows it.
segments AS (
  SELECT id, host, port, path, site, v, h, first_tail, seven_tail,
    CASE instr(first_tail, '/') WHEN 0 THEN first_tail
      ELSE substr(first_tail, 1, instr(first_tail, '/') - 1) END AS first_segment,
    CASE instr(first_tail, '/') WHEN 0 THEN NULL
      ELSE substr(first_tail, instr(first_tail, '/') + 1) END AS second_tail,
    CASE instr(seven_tail, '/') WHEN 0 THEN seven_tail
      ELSE substr(seven_tail, 1, instr(seven_tail, '/') - 1) END AS event_id
  FROM reads
),
-- The video a YouTube address shows.
youtube AS (
  SELECT *,
    CASE
      WHEN site <> 'youtube' THEN NULL
      WHEN host = 'youtu.be' THEN first_tail
      WHEN substr(path, 1, 8) = '/shorts/' THEN substr(path, 9)
      WHEN substr(path, 1, 6) = '/live/' THEN substr(path, 7)
      WHEN substr(path, 1, 7) = '/embed/' THEN seven_tail
      WHEN path = '/watch' THEN v
    END AS video
  FROM segments
),
-- The id each site's rule names, or NULL when the address is not one.
named AS (
  SELECT id, host, port, path, site, h, seven_tail, first_segment, second_tail,
    CASE WHEN video <> '' AND video NOT GLOB '*[^-A-Za-z0-9_]*' THEN video END AS youtube_id,
    CASE
      WHEN site = 'connpass' AND substr(path, 1, 7) = '/event/'
        AND event_id <> '' AND event_id NOT GLOB '*[^0-9]*' THEN event_id
    END AS connpass_id,
    CASE
      WHEN site = 'nico' AND host = 'nico.ms' AND second_tail IS NULL
        AND substr(first_segment, 1, 2) IN ('sm', 'so', 'nm')
        AND substr(first_segment, 3) <> '' AND substr(first_segment, 3) NOT GLOB '*[^0-9]*'
        THEN first_segment
    END AS nico_ms_id,
    CASE
      WHEN site <> 'vimeo' THEN NULL
      WHEN host = 'player.vimeo.com' THEN
        CASE WHEN substr(path, 1, 7) = '/video/' AND seven_tail <> ''
          AND seven_tail NOT GLOB '*[^0-9]*' THEN seven_tail END
      WHEN first_segment <> '' AND first_segment NOT GLOB '*[^0-9]*'
        AND (second_tail IS NULL OR (second_tail <> '' AND second_tail NOT GLOB '*[^0-9A-Za-z]*'))
        THEN first_segment
    END AS vimeo_id
  FROM youtube
),
-- The host and path each site's rule writes, and the part it puts in place
-- of every part of one name.
paged AS MATERIALIZED (
  SELECT id, port,
    CASE
      WHEN connpass_id IS NOT NULL THEN 'connpass.com'
      WHEN site = 'luma' THEN 'luma.com'
      WHEN youtube_id IS NOT NULL THEN 'youtube.com'
      WHEN site = 'nico' AND named.host <> 'nico.ms' AND substr(path, 1, 7) = '/watch/' THEN 'nicovideo.jp'
      WHEN nico_ms_id IS NOT NULL THEN 'nicovideo.jp'
      WHEN vimeo_id IS NOT NULL THEN 'vimeo.com'
      WHEN site = 'twitch' THEN 'twitch.tv'
      ELSE named.host
    END AS host,
    CASE
      WHEN site = 'luma' THEN lower(path)
      WHEN youtube_id IS NOT NULL THEN '/watch'
      WHEN nico_ms_id IS NOT NULL THEN '/watch/' || nico_ms_id
      WHEN vimeo_id IS NOT NULL THEN '/' || vimeo_id
      WHEN site = 'loom' AND substr(path, 1, 7) = '/embed/' AND seven_tail <> ''
        AND instr(seven_tail, '/') = 0 THEN '/share/' || seven_tail
      ELSE path
    END AS path,
    CASE WHEN youtube_id IS NOT NULL THEN 'v' WHEN vimeo_id IS NOT NULL THEN 'h' END AS replaced,
    CASE
      WHEN youtube_id IS NOT NULL THEN 'v=' || youtube_id
      WHEN vimeo_id IS NOT NULL AND named.host = 'vimeo.com' AND second_tail IS NOT NULL THEN 'h=' || second_tail
      WHEN vimeo_id IS NOT NULL AND h <> '' THEN 'h=' || h
    END AS added
  FROM named
),
-- The parts of the form: the kept ones but those of the replaced name, and
-- the added one.
final_parts AS MATERIALIZED (
  SELECT kept.id, kept.key, kept.value, kept.name FROM kept
  JOIN paged ON paged.id = kept.id
  WHERE paged.replaced IS NULL OR kept.name <> paged.replaced
  UNION ALL
  SELECT id, 1000000000, added, replaced FROM paged WHERE added IS NOT NULL
),
forms AS (
  SELECT paged.id,
    'https://' || paged.host
      || CASE paged.port WHEN '' THEN '' ELSE ':' || paged.port END
      || paged.path
      || coalesce('?' || (
        SELECT group_concat(value, '&' ORDER BY name, key)
        FROM final_parts WHERE final_parts.id = paged.id
      ), '') AS form
  FROM paged
)
UPDATE related_links SET normalized_url = (SELECT form FROM forms WHERE forms.id = related_links.id);
