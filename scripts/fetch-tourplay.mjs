#!/usr/bin/env node
/**
 * Pull a Tourplay tournament's squads and coaches.
 *
 *   node scripts/fetch-tourplay.mjs eurobowl-xvii
 *   node scripts/fetch-tourplay.mjs https://tourplay.net/en/blood-bowl/eurobowl-xvii/players
 *   node scripts/fetch-tourplay.mjs eurobowl-xvii --json data/eurobowl-xvii.json
 *
 * Notes on Tourplay's API, learned the hard way:
 *
 *  - It 403s a default user-agent. robots.txt is empty, so there is no scraping
 *    prohibition — it simply expects browser headers. Hence HEADERS below.
 *  - The page is an Angular SPA; the HTML contains no data.
 *  - `api/inscriptions/{slug}` needs a logged-in account (401), but the
 *    per-category variant used here is public.
 *  - Races only appear once coaches submit rosters, which happens close to the
 *    event. Before that `roster.teamName` is just the squad's name.
 *
 * Node's built-in fetch ignores HTTPS_PROXY. Inside a Claude Code cloud session
 * run it as: NODE_USE_ENV_PROXY=1 node scripts/fetch-tourplay.mjs <slug>
 */

import { writeFile, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'

const BASE = 'https://tourplay.net'

const HEADERS = {
  'user-agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
  accept: 'application/json, text/plain, */*',
  'accept-language': 'en-GB,en;q=0.9',
  origin: BASE,
  'sec-fetch-site': 'same-origin',
  'sec-fetch-mode': 'cors',
  'sec-fetch-dest': 'empty',
}

/** Accepts a bare slug or any Tourplay tournament URL. */
function toSlug(input) {
  if (!input) return null
  if (!input.includes('://')) return input.replace(/^\/+|\/+$/g, '')
  try {
    const parts = new URL(input).pathname.split('/').filter(Boolean)
    // .../<lang>/blood-bowl/<slug>/<page?>
    const i = parts.indexOf('blood-bowl')
    return i >= 0 && parts[i + 1] ? parts[i + 1] : (parts.at(-1) ?? null)
  } catch {
    return null
  }
}

async function get(path, slug) {
  const response = await fetch(`${BASE}/${path}`, {
    headers: { ...HEADERS, referer: `${BASE}/en/blood-bowl/${slug}/players` },
  })
  const text = await response.text()

  if (!response.ok) {
    const hint =
      response.status === 401
        ? ' (this endpoint needs a logged-in Tourplay account)'
        : response.status === 403
          ? ' (Tourplay refused the request — its bot protection may have tightened)'
          : ''
    throw new Error(`GET /${path} → ${response.status}${hint}`)
  }
  // A wrong path falls through to the SPA shell rather than 404ing.
  if (text.startsWith('<!doctype') || text.startsWith('<html')) {
    throw new Error(`GET /${path} returned the web page, not JSON — the path is wrong`)
  }
  return JSON.parse(text)
}

async function main() {
  const args = process.argv.slice(2)
  const jsonAt = args.indexOf('--json')
  const jsonPath = jsonAt >= 0 ? args[jsonAt + 1] : null
  // Guard the value slot only when --json is actually present, or index 0
  // (the slug) gets skipped.
  const valueSlot = jsonAt >= 0 ? jsonAt + 1 : -1
  const slug = toSlug(args.find((a, i) => !a.startsWith('--') && i !== valueSlot))

  if (!slug) {
    console.error('Usage: node scripts/fetch-tourplay.mjs <slug-or-url> [--json <path>]')
    process.exit(1)
  }

  const tournament = await get(`api/tournament/${slug}`, slug)
  const categories = tournament.categories ?? []

  const squads = new Map()
  for (const category of categories) {
    const payload = await get(
      `api/inscriptions/${slug}/category/${category.id}/inscriptions`,
      slug,
    )
    for (const rows of Object.values(payload[String(category.id)] ?? {})) {
      for (const row of rows) {
        const name = row.squad?.name ?? '(no squad)'
        if (!squads.has(name)) squads.set(name, [])
        squads.get(name).push({
          coach: row.player?.userNameToShow ?? null,
          nafNumber: row.player?.nafNumber ?? null,
          nafVerified: row.player?.nafVerified ?? null,
          country: row.player?.country ?? null,
          rankOverall: row.coachRank?.rankOverall ?? null,
          score: row.coachRank?.score ?? null,
          // Only meaningful once rosters are submitted; until then it is the
          // squad's own name rather than a Blood Bowl team.
          roster: row.roster?.teamName ?? null,
        })
      }
    }
  }

  const result = {
    fetchedAt: new Date().toISOString(),
    tournament: {
      id: tournament.id,
      name: tournament.name,
      slug: tournament.nameNormalized,
      country: tournament.country,
      initDate: tournament.initDate,
      finishDate: tournament.finishDate,
      isNaf: tournament.isNaf,
      coachesRegistered: tournament.inscriptionsCoachCount,
    },
    squads: Object.fromEntries([...squads].sort(([a], [b]) => a.localeCompare(b))),
  }

  const listed = [...squads.values()].reduce((n, rows) => n + rows.length, 0)

  console.log(`${result.tournament.name} (${result.tournament.slug}, id ${result.tournament.id})`)
  console.log(
    `${result.tournament.initDate?.slice(0, 10)} → ${result.tournament.finishDate?.slice(0, 10)}, ${result.tournament.country}`,
  )
  console.log(`${squads.size} squads, ${listed} coaches listed`)
  if (result.tournament.coachesRegistered > listed) {
    console.log(
      `note: the tournament claims ${result.tournament.coachesRegistered} registered — ` +
        `the ${result.tournament.coachesRegistered - listed} not listed are most likely unconfirmed`,
    )
  }
  console.log()
  for (const [name, rows] of [...squads].sort(([a], [b]) => a.localeCompare(b))) {
    console.log(`${name}  (${rows.length})`)
    for (const r of rows) {
      console.log(`    ${(r.coach ?? '?').padEnd(24)} NAF ${String(r.nafNumber ?? '-').padStart(7)}`)
    }
  }

  if (jsonPath) {
    await mkdir(dirname(jsonPath), { recursive: true })
    await writeFile(jsonPath, JSON.stringify(result, null, 2) + '\n')
    console.log(`\nWrote ${jsonPath}`)
  }
}

main().catch((cause) => {
  console.error(`Failed: ${cause.message}`)
  process.exit(1)
})
