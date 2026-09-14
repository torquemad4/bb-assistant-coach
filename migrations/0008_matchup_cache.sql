-- Race-versus-race win rates under Eurobowl rules, cached whole.
--
-- One row, because the matrix is global: it depends on the two races and
-- nothing about this tournament. Cached rather than fetched per pull because
-- the source is a community site with no API contract, and scouting must not
-- fail when it is down. See worker/matchups.ts.
CREATE TABLE matchup_cache (
  id         INTEGER PRIMARY KEY CHECK (id = 1),
  payload    TEXT NOT NULL,
  fetched_at TEXT NOT NULL
);
