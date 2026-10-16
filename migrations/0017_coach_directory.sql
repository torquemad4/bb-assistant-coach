-- Everyone at the event, by name and NAF number, looked up once.
--
-- A draw arrives as a photograph of Tourplay. Turning the names on it into NAF
-- numbers is what makes scouting work, and on the eve of Eurobowl XVII that
-- took four parallel searches and the better part of an hour for FOUR coaches —
-- because Tourplay shows some people by handle and others by real name, and NAF
-- only indexes handles.
--
-- Tourplay's own entry list has both halves in one call: what it displays, and
-- the NAF number behind it. So pull it once for the whole tournament and keep
-- it. Then a name on a photograph is a lookup, not an investigation.
--
-- Keyed by the Tourplay player id rather than the NAF number, because an
-- entrant may have no number at all and still needs to be in here — knowing
-- that somebody has no usable number is itself worth knowing, and was exactly
-- the thing that made Pipey vanish from the Sheffield dashboard.
CREATE TABLE coach_directory (
  player_id    TEXT PRIMARY KEY,
  -- What Tourplay puts on the fixture list: sometimes a handle, sometimes a
  -- real name. This is the string a draw photograph will show.
  display_name TEXT NOT NULL,
  -- Null when Tourplay has no number for them, or has one it has not verified.
  -- An unverified number is whatever the coach typed and is not trusted here,
  -- for the same reason the import does not trust it.
  naf_number   INTEGER,
  naf_verified INTEGER NOT NULL DEFAULT 0 CHECK (naf_verified IN (0, 1)),
  -- The squad they are entered with — at Eurobowl that is their nation.
  team         TEXT,
  -- Which tournament this came from, so a stale entry can be traced.
  source       TEXT NOT NULL,
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

-- The two ways a draw gets read: by the name on the photograph, and by number.
CREATE INDEX idx_coach_directory_name ON coach_directory (display_name);
CREATE INDEX idx_coach_directory_naf ON coach_directory (naf_number);
