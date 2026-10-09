import { useEffect, useMemo, useState } from 'react'

/**
 * Every EuroBowl 2026 squad, browsable by nation or by race.
 *
 * This is reference, not round state: it answers "what is my opponent running"
 * before a game and "who else took Nurgle" when the draw lands. It touches
 * neither `useRound` nor the API — the whole thing is a static snapshot served
 * from `/data/eb-rosters.json`, so it cannot be made stale by a save and costs
 * the round nothing.
 *
 * Nation and race are both offered because they answer different questions. A
 * nation is a squad you are drawn against; a race is a matchup you are about to
 * play. Neither ordering subsumes the other, so both are first-class rather
 * than one being a filter on the other.
 */

interface RosterDoc {
  source: string
  sourceUrl: string
  capturedAt: string
  note: string
  races: string[]
  tiers: string[]
  shotTiles: number
  nations: { name: string; file: string; squad: Row[] }[]
}

/** [raceIndex, coach, ctv, tierIndex, nafRating, vodSeconds|null, hasStaffView] */
type Row = [number, string, number, number, number, number | null, number]

interface Slot {
  nation: string
  file: string
  /** Position in its nation's squad — also the tile's row in the composite. */
  tile: number
  race: string
  coach: string
  ctv: number
  tier: string
  naf: number
  vod: number | null
  staff: boolean
}

/** `1h23m45s`, the fragment Twitch accepts for a VOD timestamp. */
function vodFragment(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  return `${h}h${String(m).padStart(2, '0')}m${String(seconds % 60).padStart(2, '0')}s`
}

