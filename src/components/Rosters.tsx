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
  positionals: string[]
  skills: string[]
  shotTiles: number
  nations: { name: string; file: string; squad: Entry[] }[]
}

/** m = [raceIndex, coach, ctv, tierIndex, nafRating, vodSeconds|null, hasStaffView] */
type Meta = [number, string, number, number, number, number | null, number]
interface Entry {
  m: Meta
  /** [positionalIndex, [addedSkillIndex, ...]] per player, in shirt order. */
  pl?: [number, number[]][]
  st?: Record<string, string | number>
  /** 1 when the caster never showed the whole player list. */
  part?: number
  in?: ({ n: number; name: string; cost: string } | { raw: string })[]
}

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
  staffView: boolean
  players?: { pos: string; added: string[] }[]
  staff?: Record<string, string | number>
  inducements?: Entry['in']
  partial: boolean
}

/** The order a coach reads the staff block in, not the order OCR found it. */
const STAFF_ORDER: { key: string; label: string }[] = [
  { key: 'treasury', label: 'Treasury' },
  { key: 'rerolls', label: 'Re-rolls' },
  { key: 'dedicatedFans', label: 'Dedicated fans' },
  { key: 'assistantCoaches', label: 'Assistant coaches' },
  { key: 'cheerleaders', label: 'Cheerleaders' },
  { key: 'apothecary', label: 'Apothecary' },
  { key: 'necromancer', label: 'Necromancer' },
]

