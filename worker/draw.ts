/**
 * Turning a photographed draw into a round.
 *
 * Every draw at this tournament arrives as a photograph of Tourplay on
 * somebody's phone, because Tourplay's bot protection refuses us from every
 * route we have. Until now the only way in was somebody writing SQL, which
 * means the round is not up until that person is awake and at a keyboard.
 *
 * So: paste the fixtures as lines, and let the coach directory supply the NAF
 * numbers. The names on a draw sheet are the hard part — NAF indexes handles,
 * a draw prints whatever the coach registered, and the number is what scouting
 * runs on. Looking one up by hand took four parallel searches and most of an
 * hour on the eve of this tournament.
 */

/** One side of one board, as the paste gave it and as we resolved it. */
export interface DrawSide {
  /** Exactly what was typed, kept so the preview can show it back. */
  typed: string
  /** The directory's spelling once matched — a draw's "thulean" is "Thulean". */
  nafName: string
  nafNumber: number | null
  race: string
  /** How the NUMBER was arrived at. Nothing to do with where the race came from. */
  how: 'exact' | 'prefix' | 'unknown'
  /** True only where a human or an exact handle match stands behind the number. */
  verified: boolean
  /** True when the race was not typed and the directory supplied it. */
  raceAssumed: boolean
}

export interface DrawBoard {
  boardNo: number
  a: DrawSide
  b: DrawSide
}

export interface ParsedDraw {
  boards: DrawBoard[]
  /** Lines that did not look like a fixture, echoed so nothing vanishes silently. */
  skipped: string[]
}

interface DirectoryRow {
  display_name: string
  naf_number: number | null
  naf_verified: number
  team: string | null
  source: string
  /** What a draw sheet prints for this coach, when that differs from the handle. */
  alias: string | null
}

/**
 * Which of several rows for one name to believe.
 *
 * The same coach is deliberately stored more than once — the handle NAF lists
 * them under, and the spelling a draw sheet actually prints. Both are right,
 * but the one a human typed wins, because it is the one the hall will read on
 * the board. Without this the dashboard shows "greenskinphil" and "torquemada"
 * in NAF's lower case rather than as their coaches write them.
 */
function bestRow(rows: DirectoryRow[]): DirectoryRow {
  const rank = (r: DirectoryRow) =>
    (r.source === 'draw-entry' || r.source === 'board-entry' ? 0 : 2) + (r.naf_verified ? 0 : 1)
  return [...rows].sort((a, b) => rank(a) - rank(b))[0]
}

/**
 * Splits "Geggster (Necromantic Horror)" into the two halves. The race is
 * optional: at an event nobody is typing eight races onto a phone, and the
 * directory already knows what each coach registered.
 */
function splitNameAndRace(raw: string): { name: string; race: string } {
  const m = raw.match(/^(.*?)\s*[([]([^)\]]+)[)\]]\s*$/)
  if (m) return { name: m[1].trim(), race: m[2].trim() }
  return { name: raw.trim(), race: '' }
}

/**
 * A fixture line. Accepts "A vs B", "A v B", "A — B" and a leading table or
 * board number ("Table 10-5", "5.", "5)"), because those are what people
 * actually copy off a screen. The separator has to be surrounded by
 * whitespace or it would cut "Da_Great_MC" in half at its own letters.
 */
const FIXTURE = /^\s*(?:(?:table|board|tbl)?\s*[\d-]+[.):]?\s+)?(.+?)\s+(?:vs?|versus|[-–—])\s+(.+?)\s*$/i

function normalise(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim()
}

/**
 * Resolves one typed name against the directory.
 *
 * Exact match on the whole string first, then a unique prefix. A prefix that
 * matches two coaches is NOT a match: guessing between them is how a stranger's
 * record ends up on our dashboard, and it has already happened twice in this
 * project's history. Unresolved is a fine answer — the preview says so and the
 * coordinator fills it in.
 */
function resolveSide(typed: string, index: Map<string, DirectoryRow[]>, rows: DirectoryRow[]): DrawSide {
  const { name, race } = splitNameAndRace(typed)
  const key = normalise(name)
  const blank: DrawSide = {
    typed: name,
    nafName: name,
    nafNumber: null,
    race,
    how: 'unknown',
    verified: false,
    raceAssumed: false,
  }
  if (!key) return blank

  const found = (row: DirectoryRow, how: 'exact' | 'prefix'): DrawSide => ({
    typed: name,
    nafName: row.display_name,
    nafNumber: row.naf_number,
    race: race || row.team || '',
    how,
    // A prefix is never verified however good the row behind it looks: the
    // coordinator confirms it before scouting runs, because a wrong number
    // does not fail, it resolves to a real stranger.
    verified: how === 'exact' && row.naf_verified === 1,
    raceAssumed: !race && !!row.team,
  })

  const exact = index.get(key)
  if (exact && exact.length > 0) return found(bestRow(exact), 'exact')

  const prefixed = rows.filter(
    (r) =>
      normalise(r.display_name).startsWith(key) ||
      (!!r.alias && normalise(r.alias).startsWith(key)),
  )
  if (prefixed.length > 0 && new Set(prefixed.map((r) => r.naf_number)).size === 1) {
    return found(bestRow(prefixed), 'prefix')
  }

  return blank
}

/**
 * Parses a pasted draw and resolves every name it finds.
 *
 * Board numbers come from position, not from the table numbers on the sheet:
 * Tourplay numbers tables per hall ("Table 10-5"), and this app numbers boards
 * within the fixture. Taking 10 from "10-5" would give eight boards all called
 * ten. The order of the lines is the order of the boards.
 */
export async function parseDraw(db: D1Database, text: string): Promise<ParsedDraw> {
  const all = await db
    .prepare(
      'SELECT display_name, naf_number, naf_verified, team, source, alias FROM coach_directory',
    )
    .all<DirectoryRow>()
  const rows = all.results ?? []

  // A row is reachable by its handle AND by whatever a draw sheet prints for
  // it, so "Peter Woodroffe" and "PeteW" both land on the same coach while the
  // board stays labelled with the handle his team knows.
  const index = new Map<string, DirectoryRow[]>()
  const add = (name: string | null, row: DirectoryRow) => {
    const k = normalise(name ?? '')
    if (!k) return
    const bucket = index.get(k)
    if (bucket) bucket.push(row)
    else index.set(k, [row])
  }
  for (const r of rows) {
    add(r.display_name, r)
    if (r.alias) add(r.alias, r)
  }

  const boards: DrawBoard[] = []
  const skipped: string[] = []

  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue
    const m = line.match(FIXTURE)
    if (!m) {
      skipped.push(line.trim())
      continue
    }
    boards.push({
      boardNo: boards.length + 1,
      a: resolveSide(m[1], index, rows),
      b: resolveSide(m[2], index, rows),
    })
  }

  return { boards, skipped }
}
