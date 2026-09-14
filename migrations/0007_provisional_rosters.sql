-- Whether a tournament's line-up is still provisional: coaches and races that
-- may change before the event.
--
-- Worth a column rather than a convention: placeholder races look exactly like
-- real ones on screen, and scouting computed against them reads as intel when
-- it is fiction. The flag drives a banner wherever the line-up is shown.
ALTER TABLE tournament ADD COLUMN rosters_provisional INTEGER NOT NULL DEFAULT 0
  CHECK (rosters_provisional IN (0, 1));

-- England v Italy is exactly that case today: England's eight are confirmed,
-- the Italian half is stand-in.
UPDATE tournament SET rosters_provisional = 1 WHERE id = 1;
