import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  activate,
  createTournament,
  fetchRound,
  setBoardTag,
  unlockBoardTag,
  linkTournament,
  moveBoard,
  pingScoutEngine,
  refreshScouting,
  chooseTournament,
  setCasualtyMode,
  setOpenCoordinator,
  setProvisional,
  saveRound,
  setSyncMode,
  syncNow,
  toSaveBoard,
  type EnginePing,
  type LinkPreview,
  type MatchupReport,
  type ScoutSkip,
} from '../api'
import { SEED_ROUND } from '../data/round'
import {
  OUTLOOK_MAX,
  OUTLOOK_MIN,
  OUTLOOK_STEP,
  outlookForResult,
  resultOf,
  type Board,
  type CasualtyMode,
  type Kickoff,
  type Period,
  type Outlook,
  type Round,
  type TeamId,
} from '../types'

/** How often a clean, connected client re-reads the round. */
const POLL_MS = 10_000

/** Clamp an arbitrary number back onto the legal outlook scale. */
function clampOutlook(value: number): Outlook {
  const stepped = Math.round(value / OUTLOOK_STEP) * OUTLOOK_STEP
  return Math.min(OUTLOOK_MAX, Math.max(OUTLOOK_MIN, stepped)) as Outlook
}

/** Scores and casualties can never go below zero. */
function clampCount(value: number): number {
  return Math.max(0, value)
}

/**
 * Whether a board's match state differs from what the server last confirmed.
 * Only the savable fields count — a roster change made directly in D1 is not an
 * unsaved edit.
 */
function boardChanged(a: Board, b: Board): boolean {
  const x = toSaveBoard(a)
  const y = toSaveBoard(b)
  return (
    x.aScore !== y.aScore ||
    x.aInjuries !== y.aInjuries ||
    x.bScore !== y.bScore ||
    x.bInjuries !== y.bInjuries ||
    x.period !== y.period ||
    x.kickoff !== y.kickoff ||
    x.outlook !== y.outlook
  )
}

/** 'live' talks to D1; 'offline' is the committed fixture, read only. */
export type Connection = 'loading' | 'live' | 'offline'

export interface RoundController {
  round: Round
  connection: Connection
  loadError: string | null
  aggregate: number
  aggregateRange: number
  /** Boards whose match state has been edited but not saved. */
  dirtyBoardIds: number[]
  isDirty: boolean
  saving: boolean
  saveError: string | null
  lastSavedAt: Date | null
  nudgeOutlook: (boardId: number, direction: 1 | -1) => void
  nudgeScore: (boardId: number, team: TeamId, direction: 1 | -1) => void
  nudgeInjuries: (boardId: number, team: TeamId, direction: 1 | -1) => void
  setPeriod: (boardId: number, period: Period) => void
  /** Tagging locks the board and seeds its outlook. */
  tagBoard: (boardId: number, tag: string | null) => void
  unlockBoard: (boardId: number) => void
  tagging: boolean
  /**
   * Swap a board with its neighbour. The pairing moves — tag, scores and
   * scouting travel with the coaches, not with the board number.
   */
  moveBoard: (boardId: number, direction: 1 | -1) => void
  reordering: boolean
  /** Pull scouting from the NAF Scout engine for the round on screen. */
  refreshScout: (resolveByName?: boolean) => void
  scouting: boolean
  scoutError: string | null
  /** Seats the last pull could not scout. Empty after a clean pull. */
  scoutSkipped: ScoutSkip[]
  scoutedCount: number | null
  /** How the Eurobowl race matrix fared on the last pull. */
  matchupReport: MatchupReport | null
  /** Result of the last engine test, so a wholesale failure can be placed. */
  enginePing: EnginePing | null
  pingEngine: () => void
  pinging: boolean
  /** Mark the line-up on screen provisional, or confirm it. */
  setProvisional: (provisional: boolean) => void
  /** Switches the casualty reading for everyone; clears the round's casualties. */
  setCasualtyMode: (mode: CasualtyMode) => void
  /** Lends the coordinator's powers to everyone signed in, or takes them back. */
  setOpenCoordinator: (open: boolean) => void
  setKickoff: (boardId: number, kickoff: Kickoff) => void
  /** Throw away unsaved edits and go back to the last saved state. */
  discard: () => void
  save: () => void
  reload: () => void
  /**
   * Take a round the server has just returned as the new truth.
   *
   * For writes that happen outside this hook — a coach reporting their own
   * board — where `reload` would be wrong: it drops the app to its loading
   * screen, which on a phone means the view vanishing after every tap.
   */
  adoptRound: (fresh: Round) => void

