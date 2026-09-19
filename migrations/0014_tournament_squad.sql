-- A squad named outright, rather than inferred from who has a login.
--
-- "Ours" has so far been derived: anyone in `coach_identity` with a NAF
-- number. That is right when the app's users and the squad are the same
-- people, which they were at every England-versus-somebody fixture.
--
-- Team England Pathway Pairs is not that. It is an open event, and the squad
-- Karl wants to watch is a group he has picked out of it — Bashto,
-- GreenskinPhil, punchymcragefists, Pipey and Torquemada — who are scattered
-- across five different Tourplay pairs squads and are not a team in the
-- event's own eyes at all. Deriving membership from logins gets this wrong in
-- both directions: punchymcragefists has no login and belongs in it, and any
-- coach who signs in is dragged into it whether Karl means them or not.
--
-- So a tournament may name its squad. Where it does, that list is the whole
-- answer. Where it does not, nothing changes and membership is derived from
-- the roster exactly as before.
CREATE TABLE tournament_squad (
  tournament_id INTEGER NOT NULL REFERENCES tournament(id) ON DELETE CASCADE,
  -- By NAF number, not by email: it is the identifier the boards already
  -- carry, so a member needs no login, no Access entry and no roster row.
  naf_number    INTEGER NOT NULL,
  -- Shown when the coach is in the squad but has no board this round. The
  -- boards supply the name when they are playing; this covers when they are
  -- not, which is the whole point of naming them.
  display_name  TEXT    NOT NULL,
  PRIMARY KEY (tournament_id, naf_number)
);

INSERT INTO tournament_squad (tournament_id, naf_number, display_name)
SELECT id, 32021, 'Bashto'            FROM tournament WHERE name = 'Team England Pathway Pairs'
UNION ALL
SELECT id, 31674, 'GreenskinPhil'     FROM tournament WHERE name = 'Team England Pathway Pairs'
UNION ALL
SELECT id, 24508, 'punchymcragefists' FROM tournament WHERE name = 'Team England Pathway Pairs'
UNION ALL
SELECT id,  5290, 'Pipey'             FROM tournament WHERE name = 'Team England Pathway Pairs'
UNION ALL
SELECT id, 31866, 'Torquemada'        FROM tournament WHERE name = 'Team England Pathway Pairs';
