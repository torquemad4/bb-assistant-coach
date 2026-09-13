import type { RoundController } from '../state/useRound'

/**
 * Tournament and round selectors. Selection is shared, not per-device — the
 * coordinator switches and every watching tablet follows, which is why these
 * sit in the top bar rather than inside a tab.
 */
export function Selectors(controller: RoundController) {
  const { round, connection, switching, switchTo, isDirty } = controller
  // Switching with unsaved work would discard it silently.
  const locked = connection !== 'live' || switching || isDirty
  const multipleRounds = round.rounds.length > 1

  return (
    <div className="sel">
      <label className="sel__field">
        <span className="sel__label">Tournament</span>
        <select
          className="sel__input"
          value={round.activeTournamentId}
          disabled={locked}
          onChange={(event) => switchTo(Number(event.target.value))}
        >
          {round.tournaments.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
              {t.syncEnabled ? ' ●' : ''}
            </option>
          ))}
        </select>
      </label>

      <label className="sel__field sel__field--round">
        <span className="sel__label">Round</span>
        <select
          className="sel__input"
          value={round.activeRoundId}
          disabled={locked || !multipleRounds}
          onChange={(event) => switchTo(round.activeTournamentId, Number(event.target.value))}
        >
          {round.rounds.map((r) => (
            <option key={r.id} value={r.id}>
              {r.roundNumber}
            </option>
          ))}
        </select>
      </label>

      {isDirty && <span className="sel__hint">save or discard to switch</span>}
    </div>
  )
}
