/// <reference types="@cloudflare/workers-types" />

/**
 * Reading live match state out of Tourplay.
 *
 * Verified 13 Sep 2026 against Copa "La Forja" 2026 while it was mid-round.
 * None of this API is documented; the endpoints were read out of Tourplay's
 * JS bundle. See the README for the full set of findings.
 *
 * Two calls make up a refresh:
 *   phases?phaseId=...  — one call, gives every board's score, casualties,
 *                         coaches, races and matchId
 *   match/{matchId}     — one call per board, purely for `turn.half`
 */

const BASE = 'https://tourplay.net'

/** Tourplay 403s a default user-agent; robots.txt is empty, so it wants browser headers. */
function headers(slug: string): Record<string, string> {
  return {
    'user-agent':
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
    accept: 'application/json, text/plain, */*',
    'accept-language': 'en-GB,en;q=0.9',
    origin: BASE,
    referer: `${BASE}/en/blood-bowl/${slug}/news`,
    'sec-fetch-site': 'same-origin',
    'sec-fetch-mode': 'cors',
    'sec-fetch-dest': 'empty',
  }
}

/**
 * Race names where splitting Tourplay's camel case does not land on the name
 * this app uses. Everything else round-trips: `OldWorldAlliance_BB2025` becomes
 * "Old World Alliance" on its own.
 */
const RACE_ALIASES: Record<string, string> = {
  Necromantic: 'Necromantic Horror',
  Undead: 'Shambling Undead',
  Lizardman: 'Lizardmen',
  Underworld: 'Underworld Denizens',
  Nobility: 'Imperial Nobility',
}

export function raceName(teamRace: string | null | undefined): string {
  if (!teamRace) return ''
  const stripped = teamRace.replace(/_BB\d+$/i, '')
  if (RACE_ALIASES[stripped]) return RACE_ALIASES[stripped]
  const split = stripped.replace(/([a-z])([A-Z])/g, '$1 $2').trim()
  return RACE_ALIASES[split] ?? split
}

async function getJson<T>(path: string, slug: string): Promise<T> {
  const response = await fetch(`${BASE}/${path}`, { headers: headers(slug) })
  const text = await response.text()
  if (!response.ok) {
    throw new Error(
      `Tourplay GET /${path} → ${response.status}` +
        (response.status === 401 ? ' (needs a logged-in account)' : ''),
    )
  }
  // A wrong path falls through to Tourplay's web app rather than 404ing.
  if (text.startsWith('<!doctype') || text.startsWith('<html')) {
    throw new Error(`Tourplay GET /${path} returned the web page, not JSON`)
  }
  return JSON.parse(text) as T
}

export interface LiveSide {
  coach: string
  race: string
  teamName: string
  score: number
  injuries: number
  /**
   * Tourplay's own id for the player. The fixtures carry no NAF field at all,
   * so this is the only thing that joins a coach in the draw to their NAF
   * number in the entry list — and joining on an id beats joining on a display
   * name that two people can share.
   */
  playerId: string | null
}

export interface LiveMatch {
  /** Tourplay's board order within the round. */
  order: number
  matchId: number
  round: number
  /** Tourplay match state; 11 is in progress. */
  state: number
  local: LiveSide
  visitor: LiveSide
  /** From the per-match call; null when it could not be read. */
  half: 1 | 2 | null
}

export interface TournamentInfo {
  id: number
  name: string
  slug: string
  country: string | null
  initDate: string | null
  finishDate: string | null
}

/**
 * Confirms the tournament exists and names it. Worth a request on link, so a
 * typo reads as "not found" rather than "no fixtures drawn".
 */
export async function fetchTournament(slug: string): Promise<TournamentInfo> {
  let raw: any
  try {
    raw = await getJson<any>(`api/tournament/${slug}`, slug)
  } catch (cause) {
    throw new Error(`No Tourplay tournament called "${slug}" (${String(cause).replace('Error: ', '')})`)
  }
  return {
    id: raw.id,
    name: raw.name,
    slug: raw.nameNormalized ?? slug,
    country: raw.country ?? null,
    initDate: raw.initDate ?? null,
    finishDate: raw.finishDate ?? null,
  }
}

export interface LiveRound {
  phaseId: number
  currentRound: number
  matches: LiveMatch[]
}

