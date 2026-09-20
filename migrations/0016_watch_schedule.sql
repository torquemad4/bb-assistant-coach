-- The app follows a tournament by itself.
--
-- Until now a round arrived because somebody pressed Link, or because I wrote
-- it in by hand when Link broke. Both need a person watching Tourplay, and at
-- Sheffield that person was Karl, mid-event, asking me every time.
--
-- So a tournament can carry a watch window, and a cron trigger on the Worker
-- polls Tourplay while that window is open: every minute when it is waiting
-- for a draw, every five while a round is being played, and it stops itself
-- once the last round Karl cares about is finished.
--
-- Nothing here is BBalls-specific. A tournament with no `watch_from` is simply
-- not watched, which is every event so far.

-- When to start polling. NULL means never, and the handler clears it when the
-- watch finishes, so an event cannot leave the cron running for ever.
ALTER TABLE tournament ADD COLUMN watch_from TEXT;

-- The last round worth following. Once Tourplay reports it complete the watch
-- is over — most events have rounds after the ones a squad is still in, and a
-- watch with no end is a poll that runs until someone notices it.
ALTER TABLE tournament ADD COLUMN watch_until_round INTEGER;

-- Paces the poll. The cron fires every minute; this is how a handler that
-- remembers nothing between firings knows whether five minutes have passed.
ALTER TABLE tournament ADD COLUMN last_watched_at TEXT;
