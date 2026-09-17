import type { RoundController } from '../state/useRound'

/**
 * Tournament and round selectors.
 *
 * The two work differently on purpose. ROUND is shared: the coordinator moves
 * the event on and every screen watching that tournament follows. TOURNAMENT is
 * per device, because tournaments are independent — the Eurobowl tablet and the
 * EurOpen tablet are looking at different events at the same moment.
 *
 * A coach whose own tournament is live has no tournament control at all. They
 * are held to their boards, which is the point: at an event you are playing in
 * one thing, and a screen that can wander off it is a screen that will.
 */
export function Selectors({
  canCoordinate,
  ...controller
}: RoundController & { canCoordinate: boolean }) {
  const { round, connection, switching, switchTo, switchTournament, isDirty } = controller
  // Switching with unsaved work would discard it silently.
  const locked = connection !== 'live' || switching || isDirty
  const multipleRounds = round.rounds.length > 1
  // Nothing to choose between is not a choice, so it is not shown as one.
  const canChooseTournament = !round.tournamentLocked && round.tournaments.length > 1

  return (
    <div className="sel">
      {canChooseTournament ? (
        <label className="sel__field">
          <span className="sel__label">Tournament</span>
          <select
            className="sel__input"
            value={round.activeTournamentId}
            disabled={locked}
            onChange={(event) => switchTournament(Number(event.target.value))}
          >
            {round.tournaments.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
                {t.isActive ? ' — live' : ''}
                {t.syncEnabled ? ' ●' : ''}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <span className="sel__fixed">
          <span className="sel__label">Tournament</span>
          <span className="sel__fixed-name">
            {round.tournaments.find((t) => t.id === round.activeTournamentId)?.name ?? '—'}
          </span>
        </span>
      )}

      {/* Moving the round moves it for everyone watching this tournament, so it
          belongs to whoever is running it. A coach only picks which event. */}
      {canCoordinate && (
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
      )}

      {isDirty && <span className="sel__hint">save or discard to switch</span>}
    </div>
  )
}
