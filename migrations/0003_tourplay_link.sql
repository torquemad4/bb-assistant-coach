-- Links a round to the Tourplay tournament it is being played at, so match
-- state can be pulled instead of tapped in.
ALTER TABLE round ADD COLUMN tourplay_slug TEXT;
ALTER TABLE round ADD COLUMN tourplay_phase_id INTEGER;
-- Off by default: a round is manual until someone deliberately links it.
ALTER TABLE round ADD COLUMN sync_enabled INTEGER NOT NULL DEFAULT 0 CHECK (sync_enabled IN (0, 1));
ALTER TABLE round ADD COLUMN last_synced_at TEXT;
