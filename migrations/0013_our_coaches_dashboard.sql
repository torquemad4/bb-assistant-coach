-- A dashboard of OUR coaches, rather than of a two-nation fixture.
--
-- Every event so far has been England versus somebody: eight boards, our coach
-- always on side A, so "the board" and "our player's game" were the same thing.
-- An open event is not like that. At Team England Pathway Pairs our coaches are
-- scattered across other people's squads, playing whoever the draw gives them,
-- and they can turn up on either side of a board — or on both sides of one,
-- when two of them are drawn against each other.
--
-- So this mode changes the unit the dashboard is made of. Not one card per
-- board: one card per coach of ours, always shown from their point of view. A
-- board with two of ours on it produces two cards, the same match mirrored,
-- because each of them wants to see their own game the right way round.
--
-- Who counts as ours is NOT a list kept here. It is anyone in `coach_identity`
-- with a NAF number — the people who have a login. Karl's call, and the right
-- one: it is the same table that already decides whose board is whose, so it
-- cannot drift, and adding a login is all it takes to add somebody.
ALTER TABLE tournament ADD COLUMN dashboard_mode TEXT NOT NULL DEFAULT 'fixture'
  CHECK (dashboard_mode IN ('fixture', 'ours'));

-- Team England Pathway Pairs is the open event this was built for.
UPDATE tournament SET dashboard_mode = 'ours' WHERE name = 'Team England Pathway Pairs';
