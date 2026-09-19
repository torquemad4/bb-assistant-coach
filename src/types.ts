import type { ScoutRound } from './scout'

/**
 * Domain model for a round of team Blood Bowl.
 *
 * Everything a live feed would own (score, casualties, half) is a plain value on
 * `Side` / `Board`, so a Tourplay adapter can later replace the seed fixture in
 * `src/data/round.ts` without any component changing shape. See `FeedFields`
 * below for the exact split between fed and locally-owned state.
 */

/**
 * Where a board is up to: first half, second half, or finished.
 *
 * One field rather than a half plus a separate "finished" flag — the control on
 * screen is one control, and two fields would be two sources of truth for the
 * same question.
 */
export type Period = '1' | '2' | 'FT'

export const PERIODS: readonly Period[] = ['1', '2', 'FT']

/** What the home side did at kick-off. Null until someone says. */
export type Kickoff = 'K' | 'R' | null

/** A finished match, from the home side's point of view. */
export type Result = 'W' | 'D' | 'L'

/**
 * What a board is worth to the round plan, decided before it starts. Each seeds
 * the board's outlook.
 */
export type Tag = 'swing' | 'anchor' | 'bonus'

export const TAGS: readonly Tag[] = ['swing', 'anchor', 'bonus']

export const TAG_OUTLOOK: Record<Tag, Outlook> = { swing: -0.5, anchor: 0, bonus: 0.5 }

export const TAG_LABEL: Record<Tag, string> = { swing: 'Swing', anchor: 'Anchor', bonus: 'Bonus' }

/**
 * A coach's read on how a match is trending, stepped in 0.5 increments and
 * clamped to [-1, +1]. Negative favours team B, positive favours team A.
 */
export type Outlook = -1 | -0.5 | 0 | 0.5 | 1

/** The five legal outlook values, low to high. */
export const OUTLOOK_VALUES: readonly Outlook[] = [-1, -0.5, 0, 0.5, 1]

export const OUTLOOK_STEP = 0.5
export const OUTLOOK_MIN: Outlook = -1
export const OUTLOOK_MAX: Outlook = 1

/** Which of the two teams a side belongs to. */
export type TeamId = 'A' | 'B'

/** Nations currently fielded. Adding one means adding its flag to `Flag.tsx`. */
export type CountryCode = 'england' | 'italy'

/** A team in this fixture. `country` is null when no flag applies. */
export interface Team {
  name: string
  country: CountryCode | null
}

/** One coach's side of a single board. */
export interface Side {
  /** NAF name as registered — the handle shown on the dashboard. */
  nafName: string
  /** NAF membership number. Null until a real NAF/Tourplay lookup fills it in. */
  nafNumber: number | null
  /** Race chosen for this event, one of `RACES`. */
  race: string
  /** Touchdowns scored so far. Fed by Tourplay. */
  score: number
  /** Casualties suffered by this side. Fed by Tourplay. */
  injuries: number
  /**
   * True when the seat is not yet filled. A vacant side renders greyed with no
   * flag and no race, rather than showing a placeholder coach as if real.
   */
  vacant?: boolean
}

/** One live board in the round: two coaches, a score, a half, an outlook. */
export interface Board {
  /** Board number as called in the hall, 1-8. */
  id: number
  /** Tourplay's own match identifier. Null while running on seed data. */
  tourplayMatchId: string | null
  /** The team A coach on this board. */
  a: Side
  /** The team B coach on this board. */
  b: Side
  /** First half, second half, or finished. Fed by Tourplay while playing. */
  period: Period
  /** Whether the home side kicked or received. */
  kickoff: Kickoff
  /** Swing, Anchor or Bonus. Null until the board is tagged. */
  tag: Tag | null
  /** Tagging locks the board's pre-match view; unlocking is a separate act. */
  tagLocked: boolean
  /** Assistant coach's read on the match. Always locally owned, never fed. */
  outlook: Outlook
}

/** A whole round: two teams, up to eight boards. */
/** Link between a round and the Tourplay tournament it is being played at. */
export interface TourplayLink {
  slug: string | null
  phaseId: number | null
  /** When true, match state is pulled from Tourplay and not edited by hand. */
  syncEnabled: boolean
  lastSyncedAt: string | null
}

/** One tournament, as listed in the selector. */
export interface TournamentSummary {
  id: number
  name: string
  slug: string | null
  syncEnabled: boolean
  /** Live now, rather than set up and waiting. */
  isActive: boolean
}

/** One round within a tournament. */
export interface RoundSummary {
  id: number
  roundNumber: number
}

/**
 * How casualties read on screen. See `src/casualties.ts` — the stored number is
 * always casualties suffered either way.
 */
export type CasualtyMode = 'removals' | 'players'

export const CASUALTY_MODES: readonly CasualtyMode[] = ['removals', 'players']

/**
 * What the dashboard is made of.
 *
 * `fixture` — one card per board, the two-nation default: our coach is side A
 * on every board, so a board and our player's game are the same thing.
 *
 * `ours` — one card per coach of OURS, always from their point of view. At an
 * open event our coaches are scattered through other people's squads and can
 * sit on either side, so a board with two of ours on it shows twice, mirrored.
 */