/** `1h23m45s`, the fragment Twitch accepts for a VOD timestamp. */
function vodFragment(s: number) {
  return `${Math.floor(s / 3600)}h${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}m${String(s % 60).padStart(2, '0')}s`
}
function clock(s: number) {
  return `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

/**
 * Collapse identical players into one line. Six linemen with nothing learned is
 * one row reading "6x", not six rows — the shirt numbers carry no information
 * here, and the shape of a roster is far easier to read collapsed.
 */
function groupPlayers(players: { pos: string; added: string[] }[]) {
  const out: { pos: string; added: string[]; count: number }[] = []
  for (const p of players) {
    const last = out[out.length - 1]
    if (last && last.pos === p.pos && last.added.join('|') === p.added.join('|')) last.count++
    else out.push({ pos: p.pos, added: p.added, count: 1 })
  }
  return out
}

export function Rosters() {
  const [doc, setDoc] = useState<RosterDoc | null>(null)
  const [failed, setFailed] = useState(false)
  const [axis, setAxis] = useState<'nation' | 'race'>('nation')
  const [group, setGroup] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState<Slot | null>(null)
  const [showShot, setShowShot] = useState(false)

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
      n.squad.map((e, tile) => ({
        nation: n.name,
        file: n.file,
        tile,
        race: doc.races[e.m[0]] ?? '—',
        coach: e.m[1],
        ctv: e.m[2],
        tier: doc.tiers[e.m[3]] ?? '—',
        naf: e.m[4],
        vod: e.m[5],
        staffView: e.m[6] === 1,
        players: e.pl?.map(([pi, sk]) => ({
          pos: doc.positionals[pi] ?? '—',
          added: sk.map((i) => doc.skills[i]).filter(Boolean),
        })),
        staff: e.st,
        inducements: e.in,
        partial: e.part === 1,
      })),
    )
  }, [doc])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return slots
    return slots.filter(
      (s) =>
        s.coach.toLowerCase().includes(q) ||
        s.nation.toLowerCase().includes(q) ||
        s.race.toLowerCase().includes(q) ||
        s.players?.some(
          (p) =>
            p.pos.toLowerCase().includes(q) || p.added.some((a) => a.toLowerCase().includes(q)),
        ),
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
    // Within a nation, squad order is the nation's own and also the tile order.
    // Within a race, nation order is the only sensible one.
    if (axis === 'race') for (const [, l] of map) l.sort((a, b) => a.nation.localeCompare(b.nation))
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [filtered, axis])

  const names = groups.map(([n]) => n)
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
        <p className="rosters__none">Loading the rosters&hellip;</p>
      </div>
    )
  }

  const rows = current ? (groups.find(([n]) => n === current)?.[1] ?? []) : []
  const readable = rows.filter((s) => s.players).length

  return (
    <div className="rosters">
      <div className="rosters__bar">
        <div className="rosters__axis" role="group" aria-label="Browse by">
          {(['nation', 'race'] as const).map((a) => (
            <button
              key={a}
              type="button"
              className={`rosters__axis-btn${axis === a ? ' is-on' : ''}`}
              aria-pressed={axis === a}
              onClick={() => {
                setAxis(a)
                setGroup(null)
              }}
            >
              By {a}
            </button>
          ))}
        </div>

        <input
          type="search"
          className="rosters__search"
          value={query}
          placeholder="Coach, nation, race, positional or skill"
          aria-label="Filter rosters"
          onChange={(e) => setQuery(e.target.value)}
        />

        <span className="rosters__count">
          {filtered.length} of {slots.length}
        </span>
      </div>

      {names.length === 0 ? (
        <p className="rosters__none">Nothing matches &ldquo;{query.trim()}&rdquo;.</p>
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
              {rows.length} {rows.length === 1 ? 'roster' : 'rosters'} &middot; {readable}{' '}
              transcribed
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
                onClick={() => {
                  if (s.vod) {
                    setShowShot(false)
                    setOpen(s)
                  }
                }}
              >
                <span className="roster-card__race">{axis === 'nation' ? s.race : s.nation}</span>
                <span className="roster-card__coach">{s.coach}</span>
                <span className="roster-card__sub">{axis === 'nation' ? s.nation : s.race}</span>
                <span className="roster-card__foot">
                  <span className="roster-card__ctv">
                    {s.ctv.toLocaleString()}
                    <i> CTV</i>
                  </span>
                  <span className={`roster-tier roster-tier--${s.tier.toLowerCase()}`}>
                    {s.tier}
                    {s.naf > 0 ? ` ${s.naf}` : ''}
                  </span>
                </span>
                <span className="roster-card__state">
                  {!s.vod
                    ? 'Not shown on stream'
                    : s.players
                      ? `${s.players.length}${s.partial ? '+' : ''} players${s.staffView ? ' · staff & inducements' : ''}`
                      : 'Still only'}
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
                {open.nation} &middot; {open.race}
              </strong>
              <span className="roster-view__coach">
                {open.coach} &middot; {open.ctv.toLocaleString()} CTV &middot; {open.tier}
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
              {open.players ? (
                <div className="roster-read">
                  <table className="roster-read__tbl">
                    <thead>
                      <tr>
                        <th className="n">#</th>
                        <th>Positional</th>
                        <th>Added skills</th>
                      </tr>
                    </thead>
                    <tbody>
                      {groupPlayers(open.players).map((g, i) => (
                        <tr key={i}>
                          <td className="n">{g.count}</td>
                          <td className="pos">{g.pos}</td>
                          <td className="sk">
                            {g.added.length ? (
                              g.added.map((s) => (
                                <span key={s} className="sk-chip">
                                  {s}
                                </span>
                              ))
                            ) : (
                              <span className="sk-none">&mdash;</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  {open.partial && (
                    <p className="roster-read__gap roster-read__partial">
                      Only part of this roster was ever on screen &mdash; the rows above are
                      what the broadcast showed, not the whole squad.
                    </p>
                  )}

                  <div className="roster-read__side">
                    <div className="roster-read__block">
                      <h4>Sideline staff</h4>
                      {open.staff && Object.keys(open.staff).length ? (
                        <dl>
                          {STAFF_ORDER.filter((k) => open.staff![k.key] !== undefined).map((k) => (
                            <div key={k.key}>
                              <dt>{k.label}</dt>
                              <dd>{String(open.staff![k.key])}</dd>
                            </div>
                          ))}
                        </dl>
                      ) : (
                        <p className="roster-read__gap">Not legible on the still.</p>
                      )}
                    </div>

                    <div className="roster-read__block">
                      <h4>Inducements</h4>
                      {open.inducements == null ? (
                        <p className="roster-read__gap">
                          Never on screen &mdash; the caster did not scroll this roster that far.
                        </p>
                      ) : open.inducements.length === 0 ? (
                        <p className="roster-read__gap">None taken.</p>
                      ) : (
                        <ul>
                          {open.inducements.map((d, i) => (
                            <li key={i}>
                              {'raw' in d ? (
                                d.raw
                              ) : (
                                <>
                                  {d.n}&times; {d.name} <span className="cost">{d.cost}</span>
                                </>
                              )}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>
                </div>
              ) : (
                <p className="roster-read__gap">
                  This roster has no transcribed contents &mdash; only the still below.
                </p>
              )}

              {/* The still stays available as provenance: the table above was
                  read off it, and a coach checking a surprising skill should be
                  able to see the source without leaving the card. */}
              <button
                type="button"
                className="roster-view__btn roster-read__toggle"
                aria-expanded={showShot}
                onClick={() => setShowShot((v) => !v)}
              >
                {showShot ? 'Hide the still' : 'Show the still it was read from'}
              </button>
              {showShot && (
                <div
                  className="roster-view__shot"
                  style={{
                    backgroundImage: `url("/rosters/${open.file}")`,
                    backgroundSize: `100% ${doc.shotTiles * 100}%`,
                    backgroundPositionY: `${(open.tile / (doc.shotTiles - 1)) * 100}%`,
                  }}
                  role="img"
                  aria-label={`${open.coach}'s ${open.race} roster, as shown on stream`}
                />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
