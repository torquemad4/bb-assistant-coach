import type { Round } from '../types'

/**
 * Round 3 of the England v Italy fixture.
 *
 * England's line-up and races are as given by the coordinator. Italy's coaches
 * are likewise given; their races are the randomly drawn set this prototype
 * started with — eight distinct per team, with overlap between the teams
 * allowed. Necromantic Horror, Black Orc and Elven Union appear on both sides.
 *
 * All eight seats are filled on both sides.
 *
 * Score, casualties and half are placeholder match states; a Tourplay feed will
 * own them later. `nafNumber` stays null until a real NAF lookup fills it in.
 */
export const SEED_ROUND: Round = {
  // The committed fixture is a stand-in by definition.
  rostersProvisional: true,
  // The reading the app has always had; the offline fixture cannot know what a
  // coordinator chose.
  casualtyMode: 'removals',
  openCoordinator: false,
  tournamentLocked: true,
  scout: null,
  // The offline fallback is a single unnamed tournament; the selectors have
  // nothing to switch between when the database cannot be reached.
  tournaments: [{ id: 1, name: 'England v Italy', slug: null, syncEnabled: false, isActive: true }],
  activeTournamentId: 1,
  rounds: [{ id: 1, roundNumber: 3 }],
  activeRoundId: 1,
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
      period: '1',
      kickoff: null,
      tag: null,
      tagLocked: false,
      outlook: -0.5,
    },
    {
      id: 2,
      tourplayMatchId: null,
      a: { nafName: 'GreenskinPhil', nafNumber: null, race: 'Slann', score: 0, injuries: 2 },
      b: { nafName: 'Serafino', nafNumber: null, race: 'Black Orc', score: 1, injuries: 0 },
      period: '1',
      kickoff: null,
      tag: null,
      tagLocked: false,
      outlook: -0.5,
    },
    {
      id: 3,
      tourplayMatchId: null,
      a: { nafName: 'Kfoged', nafNumber: null, race: 'Dark Elf', score: 2, injuries: 0 },
      b: { nafName: 'Barbossa', nafNumber: null, race: 'Norse', score: 0, injuries: 1 },
      period: '2',
      kickoff: null,
      tag: null,
      tagLocked: false,
      outlook: 1,
    },
    {
      id: 4,
      tourplayMatchId: null,
      a: { nafName: 'Torquemada', nafNumber: null, race: 'Elven Union', score: 0, injuries: 2 },
      b: { nafName: 'Dirold', nafNumber: null, race: 'Khorne', score: 0, injuries: 2 },
      period: '1',
      kickoff: null,
      tag: null,
      tagLocked: false,
      outlook: 0,
    },
    {
      id: 5,
      tourplayMatchId: null,
      a: { nafName: 'Bashto', nafNumber: null, race: 'High Elf', score: 2, injuries: 0 },
      b: { nafName: 'Liam', nafNumber: null, race: 'Elven Union', score: 1, injuries: 2 },
      period: '2',
      kickoff: null,
      tag: null,
      tagLocked: false,
      outlook: 0.5,
    },
    {
      id: 6,
      tourplayMatchId: null,
      a: { nafName: 'PeteW', nafNumber: null, race: 'Black Orc', score: 2, injuries: 2 },
      b: { nafName: 'Diomlord', nafNumber: null, race: 'Dwarf', score: 2, injuries: 2 },
      period: '2',
      kickoff: null,
      tag: null,
      tagLocked: false,
      outlook: 0,
    },
    {
      id: 7,
      tourplayMatchId: null,
      a: { nafName: 'Geggster', nafNumber: null, race: 'Necromantic Horror', score: 2, injuries: 1 },
      b: { nafName: 'Yena', nafNumber: null, race: 'Tomb Kings', score: 0, injuries: 2 },
      period: '1',
      kickoff: null,
      tag: null,
      tagLocked: false,
      outlook: 0.5,
    },
    {
      id: 8,
      tourplayMatchId: null,
      a: { nafName: 'Pipey', nafNumber: null, race: 'Lizardmen', score: 2, injuries: 2 },
      b: { nafName: 'PanicoBlack', nafNumber: null, race: 'Chaos Chosen', score: 3, injuries: 1 },
      period: '2',
      kickoff: null,
      tag: null,
      tagLocked: false,
      outlook: -1,
    },
  ],
}