function side(roster: any): LiveSide {
  return {
    coach: roster?.inscription?.player?.userNameToShow ?? '',
    race: raceName(roster?.teamRace),
    teamName: roster?.teamName ?? '',
    score: 0,
    injuries: 0,
    playerId: roster?.inscription?.player?.id ?? null,
  }
}

/**
 * NAF numbers for everyone entered, keyed by Tourplay player id.
 *
 * A separate endpoint from the fixtures, and the only place Tourplay admits to
 * knowing a NAF number. Plenty of entries have none, and those are simply
 * absent from the map rather than guessed at.
 *
 * Only a number Tourplay has VERIFIED is taken. An unverified one is whatever
 * the coach typed, and it is wrong in the way that matters: a real entrant in
 * a live tournament carries `nafNumber: 1, nafVerified: false`, which resolves
 * to the coach NAF calls "#1". An unverified number would rename a coach to a
 * stranger, attach a stranger's scouting to them, and hand them a stranger's
 * board when they sign in. Nothing is worth more than that is worth avoiding.
 *
 * Never throws: an import that cannot read the entry list still has a draw
 * worth importing, it just keeps Tourplay's names.
 */
export async function fetchNafNumbers(slug: string): Promise<Map<string, number>> {
  const byPlayer = new Map<string, number>()
  try {
    const tournament = await getJson<any>(`api/tournament/${slug}`, slug)
    for (const category of tournament?.categories ?? []) {
      const payload = await getJson<any>(
        `api/inscriptions/${slug}/category/${category.id}/inscriptions`,
        slug,
      )
      // Team events nest entries by squad; individual ones return a flat list.
      const inner = payload?.[String(category.id)] ?? {}
      const groups = Array.isArray(inner) ? [inner] : Object.values(inner)
      for (const rows of groups as any[][]) {
        for (const row of rows ?? []) {
          const id = row?.player?.id
          const naf = row?.player?.nafNumber
          if (id && row?.player?.nafVerified === true && typeof naf === 'number' && naf > 0) {
            byPlayer.set(String(id), naf)
          }
        }
      }
    }
  } catch {
    // No entry list, so no NAF numbers. The draw imports without them.
  }
  return byPlayer
}

/**
 * Reads the current round. `withHalf` adds one request per match; skip it when
 * only the score matters, since it multiplies the request count by the number
 * of boards.
 */
export async function fetchLiveRound(slug: string, withHalf = true): Promise<LiveRound> {
  const status = await getJson<Record<string, { lastRound: number }>>(
    `api/tournament/${slug}/phase-status`,
    slug,
  )
  const phaseIds = Object.keys(status)
  if (phaseIds.length === 0) {
    throw new Error('That tournament has no fixtures drawn yet, so there is nothing to import')
  }
  // The last phase is the one being played.
  const phaseId = Number(phaseIds[phaseIds.length - 1])

  const phases = await getJson<any>(`api/tournament/${slug}/phases?phaseId=${phaseId}`, slug)
  const raw: any[] = phases.matches ?? []

  const matches: LiveMatch[] = raw.map((m) => {
    const score = m.scoreResume ?? {}
    const local = side(m.rosterLocal)
    const visitor = side(m.rosterVisitor)
    local.score = score.totalScoreLocal ?? 0
    local.injuries = score.casualtiesLocal ?? 0
    visitor.score = score.totalScoreVisitor ?? 0
    visitor.injuries = score.casualtiesVisitor ?? 0
    return {
      order: m.order ?? 0,
      matchId: m.matchId,
      round: m.round ?? phases.currentRound ?? 0,
      state: m.state ?? 0,
      local,
      visitor,
      half: null,
    }
  })

  if (withHalf) {
    // One request per board. Failures are tolerated: a missing half is better
    // than losing the scores for the whole round.
    await Promise.all(
      matches.map(async (match) => {
        try {
          const detail = await getJson<any>(`api/match/${match.matchId}`, slug)
          const half = detail?.turn?.half
          match.half = half === 2 ? 2 : half === 1 ? 1 : null
        } catch {
          match.half = null
        }
      }),
    )
  }

  return { phaseId, currentRound: phases.currentRound ?? 0, matches }
}
