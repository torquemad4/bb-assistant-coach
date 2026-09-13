import type { Round } from '../types'

/**
 * Round 3 of the England v Italy fixture.
 *
 * England's line-up and races are as given by the coordinator. Italy's coaches
 * are likewise given; their races are the randomly drawn set this prototype
 * started with — eight distinct per team, with overlap between the teams
 * allowed. Necromantic Horror, Black Orc and Elven Union appear on both sides.
 *
 * Board 8 has no England coach yet. It is marked `vacant` rather than filled
 * with an invented name, so the gap is visible on the dashboard instead of
 * looking like a real entry, and its match state is held at kick-off — an
 * unfilled seat cannot be a game in progress.
 *
 * Score, casualties and half are placeholder match states; a Tourplay feed will
 * own them later. `nafNumber` stays null until a real NAF lookup fills it in.
 */
export const SEED_ROUND: Round = {
  roundNumber: 3,
  totalRounds: 6,
  teamA: { name: 'England', country: 'england' },
  teamB: { name: 'Italy', country: 'italy' },
  boards: [
    {
      id: 1,
      tourplayMatchId: null,
      a: { nafName: 'Thulean', nafNumber: null, race: 'Human', score: 1, injuries: 1 },
      b: { nafName: 'Menzogna', nafNumber: null, race: 'Necromantic Horror', score: 2, injuries: 2 },
      half: 1,
      outlook: -0.5,
    },
    {
      id: 2,
      tourplayMatchId: null,
      a: { nafName: 'GreenskinPhil', nafNumber: null, race: 'Slann', score: 0, injuries: 2 },
      b: { nafName: 'Serafino', nafNumber: null, race: 'Black Orc', score: 1, injuries: 0 },
      half: 1,
      outlook: -0.5,
    },
    {
      id: 3,
      tourplayMatchId: null,
      a: { nafName: 'Kfoged', nafNumber: null, race: 'Dark Elf', score: 2, injuries: 0 },
      b: { nafName: 'Barbossa', nafNumber: null, race: 'Norse', score: 0, injuries: 1 },
      half: 2,
      outlook: 1,
    },
    {
      id: 4,
      tourplayMatchId: null,
      a: { nafName: 'Torquemada', nafNumber: null, race: 'Elven Union', score: 0, injuries: 2 },
      b: { nafName: 'Dirold', nafNumber: null, race: 'Khorne', score: 0, injuries: 2 },
      half: 1,
      outlook: 0,
    },
    {
      id: 5,
      tourplayMatchId: null,
      a: { nafName: 'Bashto', nafNumber: null, race: 'High Elf', score: 2, injuries: 0 },
      b: { nafName: 'Liam', nafNumber: null, race: 'Elven Union', score: 1, injuries: 2 },
      half: 2,
      outlook: 0.5,
    },
    {
      id: 6,
      tourplayMatchId: null,
      a: { nafName: 'PeteW', nafNumber: null, race: 'Black Orc', score: 2, injuries: 2 },
      b: { nafName: 'Diomlord', nafNumber: null, race: 'Dwarf', score: 2, injuries: 2 },
      half: 2,
      outlook: 0,
    },
    {
      id: 7,
      tourplayMatchId: null,
      a: { nafName: 'Geggster', nafNumber: null, race: 'Necromantic Horror', score: 2, injuries: 1 },
      b: { nafName: 'Yena', nafNumber: null, race: 'Tomb Kings', score: 0, injuries: 2 },
      half: 1,
      outlook: 0.5,
    },
    {
      id: 8,
      tourplayMatchId: null,
      a: { nafName: 'Coach TBC', nafNumber: null, race: '', score: 0, injuries: 0, vacant: true },
      b: { nafName: 'PanicoBlack', nafNumber: null, race: 'Chaos Chosen', score: 0, injuries: 0 },
      half: 1,
      outlook: 0,
    },
  ],
}