  /** True while match state is being pulled from Tourplay. */
  syncing: boolean
  syncError: string | null
  /** Tourplay has moved on to this round, while an earlier one is on screen. */
  liveRound: number | null
  /** Match state comes from Tourplay and is not edited by hand. */
  followingTourplay: boolean
  syncNow: () => void
  setFollowing: (enabled: boolean) => void
  /** Link flow: preview first, then confirm. */
  linkPreview: LinkPreview | null
  linkError: string | null
  linking: boolean
  /** Switching what is on screen — shared with every other viewer. */
  switching: boolean
  switchTo: (tournamentId?: number, roundId?: number) => void
  /**
   * Moves THIS device to another tournament. Per device rather than shared:
   * tournaments are independent, so two people can be on different ones.
   */
  switchTournament: (tournamentId: number) => void
  addTournament: (name: string) => void
  previewLink: (slug: string) => void
  confirmLink: () => void
  cancelLink: () => void
}

/**
 * Single source of truth for the round.
 *
 * `round` is what is on screen; `baseline` is what the server last confirmed.
 * The difference between them is the unsaved work, which is why nothing here
 * writes to D1 until `save` is called.
 */
export function useRound(options: { canSync?: boolean } = {}): RoundController {
  const [round, setRound] = useState<Round>(SEED_ROUND)
  const [baseline, setBaseline] = useState<Round>(SEED_ROUND)
  const [connection, setConnection] = useState<Connection>('loading')
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [syncError, setSyncError] = useState<string | null>(null)
  const [liveRound, setLiveRound] = useState<number | null>(null)
  const [linkPreview, setLinkPreview] = useState<LinkPreview | null>(null)
  const [linkError, setLinkError] = useState<string | null>(null)
  const [linking, setLinking] = useState(false)
  const [switching, setSwitching] = useState(false)
  const [tagging, setTagging] = useState(false)
  const [reordering, setReordering] = useState(false)
  const [scouting, setScouting] = useState(false)
  const [scoutError, setScoutError] = useState<string | null>(null)
  const [scoutSkipped, setScoutSkipped] = useState<ScoutSkip[]>([])
  const [scoutedCount, setScoutedCount] = useState<number | null>(null)
  const [matchupReport, setMatchupReport] = useState<MatchupReport | null>(null)
  const [enginePing, setEnginePing] = useState<EnginePing | null>(null)
  const [pinging, setPinging] = useState(false)

  const dirtyBoardIds = useMemo(() => {
    const byId = new Map(baseline.boards.map((b) => [b.id, b]))
    return round.boards.filter((b) => {
      const was = byId.get(b.id)
      return was ? boardChanged(b, was) : true
    }).map((b) => b.id)
  }, [round, baseline])

  const isDirty = dirtyBoardIds.length > 0

  const followingTourplay = round.tourplay?.syncEnabled === true

  // Kept in a ref so the polling interval can read current values without
  // being torn down and rebuilt on every keystroke.
  // Pulling from Tourplay is a write, and writes belong to whoever is running
  // the round. A coach polls by reading instead — see the poll below.
  const canSync = options.canSync === true
  const guard = useRef({ isDirty, saving, connection, followingTourplay, canSync })
  guard.current = { isDirty, saving, connection, followingTourplay, canSync }

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const fresh = await fetchRound(signal)
      setRound(fresh)
      setBaseline(fresh)
      setConnection('live')
      setLoadError(null)
    } catch (cause) {
      if (signal?.aborted) return
      // Fall back to the committed fixture so the dashboard still shows
      // something, but read only — saving into a round we could not read
      // would be worse than not saving at all.
      setRound(SEED_ROUND)
      setBaseline(SEED_ROUND)
      setConnection('offline')
      setLoadError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    void load(controller.signal)
    return () => controller.abort()
  }, [load])

  const applySync = useCallback(async () => {
    setSyncing(true)
    try {
      const result = await syncNow()
      setRound(result.round)
      setBaseline(result.round)
      setLiveRound(result.liveRound)
      setSyncError(null)
    } catch (cause) {
      setSyncError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setSyncing(false)
    }
  }, [])

  // Watchers need the live picture. Polling pauses while there are unsaved
  // edits, so a refresh can never wipe work in progress. When the round follows
  // Tourplay the same tick pulls from it — the server throttles, so several
  // viewers polling does not mean several trips to Tourplay.
  //
  // Only a coordinator drives that pull. `/api/sync` is a write and is refused
  // for anyone else, so a coach ticking on the same branch would have spent the
  // whole event getting a 403 every ten seconds and never refreshing their own
  // board. They read instead, which shows them everything the coordinator's
  // pull has just brought in.
  useEffect(() => {
    const timer = setInterval(() => {
      const {
        isDirty: dirty,
        saving: busy,
        connection: state,
        followingTourplay: live,
        canSync: mine,
      } = guard.current
      if (dirty || busy || state !== 'live') return
      if (live && mine) void applySync()
      else void load()
    }, POLL_MS)
    return () => clearInterval(timer)
  }, [load, applySync])

  // A tablet that gets closed mid-edit should say so.
  useEffect(() => {
    if (!isDirty) return
    const warn = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [isDirty])

  const updateBoard = useCallback((boardId: number, change: (board: Board) => Board) => {
    setRound((current) => ({
      ...current,
      boards: current.boards.map((board) => (board.id === boardId ? change(board) : board)),
    }))
  }, [])

  const nudgeOutlook = useCallback(
    (boardId: number, direction: 1 | -1) => {
      updateBoard(boardId, (board) => ({
        ...board,
        outlook: clampOutlook(board.outlook + direction * OUTLOOK_STEP),
      }))
    },
    [updateBoard],
  )

  const nudgeScore = useCallback(
    (boardId: number, team: TeamId, direction: 1 | -1) => {
      updateBoard(boardId, (board) => {
        const key = team === 'A' ? 'a' : 'b'
        return { ...board, [key]: { ...board[key], score: clampCount(board[key].score + direction) } }
      })
    },
    [updateBoard],
  )

  const nudgeInjuries = useCallback(
    (boardId: number, team: TeamId, direction: 1 | -1) => {
      updateBoard(boardId, (board) => {
        const key = team === 'A' ? 'a' : 'b'
        return { ...board, [key]: { ...board[key], injuries: clampCount(board[key].injuries + direction) } }
      })
    },
    [updateBoard],
  )

  const setPeriod = useCallback(
    (boardId: number, period: Period) => {
      updateBoard(boardId, (board) => ({
        ...board,
        period,
        // Calling full time settles the outlook: a finished match is a result,
        // not a judgement. Leaving FT keeps the value so it can be adjusted.
        outlook: period === 'FT' ? outlookForResult(resultOf(board)) : board.outlook,
      }))
    },
    [updateBoard],
  )

  const setKickoff = useCallback(
    (boardId: number, kickoff: Kickoff) => {
      // Tapping the active side again clears it.
      updateBoard(boardId, (board) => ({
        ...board,
        kickoff: board.kickoff === kickoff ? null : kickoff,
      }))
    },
    [updateBoard],
  )

  const discard = useCallback(() => {
    setRound(baseline)
    setSaveError(null)
  }, [baseline])

  const save = useCallback(async () => {
    if (connection !== 'live') return
    setSaving(true)
    setSaveError(null)
    try {
      const fresh = await saveRound(round.boards)
      setRound(fresh)
      setBaseline(fresh)
      setLastSavedAt(new Date())
    } catch (cause) {
      // The edits stay on screen so nothing is lost and Save can be retried.
      setSaveError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setSaving(false)
    }
  }, [connection, round])

  const reload = useCallback(() => {
    setConnection('loading')
    void load()
  }, [load])

  const setFollowing = useCallback(async (enabled: boolean) => {
    try {
      const fresh = await setSyncMode(enabled)
      setRound(fresh)
      setBaseline(fresh)
      setSyncError(null)
    } catch (cause) {
      setSyncError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [])

  const previewLink = useCallback(async (slug: string) => {
    setLinking(true)
    setLinkError(null)
    try {
      const result = await linkTournament(slug, false)
      if ('preview' in result) setLinkPreview(result)
    } catch (cause) {
      setLinkError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setLinking(false)
    }
  }, [])

  const confirmLink = useCallback(async () => {
    if (!linkPreview) return
    setLinking(true)
    setLinkError(null)
    try {
      const result = await linkTournament(linkPreview.slug, true)
      if (!('preview' in result)) {
        setRound(result)
        setBaseline(result)
        setLinkPreview(null)
      }
    } catch (cause) {
      setLinkError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setLinking(false)
    }
  }, [linkPreview])

  const switchTournament = useCallback(async (tournamentId: number) => {
    setSwitching(true)
    try {
      // Nothing is written: the choice lives on this device and rides on every
      // request as `?t=`. The server still decides whether it is allowed.
      chooseTournament(tournamentId)
      const fresh = await fetchRound()
      setRound(fresh)
      setBaseline(fresh)
      setSyncError(null)
    } catch (cause) {
      setSyncError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setSwitching(false)
    }
  }, [])

  const switchTo = useCallback(async (tournamentId?: number, roundId?: number) => {
    setSwitching(true)
    try {
      const fresh = await activate(tournamentId, roundId)
      setRound(fresh)
      setBaseline(fresh)
      setSyncError(null)
    } catch (cause) {
      setSyncError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setSwitching(false)
    }
  }, [])

  const addTournament = useCallback(async (name: string) => {
    setSwitching(true)
    try {
      const fresh = await createTournament(name)
      setRound(fresh)
      setBaseline(fresh)
    } catch (cause) {
      setSyncError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setSwitching(false)
    }
  }, [])

  // Tagging writes straight through rather than becoming unsaved work: it is a
  // decision about the round, not a score being nudged.
  const applyTag = useCallback(async (boardId: number, tag: string | null) => {
    setTagging(true)
    try {
      const fresh = await setBoardTag(boardId, tag)
      setRound(fresh)
      setBaseline(fresh)
      setSaveError(null)
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setTagging(false)
    }
  }, [])

  const applyUnlock = useCallback(async (boardId: number) => {
    setTagging(true)
    try {
      const fresh = await unlockBoardTag(boardId)
      setRound(fresh)
      setBaseline(fresh)
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setTagging(false)
    }
  }, [])

  // Reordering writes straight through too, so it would overwrite unsaved
  // match edits with the server's copy. The arrows are disabled while dirty;
  // this is the guard behind them.
  const applyMove = useCallback(async (boardId: number, direction: 1 | -1) => {
    if (guard.current.isDirty || guard.current.connection !== 'live') return
    setReordering(true)
    try {
      const fresh = await moveBoard(boardId, direction)
      setRound(fresh)
      setBaseline(fresh)
      setSaveError(null)
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setReordering(false)
    }
  }, [])

  // Unlike tagging and reordering, this is safe to run with unsaved edits —
  // but only because it takes the scouting out of the response and leaves the
  // boards alone. Swallowing the whole round here would discard work in
  // progress exactly as they would.
  const applyScout = useCallback(async (resolveByName = false) => {
    setScouting(true)
    setScoutError(null)
    try {
      const result = await refreshScouting({ resolveByName })
      setRound((current) => ({ ...current, scout: result.round.scout }))
      setBaseline((current) => ({ ...current, scout: result.round.scout }))
      setScoutSkipped(result.skipped)
      setScoutedCount(result.scouted)
      setMatchupReport(result.matchups)
    } catch (cause) {
      setScoutError(cause instanceof Error ? cause.message : String(cause))
      const skipped = (cause as { skipped?: ScoutSkip[] })?.skipped
      setScoutSkipped(skipped ?? [])
      setScoutedCount(0)
    } finally {
      setScouting(false)
    }
  }, [])

  const applyProvisional = useCallback(async (provisional: boolean) => {
    try {
      const fresh = await setProvisional(provisional)
      setRound((current) => ({ ...current, rostersProvisional: fresh.rostersProvisional }))
      setBaseline((current) => ({ ...current, rostersProvisional: fresh.rostersProvisional }))
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [])

  const applyCasualtyMode = useCallback(async (mode: CasualtyMode) => {
    try {
      // The server clears the round's casualties on a real change, so the whole
      // round is adopted rather than the one field: the zeroed boards have to
      // land on screen too, or the old numbers sit there looking entered.
      const fresh = await setCasualtyMode(mode)
      setRound(fresh)
      setBaseline(fresh)
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [])

  const applyOpenCoordinator = useCallback(async (open: boolean) => {
    try {
      const fresh = await setOpenCoordinator(open)
      setRound((current) => ({ ...current, openCoordinator: fresh.openCoordinator }))
      setBaseline((current) => ({ ...current, openCoordinator: fresh.openCoordinator }))
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [])

  const applyPing = useCallback(async () => {
    setPinging(true)
    try {
      setEnginePing(await pingScoutEngine())
    } catch (cause) {
      setEnginePing({
        base: '',
        ok: false,
        health: cause instanceof Error ? cause.message : String(cause),
        version: null,
      })
    } finally {
      setPinging(false)
    }
  }, [])

  const aggregate = useMemo(
    () => round.boards.reduce((total, board) => total + board.outlook, 0),
    [round.boards],
  )

  return {
    round,
    connection,
    loadError,
    aggregate,
    aggregateRange: round.boards.length,
    dirtyBoardIds,
    isDirty,
    saving,
    saveError,
    lastSavedAt,
    nudgeOutlook,
    nudgeScore,
    nudgeInjuries,
    setPeriod,
    setKickoff,
    tagBoard: (boardId: number, tag: string | null) => void applyTag(boardId, tag),
    unlockBoard: (boardId: number) => void applyUnlock(boardId),
    tagging,
    moveBoard: (boardId: number, direction: 1 | -1) => void applyMove(boardId, direction),
    reordering,
    refreshScout: (resolveByName?: boolean) => void applyScout(resolveByName),
    scouting,
    scoutError,
    scoutSkipped,
    scoutedCount,
    matchupReport,
    enginePing,
    pingEngine: () => void applyPing(),
    pinging,
    setProvisional: (provisional: boolean) => void applyProvisional(provisional),
    setCasualtyMode: (mode: CasualtyMode) => void applyCasualtyMode(mode),
    setOpenCoordinator: (open: boolean) => void applyOpenCoordinator(open),
    discard,
    save: () => void save(),
    reload,
    adoptRound: (fresh: Round) => {
      setRound(fresh)
      setBaseline(fresh)
    },
    syncing,
    syncError,
    liveRound,
    followingTourplay,
    syncNow: () => void applySync(),
    setFollowing: (enabled: boolean) => void setFollowing(enabled),
    linkPreview,
    linkError,
    linking,
    previewLink: (slug: string) => void previewLink(slug),
    confirmLink: () => void confirmLink(),
    cancelLink: () => setLinkPreview(null),
    switching,
    switchTo: (tournamentId?: number, roundId?: number) => void switchTo(tournamentId, roundId),
    switchTournament: (tournamentId: number) => void switchTournament(tournamentId),
    addTournament: (name: string) => void addTournament(name),
  }
}
