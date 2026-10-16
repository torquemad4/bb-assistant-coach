-- Two tournaments, and only two.
--
-- Eurobowl XVII is on. Everything in the app that is not Eurobowl or the
-- EurOpen running alongside it is noise on a screen somebody is reading between
-- halves, so it goes. BBalls was last weekend's four-a-side in London; its
-- rounds, boards, scouting reports and squad rows are all that is left of it.
--
-- Deleted bottom-up rather than trusting ON DELETE CASCADE: `scout` and `board`
-- cascade from `round`, but `tournament.active_round_id` and
-- `app_state.active_round_id` are plain references with no cascade, and a
-- dangling pointer there is what makes the app answer nothing and report it as
-- the database being down. So the pointers are moved off the doomed rows first.
--
-- Nothing here names an id. BBalls is identified by name, so this is a no-op on
-- a database that never had it.

UPDATE app_state
   SET active_tournament_id = (SELECT id FROM tournament WHERE name = 'Eurobowl Poland'),
       active_round_id      = (SELECT active_round_id FROM tournament WHERE name = 'Eurobowl Poland')
 WHERE id = 1
   AND active_tournament_id IN (SELECT id FROM tournament WHERE name = 'BBalls');

UPDATE tournament SET active_round_id = NULL WHERE name = 'BBalls';

DELETE FROM scout
 WHERE round_id IN (
   SELECT r.id FROM round r JOIN tournament t ON r.tournament_id = t.id WHERE t.name = 'BBalls'
 );

DELETE FROM board
 WHERE round_id IN (
   SELECT r.id FROM round r JOIN tournament t ON r.tournament_id = t.id WHERE t.name = 'BBalls'
 );

DELETE FROM round
 WHERE tournament_id IN (SELECT id FROM tournament WHERE name = 'BBalls');

DELETE FROM tournament_squad
 WHERE tournament_id IN (SELECT id FROM tournament WHERE name = 'BBalls');

DELETE FROM tournament WHERE name = 'BBalls';