export type DashboardMode = 'fixture' | 'ours'

/** One seat of ours at this round: which board, and which side of it. */
export interface OurSeat {
  boardId: number
  side: 'a' | 'b'
}

/** A squad member with no board this round — named, so they can be shown resting. */
export interface IdleSquadMember {
  nafNumber: number
  name: string
}

/**
 * Which seats on a board wear our flag.
 *
 * At a two-nation fixture that is simply side A: we are side A of every board,
 * so the flag can be a property of the side. An open event breaks that. The
 * draw puts our coaches wherever it likes, and the honest answer is per seat —
 * a board can carry our flag on one side, on both (two of ours drawn together)
 * or on neither, which is most of the hall.
 *
 * Flagging side A regardless is what put an England flag on Warka and CplRabbit
 * at Sheffield while Torquemada and GreenskinPhil, who are actually ours, went
 * unmarked.
 */
export function flagsForBoard(
  round: Pick<Round, 'dashboardMode' | 'ourSeats' | 'teamA' | 'teamB'>,
  boardId: number,
): { a: CountryCode | null; b: CountryCode | null } {
  if (round.dashboardMode !== 'ours') {
    return { a: round.teamA.country, b: round.teamB.country }
  }
  const ours = (side: 'a' | 'b') =>
    round.ourSeats.some((s) => s.boardId === boardId && s.side === side)
      ? round.teamA.country
      : null
  return { a: ours('a'), b: ours('b') }
}

/**
 * Kick-off from the other side's point of view.
 *
 * `kickoff` records what SIDE A did, so for side B it reads the other way: the
 * coach who did not kick received. Exported because two places need it and they
 * must not drift — the mirrored dashboard card, and a coach on side B reporting
 * their own board, where getting it wrong writes the opposite of what they tapped.
 */
export function flipKickoff(kickoff: Kickoff): Kickoff {
  return kickoff === 'K' ? 'R' : kickoff === 'R' ? 'K' : null
}

/**
 * The same board seen from the other end.
 *
 * Outlook is stored from side A's point of view, so it has to invert with the
 * sides — otherwise a mirrored card would show our coach's good position as
 * somebody else's. Everything else is a straight swap.
 */
export function mirrorBoard(board: Board): Board {
  return {
    ...board,
    a: board.b,
    b: board.a,
    kickoff: flipKickoff(board.kickoff),
    outlook: (board.outlook === 0 ? 0 : -board.outlook) as Outlook,
  }
}

export interface Round {
  /** How the casualty numbers read on screen. The tournament's own, not global. */
  casualtyMode: CasualtyMode
  /** Whether the dashboard is built from boards or from our coaches. */
  dashboardMode: DashboardMode
  /** In `ours` mode, one entry per seat of ours. Empty otherwise. */
  ourSeats: OurSeat[]
  /**
   * Squad members sitting this round out. Only ever populated for a tournament
   * that names its squad — a derived squad cannot tell resting from absent.
   */
  idleSquad: IdleSquadMember[]
  /**
   * True when this viewer may not change tournament — a coach whose own
   * tournament is live is held to it.
   */
  tournamentLocked: boolean
  /**
   * True while everyone signed in holds the coordinator's powers. A real grant,
   * not a display setting — see migration 0011.
   */
  openCoordinator: boolean
  /**
   * True while the line-up is a stand-in — coaches or races that may still
   * change. Placeholder races look exactly like real ones on screen, and
   * scouting run against them reads as intel when it is fiction, so the app
   * says so wherever the line-up is shown.
   */
  rostersProvisional: boolean
  /** Scouting for this round, as delivered by NAF Scout. Null until it arrives. */
  scout: ScoutRound | null
  /** Every tournament, for the selector. */
  tournaments: TournamentSummary[]
  activeTournamentId: number
  /** The rounds of the active tournament. */
  rounds: RoundSummary[]
  activeRoundId: number
  /** When the database last accepted a save. Absent when running on the fixture. */
  updatedAt?: string
  tourplay?: TourplayLink
  roundNumber: number
  /** Total rounds in the event, for the "Round 3 of 6" caption. */
  totalRounds: number
  teamA: Team
  teamB: Team
  boards: Board[]
}

/** Hard cap on boards per round, per the event format. */
export const MAX_BOARDS = 8

/**
 * Fields the live Tourplay feed owns while a match is playing. Everything else
 * — notably `outlook` and `kickoff` — is the coordinator's.
 */
export const FEED_FIELDS = ['score', 'injuries', 'period'] as const
export type FeedField = (typeof FEED_FIELDS)[number]

/** The result of a board, from the home side's point of view. */
export function resultOf(board: Pick<Board, 'a' | 'b'>): Result {
  if (board.a.score > board.b.score) return 'W'
  if (board.a.score < board.b.score) return 'L'
  return 'D'
}

/**
 * A finished match is no longer a judgement call, so its outlook is pinned to
 * the result rather than left to the coach.
 */
export function outlookForResult(result: Result): Outlook {
  return result === 'W' ? 1 : result === 'L' ? -1 : 0
}
