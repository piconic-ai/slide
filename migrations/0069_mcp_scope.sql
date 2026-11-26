-- Migration number: 0069 	 2026-11-26T12:00:00.000Z
-- What an agent's connection may do, as space-separated scope words
-- (docs/dev/f35-agent-export.md). A grant holds the scope the consent screen
-- showed when it was allowed. A code carries it from the allow to the token
-- request, so a code allowed before this version and exchanged after it
-- cannot grow into a grant that reads data out. Every row that exists now
-- was made before the export tools, so it takes the one scope those
-- connections had. The authorization server writes both words for each new
-- connection, and the tools that read data out refuse a grant without the
-- second word until its author connects the agent again.
ALTER TABLE mcp_codes ADD COLUMN scope TEXT NOT NULL DEFAULT 'slides:upload';
ALTER TABLE mcp_grants ADD COLUMN scope TEXT NOT NULL DEFAULT 'slides:upload';
