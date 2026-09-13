import type { Round } from '../types'

/**
 * PLACEHOLDER DATA — NOT REAL NAF COACHES.
 *
 * The brief asked for 16 real coaches taken off the NAF website. The cloud
 * environment this was built in runs a "Trusted" egress allowlist, so both
 * thenaf.net and tourplay.net are refused at the proxy and no real records
 * could be read. The 16 handles below are invented in NAF style so the layout
 * can be judged at realistic name lengths; `nafNumber` is deliberately null
 * rather than a made-up number.
 *
 * To swap in real coaches, replace the `nafName` / `nafNumber` / `race` values
 * here and nothing else — this file is the only place they appear. Allowlisting
 * thenaf.net and tourplay.net on the cloud environment is what unblocks
 * reading them automatically.
 *
 * Races were drawn at random: eight distinct per team, with overlap between the
 * teams allowed (Necromantic Horror, Black Orc and Norse appear on both).
 */
export const SEED_ROUND: Round = {
  roundNumber: 3,
  totalRounds: 6,
  teamAName: 'Team A',
  teamBName: 'Team B',
  boards: [
    {
      id: 1,
      tourplayMatchId: null,
      a: { nafName: 'Grimtooth_Jr', nafNumber: null, race: 'Norse', score: 1, injuries: 1 },
      b: { nafName: 'RerollRita', nafNumber: null, race: 'Necromantic Horror', score: 2, injuries: 2 },
      half: 1,
      outlook: -0.5,
    },
    {
      id: 2,
      tourplayMatchId: null,
      a: { nafName: 'NuffleNumpty', nafNumber: null, race: 'Orc', score: 0, injuries: 2 },
      b: { nafName: 'TurnoverTam', nafNumber: null, race: 'Black Orc', score: 1, injuries: 0 },
      half: 1,
      outlook: -0.5,
    },
    {
      id: 3,
      tourplayMatchId: null,
      a: { nafName: 'BoneheadBazza', nafNumber: null, race: 'Black Orc', score: 2, injuries: 0 },
      b: { nafName: 'FoulAppearance', nafNumber: null, race: 'Norse', score: 0, injuries: 1 },
      half: 2,
      outlook: 1,
    },
    {
      id: 4,
      tourplayMatchId: null,
      a: { nafName: 'SixesAndSevens', nafNumber: null, race: 'Imperial Nobility', score: 0, injuries: 2 },
      b: { nafName: 'CasualtyCarl', nafNumber: null, race: 'Khorne', score: 0, injuries: 2 },
      half: 1,
      outlook: 0,
    },
    {
      id: 5,
      tourplayMatchId: null,
      a: { nafName: 'TheRealBlitzer', nafNumber: null, race: 'Wood Elf', score: 2, injuries: 0 },
      b: { nafName: 'ApothecaryAl', nafNumber: null, race: 'Elven Union', score: 1, injuries: 2 },
      half: 2,
      outlook: 0.5,
    },
    {
      id: 6,
      tourplayMatchId: null,
      a: { nafName: 'PitchInvader', nafNumber: null, race: 'Human', score: 2, injuries: 2 },
      b: { nafName: 'GoingForIt', nafNumber: null, race: 'Dwarf', score: 2, injuries: 2 },
      half: 2,
      outlook: 0,
    },
    {
      id: 7,
      tourplayMatchId: null,
      a: { nafName: 'DoubleSkulls', nafNumber: null, race: 'Necromantic Horror', score: 2, injuries: 1 },
      b: { nafName: 'StuntyStuart', nafNumber: null, race: 'Tomb Kings', score: 0, injuries: 2 },
      half: 1,
      outlook: 0.5,
    },
    {
      id: 8,
      tourplayMatchId: null,
      a: { nafName: 'ClawPOMB', nafNumber: null, race: 'Vampire', score: 2, injuries: 2 },
      b: { nafName: 'LineOfScrimmage', nafNumber: null, race: 'Chaos Chosen', score: 3, injuries: 1 },
      half: 2,
      outlook: -1,
    },
  ],
}
