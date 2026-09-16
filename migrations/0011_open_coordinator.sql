-- Hands the coordinator's powers to everyone signed in.
--
-- This is a real grant, not a display setting: with it on, anyone Access lets
-- through can rewrite any board, call full time on a match that is not theirs
-- and switch the round for every screen in the hall. It exists because a team
-- event sometimes needs eight pairs of hands rather than one, and the allowlist
-- is nine people who are all on the same side.
--
-- The one thing it may NOT do is keep itself on. `/api/settings` checks the
-- real role from `coach_identity`, never the granted one, so a coordinator can
-- always close it again — otherwise the first person to open it would have
-- taken the lock with them.
--
-- Global, in `app_state`, because it is a state of the hall rather than of a
-- person or an event.
ALTER TABLE app_state ADD COLUMN open_coordinator INTEGER NOT NULL DEFAULT 0
  CHECK (open_coordinator IN (0, 1));
