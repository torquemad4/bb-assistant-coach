-- Each tournament becomes its own object, holding its own rounds, and each
-- round its own boards. Previously there was a single round with a single set
-- of boards, so importing a new fixture destroyed the old one.

CREATE TABLE tournament (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  name              TEXT    NOT NULL,
  tourplay_slug     TEXT,
  tourplay_phase_id INTEGER,
  sync_enabled      INTEGER NOT NULL DEFAULT 0 CHECK (sync_enabled IN (0, 1)),
  last_synced_at    TEXT,
  total_rounds      INTEGER NOT NULL DEFAULT 6,
  -- Empty string means "no flag", used for imported rounds that are not a
  -- two-nation fixture.
  team_a_name       TEXT    NOT NULL DEFAULT 'Home',
  team_a_country    TEXT    NOT NULL DEFAULT '',
  team_b_name       TEXT    NOT NULL DEFAULT 'Away',
  team_b_country    TEXT    NOT NULL DEFAULT '',
  created_at        TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE round_v2 (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  tournament_id INTEGER NOT NULL REFERENCES tournament(id) ON DELETE CASCADE,
  round_number  INTEGER NOT NULL,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (tournament_id, round_number)
);

CREATE TABLE board_v2 (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  round_id          INTEGER NOT NULL REFERENCES round_v2(id) ON DELETE CASCADE,
  board_no          INTEGER NOT NULL,
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
  outlook           REAL    NOT NULL DEFAULT 0
                    CHECK (outlook IN (-1, -0.5, 0, 0.5, 1)),
  tourplay_match_id TEXT,
  UNIQUE (round_id, board_no)
);

-- Which tournament and round every viewer is looking at. Selection is shared,
-- not per-device: the coordinator switches and the watching tablets follow.
CREATE TABLE app_state (
  id                    INTEGER PRIMARY KEY CHECK (id = 1),
  active_tournament_id  INTEGER REFERENCES tournament(id),
  active_round_id       INTEGER REFERENCES round_v2(id)
);

-- Carry the existing fixture across as tournament 1, round 1.
INSERT INTO tournament (id, name, tourplay_slug, tourplay_phase_id, sync_enabled,
                        last_synced_at, total_rounds, team_a_name, team_a_country,
                        team_b_name, team_b_country, updated_at)
SELECT 1,
       team_a_name || ' v ' || team_b_name,
       tourplay_slug, tourplay_phase_id, sync_enabled, last_synced_at,
       total_rounds, team_a_name, team_a_country, team_b_name, team_b_country,
       updated_at
FROM round WHERE id = 1;

INSERT INTO round_v2 (id, tournament_id, round_number, updated_at)
SELECT 1, 1, round_number, updated_at FROM round WHERE id = 1;

INSERT INTO board_v2 (round_id, board_no, a_naf_name, a_naf_number, a_race, a_score,
                      a_injuries, a_vacant, b_naf_name, b_naf_number, b_race,
                      b_score, b_injuries, b_vacant, half, outlook, tourplay_match_id)
SELECT 1, board_no, a_naf_name, a_naf_number, a_race, a_score, a_injuries, a_vacant,
       b_naf_name, b_naf_number, b_race, b_score, b_injuries, b_vacant, half,
       outlook, tourplay_match_id
FROM board;

INSERT INTO app_state (id, active_tournament_id, active_round_id) VALUES (1, 1, 1);

DROP TABLE board;
DROP TABLE round;
ALTER TABLE round_v2 RENAME TO round;
ALTER TABLE board_v2 RENAME TO board;
