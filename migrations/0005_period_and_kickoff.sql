-- A board is in the first half, the second, or finished. One field rather than
-- a half plus a "finished" flag, because the control on screen is one control
-- and two fields would be two sources of truth for the same question.
ALTER TABLE board ADD COLUMN period TEXT NOT NULL DEFAULT '1'
  CHECK (period IN ('1', '2', 'FT'));

UPDATE board SET period = CAST(half AS TEXT);

ALTER TABLE board DROP COLUMN half;

-- Which the home side did at kick-off. Null until someone says.
ALTER TABLE board ADD COLUMN kickoff TEXT
  CHECK (kickoff IS NULL OR kickoff IN ('K', 'R'));
