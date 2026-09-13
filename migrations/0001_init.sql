-- Round metadata. A single active round for now; the CHECK keeps it that way
-- so a stray insert cannot quietly create a second one.
CREATE TABLE IF NOT EXISTS round (
  id            INTEGER PRIMARY KEY CHECK (id = 1),
  round_number  INTEGER NOT NULL,
  total_rounds  INTEGER NOT NULL,
  team_a_name   TEXT    NOT NULL,
  team_a_country TEXT   NOT NULL,
  team_b_name   TEXT    NOT NULL,
  team_b_country TEXT   NOT NULL,
  updated_at    TEXT    NOT NULL
);

-- One row per board. Both coaches live here rather than in a separate roster
-- table: a round re-pairs the same squads, so the pairing *is* the board.
CREATE TABLE IF NOT EXISTS board (
  board_no          INTEGER PRIMARY KEY,
  a_naf_name        TEXT    NOT NULL,
  a_naf_number      INTEGER,
  a_race            TEXT    NOT NULL,
  a_score           INTEGER NOT NULL DEFAULT 0 CHECK (a_score >= 0),
  a_injuries        INTEGER NOT NULL DEFAULT 0 CHECK (a_injuries >= 0),
  a_vacant          INTEGER NOT NULL DEFAULT 0 CHECK (a_vacant IN (0, 1)),
  b_naf_name        TEXT    NOT NULL,
  b_naf_number      INTEGER,
  b_race            TEXT    NOT NULL,
  b_score           INTEGER NOT NULL DEFAULT 0 CHECK (b_score >= 0),
  b_injuries        INTEGER NOT NULL DEFAULT 0 CHECK (b_injuries >= 0),
  b_vacant          INTEGER NOT NULL DEFAULT 0 CHECK (b_vacant IN (0, 1)),
  half              INTEGER NOT NULL DEFAULT 1 CHECK (half IN (1, 2)),
  -- Stepped in 0.5 increments and clamped; the CHECK is the last line of
  -- defence behind the client clamp and the API validation.
  outlook           REAL    NOT NULL DEFAULT 0
                    CHECK (outlook IN (-1, -0.5, 0, 0.5, 1)),
  tourplay_match_id TEXT
);
