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

export interface Round {
  /** How the casualty numbers read on screen, for every device in the hall. */
  casualtyMode: CasualtyMode
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
