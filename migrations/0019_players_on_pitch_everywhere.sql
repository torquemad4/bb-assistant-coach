-- Both events count players on the pitch, not removals.
--
-- The EurOpen was still on 'removals' — the original meaning, and the default a
-- rebuilt database would land on. It is the same weekend, the same coaches
-- walking between halls, and a casualty box that means one thing on one screen
-- and another on the next is a mistake waiting to be entered in a hurry.

UPDATE tournament
   SET casualty_mode = 'players', updated_at = datetime('now')
 WHERE name IN ('Eurobowl Poland', 'Europen Poland')
   AND casualty_mode <> 'players';
