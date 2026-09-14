#!/usr/bin/env node
/**
 * Regenerates public/data/eb-matchups.json — the Eurobowl race-versus-race
 * matrix bundled with the app.
 *
 *   node scripts/fetch-eb-matchups.mjs
 *
 * Why a snapshot at all: the Worker cannot fetch BBTV directly. The site does
 * not serve its TLS intermediate, and Cloudflare rejects the chain with HTTP
 * 526 rather than chasing it the way a browser does. Until that is fixed at
 * source, the bundled file is how the figures reach the app.
 *
 * The same missing intermediate is why this script may need it supplied:
 *
 *   curl -sS -o /tmp/r2m04.cer http://crt.r2m04.amazontrust.com/r2m04.cer
 *   openssl x509 -inform DER -in /tmp/r2m04.cer -out /tmp/r2m04.pem
 *   NODE_EXTRA_CA_CERTS=/tmp/r2m04.pem node scripts/fetch-eb-matchups.mjs
 *
 * In a Claude Code cloud session add NODE_USE_ENV_PROXY=1 as well.
 */
import { writeFileSync } from 'node:fs'

const URL_ = 'https://bbtv.akorus.de/_dash-update-component'
const OUT = new URL('../public/data/eb-matchups.json', import.meta.url)

/** Only NAF: tabletop Eurobowl-tagged play, not the FumBBL leagues. */
const SOURCES = ['naf']
const PERIOD = [202604, 202612]

/** BBTV's spelling on the left, ours on the right. */
const ALIAS = { 'Elf Union': 'Elven Union' }
const ours = (n) => ALIAS[n] ?? n

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

const response = await fetch(URL_, {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    accept: 'application/json',
    'user-agent': 'EnglandBB-Coordinator/1.0 (+https://coordinator.englandbb.co.uk)',
  },
  body,
})
if (!response.ok) {
  console.error(`BBTV returned ${response.status}. If this is a certificate error, see the header of this file.`)
  process.exit(1)
}

const payload = await response.json()
const rows = payload?.response?.['eb-matchup-heatmap']?.children?.props?.data
if (!Array.isArray(rows) || rows.length === 0) {
  console.error('BBTV sent no rows — the page has probably changed shape.')
  process.exit(1)
}

const races = [...new Set(rows.flatMap((r) => [ours(r.race), ours(r.opponent)]))].sort()
const index = new Map(races.map((n, i) => [n, i]))
const rate = (v) => {
  const n = Number.parseFloat(String(v).replace('%', ''))
  return Number.isFinite(n) ? n : null
}

const doc = {
  source: 'BBTV — NAF Eurobowl-tagged tournaments',
  sourceUrl: 'https://bbtv.akorus.de/eurobowl-stats',
  capturedAt: new Date().toISOString().slice(0, 10),
  note: 'Snapshot bundled with the app because Cloudflare Workers cannot complete BBTV’s TLS chain (HTTP 526). Regenerate with scripts/fetch-eb-matchups.mjs.',
  races,
  // [home, away, wins, draws, losses, games, winRate] — indices into `races`.
  rows: rows.map((r) => [
    index.get(ours(r.race)),
    index.get(ours(r.opponent)),
    r.wins,
    r.draws,
    r.losses,
    r.games,
    rate(r.win_rate),
  ]),
}

writeFileSync(OUT, JSON.stringify(doc))
const games = rows.reduce((t, r) => t + r.games, 0)
console.log(`Wrote ${doc.rows.length} matchups across ${races.length} races (${games.toLocaleString()} games) to public/data/eb-matchups.json`)