function clock(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  return `${h}:${String(m).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
}

export function Rosters() {
  const [doc, setDoc] = useState<RosterDoc | null>(null)
  const [failed, setFailed] = useState(false)
  const [axis, setAxis] = useState<'nation' | 'race'>('nation')
  const [group, setGroup] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState<Slot | null>(null)

  useEffect(() => {
    let live = true
    fetch('/data/eb-rosters.json', { headers: { accept: 'application/json' } })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: RosterDoc) => live && setDoc(d))
      .catch(() => live && setFailed(true))
    return () => {
      live = false
    }
  }, [])

  const slots = useMemo<Slot[]>(() => {
    if (!doc) return []
    return doc.nations.flatMap((n) =>
      n.squad.map((row, tile) => ({
        nation: n.name,
        file: n.file,
        tile,
        race: doc.races[row[0]] ?? '—',
        coach: row[1],
        ctv: row[2],
        tier: doc.tiers[row[3]] ?? '—',
        naf: row[4],
        vod: row[5],
        staff: row[6] === 1,
      })),
    )
  }, [doc])

  // Filtering happens before grouping so an empty group never gets a heading,
  // and the picker only ever offers a group that still has something in it.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return slots
    return slots.filter(
      (s) =>
        s.coach.toLowerCase().includes(q) ||
        s.nation.toLowerCase().includes(q) ||
        s.race.toLowerCase().includes(q),
    )
  }, [slots, query])

  const groups = useMemo(() => {
    const map = new Map<string, Slot[]>()
    for (const s of filtered) {
      const key = axis === 'nation' ? s.nation : s.race
      const list = map.get(key)
      if (list) list.push(s)
      else map.set(key, [s])
    }
    for (const [, list] of map) {
      // Within a nation, squad order is the order the nation itself lists them,
      // which is also the tile order — leave it. Within a race, nation order is
      // the only sensible one.
      if (axis === 'race') list.sort((a, b) => a.nation.localeCompare(b.nation))
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [filtered, axis])

  // A group chosen under one axis will not exist under the other, and a search
  // can empty the chosen one. Fall back to the first rather than render blank.
  const names = groups.map(([name]) => name)
  const current = group && names.includes(group) ? group : (names[0] ?? null)
  useEffect(() => {
    if (group && !names.includes(group)) setGroup(null)
  }, [group, names])

  if (failed) {
    return (
      <div className="rosters">
        <p className="rosters__none">
          <strong>Could not load the roster snapshot.</strong> It ships with the app at
          <code> /data/eb-rosters.json</code>; if this persists the deploy is missing it.
        </p>
      </div>
    )
  }

  if (!doc) {
    return (
      <div className="rosters">
        <p className="rosters__none">Loading the rosters…</p>
      </div>
    )
  }

  const rows = current ? (groups.find(([name]) => name === current)?.[1] ?? []) : []
  const shownHere = rows.filter((s) => s.vod).length

  return (
    <div className="rosters">
      <div className="rosters__bar">
        <div className="rosters__axis" role="group" aria-label="Browse by">
          <button
            type="button"
            className={`rosters__axis-btn${axis === 'nation' ? ' is-on' : ''}`}
            aria-pressed={axis === 'nation'}
            onClick={() => {
              setAxis('nation')
              setGroup(null)
            }}
          >
            By nation
          </button>
          <button
            type="button"
            className={`rosters__axis-btn${axis === 'race' ? ' is-on' : ''}`}
            aria-pressed={axis === 'race'}
            onClick={() => {
              setAxis('race')
              setGroup(null)
            }}
          >
            By race
          </button>
        </div>

        <input
          type="search"
          className="rosters__search"
          value={query}
          placeholder="Coach, nation or race"
          aria-label="Filter rosters"
          onChange={(e) => setQuery(e.target.value)}
        />

        <span className="rosters__count">
          {filtered.length} of {slots.length}
        </span>
      </div>

      {names.length === 0 ? (
        <p className="rosters__none">Nothing matches “{query.trim()}”.</p>
      ) : (
        <>
          <nav className="rosters__picker" aria-label={axis === 'nation' ? 'Nation' : 'Race'}>
            {groups.map(([name, list]) => (
              <button
                key={name}
                type="button"
                className={`rosters__pick${name === current ? ' is-on' : ''}`}
                aria-current={name === current}
                onClick={() => setGroup(name)}
              >
                {name}
                <span className="rosters__pick-n">{list.length}</span>
              </button>
            ))}
          </nav>

          <div className="rosters__head">
            <h2 className="rosters__title">{current}</h2>
            <span className="rosters__sub">
              {rows.length} {rows.length === 1 ? 'roster' : 'rosters'} · {shownHere} with a still
            </span>
          </div>

          <div className="rosters__grid">
            {rows.map((s) => (
              <button
                key={`${s.nation}|${s.race}`}
                type="button"
                className={`roster-card${s.vod ? '' : ' roster-card--unseen'}`}
                disabled={!s.vod}
                aria-disabled={!s.vod}
                onClick={() => s.vod && setOpen(s)}
              >
                <span className="roster-card__race">{axis === 'nation' ? s.race : s.nation}</span>
                <span className="roster-card__coach">{s.coach}</span>
                <span className="roster-card__sub">
                  {axis === 'nation' ? s.nation : s.race}
                </span>
                <span className="roster-card__foot">
                  <span className="roster-card__ctv">{s.ctv.toLocaleString()}<i> CTV</i></span>
                  <span className={`roster-tier roster-tier--${s.tier.toLowerCase()}`}>
                    {s.tier}
                    {s.naf > 0 ? ` ${s.naf}` : ''}
                  </span>
                </span>
                <span className="roster-card__state">
                  {!s.vod
                    ? 'Not shown on stream'
                    : s.staff
                      ? 'Players, staff and inducements'
                      : 'Players only'}
                </span>
              </button>
            ))}
          </div>
        </>
      )}

      <p className="rosters__note">
        {doc.note}{' '}
        <a href={doc.sourceUrl} target="_blank" rel="noopener noreferrer">
          {doc.source}
        </a>
        , {doc.capturedAt}.
      </p>

      {open && (
        <div
          className="roster-view"
          role="dialog"
          aria-modal="true"
          aria-label={`${open.nation} — ${open.race}`}
          onClick={(e) => e.target === e.currentTarget && setOpen(null)}
        >
          <div className="roster-view__panel">
            <div className="roster-view__head">
              <strong className="roster-view__who">
                {open.nation} · {open.race}
              </strong>
              <span className="roster-view__coach">
                {open.coach} · {open.ctv.toLocaleString()} CTV · {open.tier}
                {open.naf > 0 ? ` ${open.naf}` : ''}
              </span>
              <span className="roster-view__spacer" />
              {open.vod != null && (
                <a
                  className="roster-view__btn"
                  href={`${doc.sourceUrl}?t=${vodFragment(open.vod)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  VOD {clock(open.vod)}
                </a>
              )}
              <button type="button" className="roster-view__btn" onClick={() => setOpen(null)}>
                Close
              </button>
            </div>
            <div className="roster-view__body">
              {/* One image per nation holding all eight rosters stacked, shown a
                  tile at a time. Eight separate requests per nation would be
                  eight round trips on hall wifi; this is one, cached after the
                  first coach in that squad is opened. */}
              <div
                className="roster-view__shot"
                style={{
                  backgroundImage: `url("/rosters/${open.file}")`,
                  backgroundSize: `100% ${doc.shotTiles * 100}%`,
                  backgroundPositionY: `${(open.tile / (doc.shotTiles - 1)) * 100}%`,
                }}
                role="img"
                aria-label={`${open.coach}'s ${open.race} roster`}
              />
              {!open.staff && (
                <p className="roster-view__gap">
                  The caster did not scroll past the player list for this roster, so inducements
                  and the full staff list were never on screen. Re-rolls, treasury, dedicated fans
                  and apothecary are in the Sideline Staff panel at the foot of the view above.
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
