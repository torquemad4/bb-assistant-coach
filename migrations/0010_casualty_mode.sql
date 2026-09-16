-- How casualties read on screen: as removals taken, or as players still on the
-- board.
--
-- Nothing about the stored data changes — `a_injuries` / `b_injuries` remain
-- casualties suffered, which is what Tourplay feeds and what the history means.
-- This is the reading applied on top: players left = squad size − casualties.
-- Storing the reading rather than the derived number is what keeps a Tourplay
-- sync, an old round and a coach's phone all agreeing.
--
-- In `app_state` rather than on a tournament, because it is how this hall reads
-- its boards tonight, not a property of the event. One row, so every device
-- shows the same thing: two screens disagreeing about whether "9" is nine
-- casualties or nine players standing is exactly the confusion to avoid.
ALTER TABLE app_state ADD COLUMN casualty_mode TEXT NOT NULL DEFAULT 'removals'
  CHECK (casualty_mode IN ('removals', 'players'));
