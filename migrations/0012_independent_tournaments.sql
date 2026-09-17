-- Tournaments become independent, and roles become two axes.
--
-- Until now the app had one hall-wide answer to "what is on screen", held in
-- `app_state`. That was right when there was one event. With the Eurobowl and
-- the EurOpen running the same weekend it stops working: switching to one
-- squad's tournament takes the other squad's boards off their own phones.
--
-- So the state that decides what a screen shows moves onto the tournament, and
-- who is looking decides which tournament that is.

-- ---------------------------------------------------------------------------
-- Per-tournament state
-- ---------------------------------------------------------------------------

-- Live now, as opposed to set up and waiting. A coach with an active
-- tournament is locked to it; a coach with none picks from their inactive ones.
ALTER TABLE tournament ADD COLUMN is_active INTEGER NOT NULL DEFAULT 0
  CHECK (is_active IN (0, 1));

-- Which round of THIS tournament is showing. Was `app_state.active_round_id`,
-- one for the whole app; now one each, so moving the Eurobowl to round 3 leaves
-- the EurOpen where it was.
ALTER TABLE tournament ADD COLUMN active_round_id INTEGER REFERENCES round(id);

-- Both settings were global and are now the tournament's own, so one event can
-- count players on pitch while the other counts removals, and opening one up
-- to everyone does not open the other.
ALTER TABLE tournament ADD COLUMN casualty_mode TEXT NOT NULL DEFAULT 'removals'
  CHECK (casualty_mode IN ('removals', 'players'));

ALTER TABLE tournament ADD COLUMN open_coordinator INTEGER NOT NULL DEFAULT 0
  CHECK (open_coordinator IN (0, 1));

-- Carry the old global values onto the tournament that was on screen, and give
-- every tournament its latest round to start from.
UPDATE tournament
   SET casualty_mode = COALESCE((SELECT casualty_mode FROM app_state WHERE id = 1), 'removals'),
       open_coordinator = COALESCE((SELECT open_coordinator FROM app_state WHERE id = 1), 0)
 WHERE id = (SELECT active_tournament_id FROM app_state WHERE id = 1);

UPDATE tournament
   SET active_round_id = (
     SELECT r.id FROM round r WHERE r.tournament_id = tournament.id
      ORDER BY r.round_number DESC LIMIT 1
   );

-- The tournament that was on screen is the one that was live.
UPDATE tournament SET is_active = 1
 WHERE id = (SELECT active_tournament_id FROM app_state WHERE id = 1);

-- ---------------------------------------------------------------------------
-- Roles: two axes, not a ladder
-- ---------------------------------------------------------------------------
--
-- `is_admin` keeps its meaning — may run a round: Match Control, Settings, the
-- selectors. It is left under its own name rather than renamed because eleven
-- call sites read it and a rename buys nothing but risk.
--
-- `is_owner` is new and separate. It owns the app itself: the Admin panel,
-- which assigns everyone else's role and decides which tournaments are live.
--
-- Separate on purpose. The coordinator role is meant to pass to England's
-- technical staff, and if owning the app rode on top of coordinating, handing
-- the role over would hand over the ability to take it back. Karl stays the
-- owner while becoming an ordinary coach.
ALTER TABLE coach_identity ADD COLUMN is_owner INTEGER NOT NULL DEFAULT 0
  CHECK (is_owner IN (0, 1));

UPDATE coach_identity SET is_owner = 1 WHERE email = 'csainzmartinez@gmail.com';
