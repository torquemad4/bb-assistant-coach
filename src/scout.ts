/**
 * THE NAF SCOUT CONTRACT
 * ======================
 *
 * This file is the agreement between the coordinator app and NAF Scout. Scout
 * pre-crunches NAF data and delivers one `ScoutRound` per round; the pre-match
 * view renders it and computes nothing.
 *
 * It arrives one of two ways:
 *
 *   PULL (normal)  `POST /api/scout/refresh` has the Worker call the NAF Scout
 *                  engine itself and store the result. See `worker/scout.ts`
 *                  for the mapping. Nothing has to be delivered by hand.
 *   PUSH (manual)  `PUT /api/scout` (body: ScoutRound) writes a round's
 *                  scouting directly — an override for when the engine cannot
 *                  answer, or for figures it does not yet serve.
 *
 * Every statistic is optional. A missing figure renders as "—" rather than a
 * zero: at a tournament, "no data" and "played none, won none" must not look
 * alike.
 *
 * THE ENGINE: a FastAPI service over the official NAF database dump, hosted at
 * bb-county-app-euebajf9c8bnfqb0.ukwest-01.azurewebsites.net and shared with the
 * England BB site. (The short `bb-county-app.azurewebsites.net` in that repo's
 * DEPLOY_AZURE.md does not resolve.)
 * Source in `torquemad4/bb-county-tool`; its own docs at `{base}/docs`. It also
 * powers the county tool, so it is not this app's to break.
 *
 * Two figures it has no endpoint for yet, both left empty rather than faked:
 *   `form`     no last-N-games endpoint, though the engine holds the per-game
 *              frame that would back one
 *   `matchup`  its matchup grid is one coach's races, not the global race
 *              matrix this needs
 *
 * Where the underlying NAF data lives, for reference:
 *   coachpage  index.php?module=NAF&type=coachpage&coach={naf}
 *              per-race table: rating, matches, record, win%, TD diff
 *   gamelist   index.php?module=NAF&type=gamelist&coach={naf}[&race={race}]
 *              every ranked game: date, tournament, variant, both coaches,
 *              both races, score, result
 *   racematrix index.php?module=NAF&type=racematrix
 *   head2head  index.php?module=NAF&type=head2head
 *
 * WHAT "vs 200+" MEANS: the engine counts an opponent as established by their
 * PEAK career Regular ELO, not their rating on the day — NAF's gamelist does not
 * carry a historic rating, so "has at some point been a 200+ coach" is the
 * question actually being answered. Whatever fills this contract says how it did
 * it in `vs200Basis`, which the view shows, so the number is never read as more
 * precise than it is.
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
  /**
   * Date of the NAF dump the figures were drawn from. The NAF publishes once a
   * day, so this answers "is this today's data?" — a different question from
   * when the pull ran, and the one that matters the morning of a tournament.
   */
  dataDate?: string | null
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
