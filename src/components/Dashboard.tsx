import { BoardCard } from './BoardCard'
import { Flag } from './Flag'
import { RoundOutlook } from './RoundOutlook'
import type { RoundController } from '../state/useRound'
import { mirrorBoard, type Board } from '../types'

/**
 * Tab one: the round, read only.
 *
 * Two shapes, depending on the event. At a two-nation fixture it is one card
 * per board and our coach is side A of every one of them. At an open event —
 * `dashboardMode: 'ours'` — it is one card per coach of ours, always from their
 * point of view, because they are scattered through other people's squads and
 * turn up on either side. Two of ours drawn against each other therefore show
 * twice, the same match mirrored, so each of them has their own card.
 */
export function Dashboard({ round, aggregate, aggregateRange }: RoundController) {
  const ours = round.dashboardMode === 'ours'

  // A board with two of ours on it is one game shown twice, once from each of
  // their seats. The pair needs to read as that rather than as the same card
  // printed twice by mistake, so both coaches on it get the flag: an England
  // name top AND bottom is the tell that this is one of ours against another.
  const internal = new Set(
    round.ourSeats
      .map((s) => s.boardId)
      .filter((id, i, all) => all.indexOf(id) !== i),
  )

  // One entry per card. In fixture mode that is simply the boards; in ours mode
  // it is our seats, with the board turned round when we are sitting on side B.
  const cards: { key: string; board: Board; ourOpponent: boolean }[] = ours
    ? round.ourSeats.flatMap((seat) => {
        const board = round.boards.find((b) => b.id === seat.boardId)
        if (!board) return []
        return [
          {
            key: `${seat.boardId}-${seat.side}`,
            board: seat.side === 'b' ? mirrorBoard(board) : board,
            ourOpponent: internal.has(seat.boardId),
          },
        ]
      })
    : round.boards.map((board) => ({ key: String(board.id), board, ourOpponent: false }))

  return (
    <div className="dashboard">
      {ours ? (
        <div className="dashboard__legend">
          <span className="legend__team legend__team--a">
            <Flag country={round.teamA.country} />
            {round.teamA.name}
          </span>
          <span className="legend__vs">·</span>
          <span className="legend__ours">
            {cards.length === 0
              ? 'nobody of ours drawn yet'
              : `${cards.length} of ours playing`}
            {round.idleSquad.length > 0 && ` · ${round.idleSquad.length} not drawn`}
          </span>
        </div>
      ) : (
        <div className="dashboard__legend">
          <span className="legend__team legend__team--a">
            <Flag country={round.teamA.country} />
            {round.teamA.name}
          </span>
          <span className="legend__vs">vs</span>
          <span className="legend__team legend__team--b">
            <Flag country={round.teamB.country} />
            {round.teamB.name}
          </span>
        </div>
      )}

      {cards.length === 0 && round.idleSquad.length === 0 ? (
        <div className="boards-empty">
          <p>
            <strong>
              {ours && round.boards.length > 0
                ? 'None of our coaches are on a board in this round.'
                : 'No boards in this round yet.'}
            </strong>
          </p>
          <p>
            {ours && round.boards.length > 0
              ? 'Ours are the coaches with a login. If somebody is missing, they either have no login yet or their board carries no NAF number.'
              : 'In Settings, link a Tourplay tournament to import the draw, or add boards by hand on Match Control.'}
          </p>
        </div>
      ) : (
      <div className="boards" data-count={cards.length + round.idleSquad.length}>
        {cards.map(({ key, board, ourOpponent }) => (
          <BoardCard
            key={key}
            board={board}
            countryA={round.teamA.country}
            countryB={ours ? (ourOpponent ? round.teamA.country : null) : round.teamB.country}
            mode={round.casualtyMode}
            // In 'ours' mode the card is a seat, so a finished one has to say
            // whose seat. The board is mirrored to put our coach on top, so
            // that is side A.
            whose={ours ? board.a.nafName : null}
          />
        ))}
        {/* A named squad is a fixed group, so somebody with no board is
            resting, not missing. Shown as a slot rather than dropped, so the
            squad reads as the same five people every round. */}
        {round.idleSquad.map((m) => (
          <article key={`idle-${m.nafNumber}`} className="board board--idle">
            <header className="board__head">
              <span className="board__number">Not drawn</span>
            </header>
            <div className="board__idle">
              <Flag country={round.teamA.country} />
              <span className="board__idle-name">{m.name}</span>
              <span className="board__idle-note">sitting this round out</span>
            </div>
          </article>
        ))}
      </div>
      )}

      {/* `aggregate` already knows about 'ours' mode — see useRound. Recomputing
          it here from the cards gave the same answer right up until it did not,
          which is how My Board came to show a different round outlook. */}
      <RoundOutlook boards={cards.map((c) => c.board)} aggregate={aggregate} range={aggregateRange} />
    </div>
  )
}
