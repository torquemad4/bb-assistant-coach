-- What a draw sheet calls a coach, next to what we call them.
--
-- The two are often not the same. NAF indexes handles; a Tourplay draw prints
-- whatever the coach registered with, which is frequently their real name.
-- England's board 2 is "PeteW" to us, "Peter Woodroffe" on the sheet; Finland's
-- board 3 is "Brutopatia" to NAF and "Petrus Artimo" on the sheet. Entering a
-- draw has to find them by what is printed, while every screen in the hall
-- should go on showing the handle their team knows them by.
--
-- One nullable column rather than a second table: an alias has no life of its
-- own, it is a second way in to a row that already exists. Rows keyed
-- 'alias:<printed name>' carry the printed name here and the handle in
-- display_name, so a lookup matches on either and the board is labelled with
-- the handle.

ALTER TABLE coach_directory ADD COLUMN alias TEXT;

CREATE INDEX IF NOT EXISTS idx_coach_directory_alias ON coach_directory (alias);

UPDATE coach_directory SET alias = 'Peter Woodroffe' WHERE player_id = 'alias:peter woodroffe';
UPDATE coach_directory SET alias = 'KFoged (Kaare)'  WHERE player_id = 'alias:kfoged (kaare)';
UPDATE coach_directory SET alias = 'Petrus Artimo'   WHERE player_id = 'alias:petrus artimo';
