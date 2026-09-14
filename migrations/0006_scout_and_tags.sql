-- Pre-match tagging. A board is a Swing, an Anchor or a Bonus, and the choice
-- seeds its outlook: -0.5, 0, +0.5. Tagging locks the board's pre-match view;
-- unlocking is deliberate and separate, so a tag is never changed by accident.
ALTER TABLE board ADD COLUMN tag TEXT
  CHECK (tag IS NULL OR tag IN ('swing', 'anchor', 'bonus'));
ALTER TABLE board ADD COLUMN tag_locked INTEGER NOT NULL DEFAULT 0
  CHECK (tag_locked IN (0, 1));

-- Scouting delivered by NAF Scout, one blob per round. Stored as JSON rather
-- than shredded into columns: the app only ever renders it whole, and the shape
-- is Scout's to evolve. See src/scout.ts for the contract.
CREATE TABLE scout (
  round_id     INTEGER PRIMARY KEY REFERENCES round(id) ON DELETE CASCADE,
  payload      TEXT NOT NULL,
  generated_at TEXT,
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
