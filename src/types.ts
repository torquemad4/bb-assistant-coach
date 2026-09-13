/**
 * Domain model for a round of team Blood Bowl.
 *
 * Everything a live feed would own (score, casualties, half) is a plain value on
 * `Side` / `Board`, so a Tourplay adapter can later replace the seed fixture in
 * `src/data/round.ts` without any component changing shape. See `FeedFields`
 * below for the exact split between fed and locally-owned state.
 */

/** Which half the board is currently playing. */
export type Half = 1 | 2

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

/** A national team in this fixture. */
export interface Team {
  name: string
  country: CountryCode
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
  /** Current half. Fed by Tourplay. */
  half: Half
  /** Assistant coach's read on the match. Always locally owned, never fed. */
  outlook: Outlook
}

/** A whole round: two teams, up to eight boards. */
export interface Round {
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
 * Fields a live Tourplay feed is expected to own once wired up. Everything else
 * — notably `outlook` — stays local to this app.
 */
export const FEED_FIELDS = ['score', 'injuries', 'half'] as const
export type FeedField = (typeof FEED_FIELDS)[number]
