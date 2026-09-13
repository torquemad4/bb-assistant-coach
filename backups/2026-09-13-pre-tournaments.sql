-- Snapshot of the live round taken 13 Sep 2026, immediately before migration
-- 0004 rebuilt the tables for multiple tournaments. Restores Karl's England v
-- Italy round exactly as it stood, including the outlooks he had set.
--
-- To restore into the post-0004 schema, run against tournament 1 / round 1.

UPDATE tournament SET name = 'England v Italy', team_a_name = 'England',
       team_a_country = 'england', team_b_name = 'Italy', team_b_country = 'italy',
       total_rounds = 6
 WHERE id = 1;

UPDATE round SET round_number = 3 WHERE id = 1;

DELETE FROM board WHERE round_id = 1;

INSERT INTO board (round_id, board_no, a_naf_name, a_race, a_score, a_injuries,
                   b_naf_name, b_race, b_score, b_injuries, half, outlook) VALUES
 (1, 1, 'Thulean',       'Human',              2, 1, 'Menzogna',    'Necromantic Horror', 1, 2, 1,  0.5),
 (1, 2, 'GreenskinPhil', 'Slann',              2, 2, 'Serafino',    'Black Orc',          0, 0, 1,  0.5),
 (1, 3, 'Kfoged',        'Dark Elf',           2, 0, 'Barbossa',    'Norse',              0, 1, 2,  1.0),
 (1, 4, 'Torquemada',    'Elven Union',        0, 2, 'Dirold',      'Khorne',             0, 2, 1,  0.0),
 (1, 5, 'Bashto',        'High Elf',           2, 0, 'Liam',        'Elven Union',        1, 2, 2,  0.5),
 (1, 6, 'PeteW',         'Black Orc',          2, 2, 'Diomlord',    'Dwarf',              2, 2, 2,  0.0),
 (1, 7, 'Geggster',      'Necromantic Horror', 2, 1, 'Yena',        'Tomb Kings',         0, 2, 1,  0.5),
 (1, 8, 'Pipey',         'Lizardmen',          2, 2, 'PanicoBlack', 'Chaos Chosen',       3, 1, 2, -1.0);
