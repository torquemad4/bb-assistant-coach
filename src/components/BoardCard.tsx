import { RACE_TAG, type Race } from '../data/races'
import { signed, toneOf } from '../format'
import type { Board, Side } from '../types'

function raceTag(race: string): string {
  return RACE_TAG[race as Race] ?? race.slice(0, 4).toUpperCase()
}

interface SideRowProps {
  side: Side
  team: 'a' | 'b'
}

function SideRow({ side, team }: SideRowProps) {
  return (
    <div className={`side side--${team}`}>
      <div className="side__name" title={side.nafName}>
        {side.nafName}
      </div>
      <div className="side__race" title={side.race}>
        <span className="side__race-tag">{raceTag(side.race)}</span>
        <span className="side__race-full">{side.race}</span>
      </div>
    </div>
  )
}

/** One vertical board column: coach A on top, score in the middle, coach B below. */
export function BoardCard({ board }: { board: Board }) {
  const tone = toneOf(board.outlook)

  return (
    <article className="board" aria-label={`Board ${board.id}`}>
      <header className="board__head">
        <span className="board__number">Board {board.id}</span>
        <span className={`pill pill--half pill--half-${board.half}`}>
          {board.half === 1 ? '1st' : '2nd'} Half
        </span>
      </header>

      <SideRow side={board.a} team="a" />

      <div className="board__score" aria-label="Score">
        <span className="board__score-value">{board.a.score}</span>
        <span className="board__score-dash">–</span>
        <span className="board__score-value">{board.b.score}</span>
      </div>

      <SideRow side={board.b} team="b" />

      <footer className="board__foot">
        <div className="cas" aria-label="Casualties suffered">
          <span className="cas__label">CAS</span>
          <span className="cas__pair">
            <span className="cas__value">{board.a.injuries}</span>
            <span className="cas__sep">/</span>
            <span className="cas__value">{board.b.injuries}</span>
          </span>
        </div>
        <div className={`outlook outlook--${tone}`} aria-label="Match outlook">
          {signed(board.outlook)}
        </div>
      </footer>
    </article>
  )
}
