/**
 * Race-versus-race win rates under Eurobowl rules.
 *
 * Source: the BBTV Eurobowl stats site, https://bbtv.akorus.de/eurobowl-stats.
 * It aggregates NAF's Eurobowl-tagged tournaments — which is the thing the NAF's
 * own data cannot give us, since every tournament in the NAF dump carries the
 * same `naf_rulesetid` and nothing marks the Eurobowl ruleset.
 *
 * It is a Plotly Dash app with no documented API, so this reads the callback its
 * own page calls. That makes it the most fragile dependency in the app, and it
 * is treated accordingly:
 *
 *   - ONE request fetches all 961 matchups, never one per board
 *   - the result is cached in D1 and only re-fetched when stale
 *   - any failure falls back to the cached copy, then to a snapshot bundled
 *     with the app, and only then to nothing
 *
 * Nothing about scouting depends on it being up. As of 14 Sep 2026 it cannot
 * be reached from a Worker at all: BBTV does not serve its TLS intermediate,
 * and Cloudflare rejects the chain with HTTP 526 rather than chasing it the way
 * a browser does. So the bundled snapshot is not a fallback in practice, it is
 * the live path — until whoever runs the site installs the full chain.
 */

const BBTV_URL = 'https://bbtv.akorus.de/_dash-update-component'

/** How long a fetched matrix is good for. It moves only as tournaments are added. */
export const MATCHUP_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

/**
 * Which sources to aggregate. The site offers NAF plus three FumBBL leagues;
 * only `naf` is tabletop Eurobowl-tagged play, which is what a tabletop event
 * should be read against.
 */
const SOURCES = ['naf']

/** The site's own default period bounds, passed through unchanged. */
const PERIOD = [202604, 202612]

/** BBTV's spelling on the left, ours on the right. */
const RACE_FROM_BBTV: Record<string, string> = {
  'Elf Union': 'Elven Union',
}

function ourRace(name: string): string {
  return RACE_FROM_BBTV[name] ?? name
}

interface BbtvRow {
  race: string
  opponent: string
  games: number
  wins: number
  draws: number
  losses: number
  win_rate: string
  no_loss_rate: string
}

export interface MatchupRecord {
  w: number
  d: number
  l: number
  winRate: number | null
}

export interface MatchupEntry {
  homeRace: string
  awayRace: string
  winRate: number | null
  record: MatchupRecord | null
  games: number | null
}

/** The whole matrix, keyed "Home|Away". */
export type MatchupTable = Record<string, MatchupEntry>

export interface MatchupPayload {
  source: string
  fetchedAt: string
  table: MatchupTable
}

/**
 * The bundled snapshot's shape: races named once, matchups as index tuples.
 * 961 rows of objects is 136 KB and this is 22, which matters when it ships
 * with the app. Written by `scripts/fetch-eb-matchups.mjs`.
 */
interface SnapshotDoc {
  source: string
  sourceUrl?: string
  capturedAt: string
  races: string[]
  /** [homeRaceIndex, awayRaceIndex, wins, draws, losses, games, winRate] */
  rows: [number, number, number, number, number, number, number | null][]
}

/** Expands the bundled snapshot into the same table a live fetch produces. */
export function tableFromSnapshot(doc: unknown): MatchupPayload | null {
  const d = doc as SnapshotDoc
  if (!d || !Array.isArray(d.races) || !Array.isArray(d.rows)) return null

  const table: MatchupTable = {}
  for (const [ai, bi, w, dr, l, games, winRate] of d.rows) {
    const homeRace = d.races[ai]
    const awayRace = d.races[bi]
    if (!homeRace || !awayRace) continue
    table[matchupKey(homeRace, awayRace)] = {
      homeRace,
      awayRace,
      winRate: winRate ?? null,
      record: { w, d: dr, l, winRate: winRate ?? null },
      games,
    }
  }
  if (Object.keys(table).length === 0) return null

  return {
    source: `${d.source} (snapshot, ${d.capturedAt})`,
    fetchedAt: d.capturedAt,
    table,
  }
}

/** "54.0%" as 54. Null when the site sends something unexpected. */
function asRate(value: unknown): number | null {
  if (typeof value !== 'string') return null
  const n = Number.parseFloat(value.replace('%', ''))
  return Number.isFinite(n) ? n : null
}

export function matchupKey(homeRace: string, awayRace: string): string {
  return `${homeRace}|${awayRace}`
}

/**
 * Pulls the whole matrix in one request.
 *
 * The body mirrors what the page's own Table view sends: this is the callback
 * behind the "Table" mode of the Eurobowl matchup heatmap.
 */
export async function fetchMatchups(): Promise<MatchupPayload> {
  const body = JSON.stringify({
    output: 'eb-matchup-heatmap.children',
    outputs: { id: 'eb-matchup-heatmap', property: 'children' },
    inputs: [
      { id: 'eb-source-filter', property: 'value', value: SOURCES },
      { id: 'eb-year-filter', property: 'data', value: PERIOD },
      { id: 'eb-heatmap-mode', property: 'value', value: 'table' },
    ],
    changedPropIds: ['eb-heatmap-mode.value'],
  })

  const ask = () =>
    fetch(BBTV_URL, {
      method: 'POST',
      signal: AbortSignal.timeout(45_000),
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        // Say who is calling. Someone reading their logs should be able to tell
        // what this is and who to shout at.
        'user-agent': 'EnglandBB-Coordinator/1.0 (+https://coordinator.englandbb.co.uk)',
      },
      body,
    })

  // The site 503s intermittently — a cold start, most likely. One retry, never
  // a loop: a flaky community site should not be hammered by a tablet.
  let response = await ask()
  if (response.status >= 500) response = await ask()
  if (!response.ok) throw new Error(`BBTV returned ${response.status}`)

  const payload = (await response.json()) as any
  const rows = payload?.response?.['eb-matchup-heatmap']?.children?.props?.data
  if (!Array.isArray(rows)) throw new Error('BBTV sent no matchup rows — its page has probably changed')

  const table: MatchupTable = {}
  for (const row of rows as BbtvRow[]) {
    if (typeof row?.race !== 'string' || typeof row?.opponent !== 'string') continue
    const homeRace = ourRace(row.race)
    const awayRace = ourRace(row.opponent)
    table[matchupKey(homeRace, awayRace)] = {
      homeRace,
      awayRace,
      winRate: asRate(row.win_rate),
      record: { w: row.wins, d: row.draws, l: row.losses, winRate: asRate(row.win_rate) },
      games: typeof row.games === 'number' ? row.games : null,
    }
  }
  if (Object.keys(table).length === 0) throw new Error('BBTV sent rows in a shape this does not understand')

  return {
    source: 'BBTV — NAF Eurobowl-tagged tournaments',
    fetchedAt: new Date().toISOString(),
    table,
  }
}
