-- Who each Access login is, at the table.
--
-- Keyed by email because that is what Cloudflare Access verifies, and mapped to
-- a NAF number rather than to a board: boards get re-paired between rounds and
-- can be moved along the row, and a coach should not need remapping every time
-- either happens. The board is found by looking the NAF number up in the round
-- on screen.
--
-- A login with no row here is a watcher: they can see everything and change
-- nothing. That is the safe default, so a new email on the Access allowlist
-- never silently gains write access.
CREATE TABLE coach_identity (
  email        TEXT PRIMARY KEY,
  naf_number   INTEGER,
  display_name TEXT,
  -- The coordinator: may edit every board, tag, link Tourplay and switch rounds.
  is_admin     INTEGER NOT NULL DEFAULT 0 CHECK (is_admin IN (0, 1)),
  added_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Emails are stored lower-case; the Worker lower-cases before comparing.
INSERT INTO coach_identity (email, naf_number, display_name, is_admin) VALUES
  ('csainzmartinez@gmail.com', 31866, 'Torquemada', 1),
  ('greenskinphil@gmail.com',  31674, 'GreenskinPhil', 0),
  ('twilight.hour@gmail.com',  28239, 'Thulean', 0);
