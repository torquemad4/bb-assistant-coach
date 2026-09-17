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
--
-- mefspores is England's technical staff and the intended main coordinator. No
-- NAF number: a coordinator who is not playing has no board, and the app is
-- built to allow that — she sees every tab except My Board.
--
-- Karl (Torquemada) is a COACH. He holds the coordinator role only while the
-- app is being tested; see the demotion note on the Notion page. Both changes
-- go together when the handover happens.
--
-- GreenskinPhil is a coordinator AND a coach. The two are independent: admin
-- decides what he may change, the NAF number decides whether he has a board of
-- his own. He gets My Board and Match Control both.
-- Everyone below with a NAF number and no admin flag is a plain coach: My Board
-- for their own pairing, read-only everywhere else.
INSERT INTO coach_identity (email, naf_number, display_name, is_admin) VALUES
  ('mfsecades@gmail.com',      NULL,  'mefspores', 1),
  ('csainzmartinez@gmail.com', 31866, 'Torquemada', 1),
  ('greenskinphil@gmail.com',  31674, 'GreenskinPhil', 1),
  ('twilight.hour@gmail.com',  28239, 'Thulean', 0),
  ('ukmastersbb@gmail.com',    5290,  'Pipey', 0),
  ('a.ashtonbutt@gmail.com',   32021, 'Bashto', 0),
  ('foged.1510@gmail.com',     10691, 'Kfoged', 0),
  -- EurOpen squad. A coach is matched to a board by NAF number in whichever
  -- round is on screen, so this row is dormant while the Eurobowl is showing
  -- and live when the EurOpen is.
  ('thehexbaron@gmail.com',    32494, 'HexBaron', 0);
