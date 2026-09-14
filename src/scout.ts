/**
 * THE NAF SCOUT CONTRACT
 * ======================
 *
 * This file is the agreement between the coordinator app and NAF Scout. Scout
 * pre-crunches NAF data and delivers one `ScoutRound` per round; the pre-match
 * view renders it and computes nothing.
 *
 * Deliver it with `PUT /api/scout` (body: ScoutRound) against the active round,
 * or write it into the `scout` table keyed by round id.
 *
 * Every statistic is optional. A missing figure renders as "—" rather than a
 * zero: at a tournament, "no data" and "played none, won none" must not look
 * alike.
 *
 * Where the underlying NAF data lives, for Scout's reference:
 *   coachpage  index.php?module=NAF&type=coachpage&coach={naf}
 *              per-race table: rating, matches, record, win%, TD diff
 *   gamelist   index.php?module=NAF&type=gamelist&coach={naf}[&race={race}]
 *              every ranked game: date, tournament, variant, both coaches,
 *              both races, score, result
 *   racematrix index.php?module=NAF&type=racematrix
 *   head2head  index.php?module=NAF&type=head2head
 *
 * KNOWN GAP: gamelist does not carry the opponent's NAF rating *at the time of
 * the game*, so the "vs 200+" figures cannot be derived exactly from it. Scout
 * decides how to approximate (e.g. the opponent's current rating in that race)
 * and says so in `vs200Basis`, which the view shows on hover so the number is
 * never read as more precise than it is.
 */

/** A win/draw/loss record. `winRate` is a percentage, 0–100, draws counting as half. */
export interface ScoutRecord {
  w: number
  d: number
  l: number
  /** 0–100. Null when there are no games to derive it from. */
  winRate: number | null
}

/** One game in a coach's recent form, most recent first. */
export interface ScoutFormGame {
  result: 'W' | 'D' | 'L'
  /** ISO date, e.g. "2026-09-12". */
  date: string
  opponent: string
  opponentRace: string
  scoreFor: number
  scoreAgainst: number
  tournament?: string
}

/**
 * One coach's scouting, computed **for this specific board** — several figures
 * depend on the opponent's race, so this cannot be cached per coach alone.
 */
export interface ScoutCoach {
  nafNumber: number | null
  /** The coach's NAF rating with the race they are playing here. */
  ratingWithRace: number | null
  /**
   * Their best rating across all races, and which race that is.
   * Invariant: `ratingMax >= ratingWithRace`. The view renders whatever it is
   * given, so a max below the with-race figure will simply look wrong.
   */
  ratingMax: number | null
  ratingMaxRace: string | null
  /** Overall record with this race. */
  withRace: ScoutRecord | null
  /** With this race, against opponents rated 200+. */
  withRaceVs200: ScoutRecord | null
  /** With this race, against the opponent's race. */
  vsOppRace: ScoutRecord | null
  /** With this race, against the opponent's race, opponents rated 200+. */
  vsOppRaceVs200: ScoutRecord | null
  /** Most recent first. Ten or so is plenty for the form strip. */
  form: ScoutFormGame[]
}

/** The racial matchup itself, independent of who is playing it. */
export interface ScoutMatchup {
  homeRace: string
  awayRace: string
  /**
   * Overall win rate for homeRace against awayRace under Euro rules, from the
   * HOME (team A / England) side's point of view. 0–100.
   */
  winRate: number | null
  record: ScoutRecord | null
  /** How many games that rate is drawn from, so a small sample can be shown as one. */
  games: number | null
}

export interface ScoutBoard {
  /** Matches `Board.id` — the board number, 1-8. */
  boardId: number
  a: ScoutCoach | null
  b: ScoutCoach | null
  matchup: ScoutMatchup | null
}

export interface ScoutRound {
  /** ISO timestamp of when Scout produced this. Shown so stale data is visible. */
  generatedAt: string
  /** How "vs 200+" was approximated. Shown on hover. */
  vs200Basis?: string
  boards: ScoutBoard[]
}

/** Formats a record as "12/3/5" — wins, draws, losses. */
export function recordLabel(record: ScoutRecord | null | undefined): string {
  if (!record) return '—'
  return `${record.w}/${record.d}/${record.l}`
}

/** Formats a win rate as "68.6%", or an em dash when there is nothing to show. */
export function rateLabel(rate: number | null | undefined): string {
  return rate == null ? '—' : `${rate.toFixed(1)}%`
}

/** Total games behind a record, used to mark small samples. */
export function gameCount(record: ScoutRecord | null | undefined): number {
  return record ? record.w + record.d + record.l : 0
}
