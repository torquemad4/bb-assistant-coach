import { casualtyView, CASUALTY_LABEL, CASUALTY_TAG } from '../casualties'
import { RACE_TAG, type Race } from '../data/races'
import { signed, toneOf } from '../format'
import { Flag } from './Flag'
import {
  TAG_LABEL,
  resultOf,
  type Board,
  type CasualtyMode,
  type CountryCode,
  type Side,
} from '../types'

function raceTag(race: string): string {
  return RACE_TAG[race as Race] ?? race.slice(0, 4).toUpperCase()
}

interface SideRowProps {
  side: Side
  team: 'a' | 'b'
  country: CountryCode | null
  /** Shown against the home side only: did they kick or receive. */
  kickoff?: 'K' | 'R' | null
}

function SideRow({ side, team, country, kickoff }: SideRowProps) {
  return (
    <div className={`side side--${team}${side.vacant ? ' side--vacant' : ''}`}>
      <div className="side__name" title={side.nafName}>
        {!side.vacant && <Flag country={country} />}
        <span className="side__handle">{side.nafName}</span>
        {kickoff && (
          <span className="kick-badge" title={kickoff === 'K' ? 'Kicked off' : 'Received'}>
            {kickoff}
          </span>
        )}
      </div>
      {side.vacant ? (
        <div className="side__race side__race--vacant">Seat unfilled</div>
      ) : (
        <div className="side__race" title={side.race}>
          <span className="side__race-tag">{raceTag(side.race)}</span>
          <span className="side__race-full">{side.race}</span>
        </div>
      )}
    </div>
  )
}

interface BoardCardProps {
  board: Board
  countryA: CountryCode | null
  countryB: CountryCode | null
  /** How the casualty pair reads — the same choice the whole hall is on. */
  mode: CasualtyMode
}

/** One vertical board column: coach A on top, score in the middle, coach B below. */
export function BoardCard({ board, countryA, countryB, mode }: BoardCardProps) {
  const tone = toneOf(board.outlook)

  // A finished match has nothing left to read but its result, so the card
  // becomes the result.
  if (board.period === 'FT') {
    const result = resultOf(board)
    return (
      <article className="board board--ft" aria-label={`Board ${board.id}, full time`}>
        <header className="board__head">
          <span className="board__number">Board {board.id}</span>
          {board.tag && <span className={`tag tag--${board.tag}`}>{TAG_LABEL[board.tag]}</span>}
          <span className="pill pill--ft">FT</span>
        </header>
        <div className={`ft ft--${result.toLowerCase()}`} aria-label={`Result ${result}`}>
          {result}
        </div>
      </article>
    )
  }

  return (
    <article className="board" aria-label={`Board ${board.id}`}>
      <header className="board__head">
        <span className="board__number">Board {board.id}</span>
        {board.tag && <span className={`tag tag--${board.tag}`}>{TAG_LABEL[board.tag]}</span>}
        <span className={`pill pill--half pill--half-${board.period}`}>
          {board.period === '1' ? '1st' : '2nd'} Half
        </span>
      </header>

      <SideRow side={board.a} team="a" country={countryA} kickoff={board.kickoff} />

      <div className="board__score" aria-label="Score">
        <span className="board__score-value">{board.a.score}</span>
        <span className="board__score-dash">–</span>
        <span className="board__score-value">{board.b.score}</span>
      </div>

      <SideRow side={board.b} team="b" country={countryB} />

      <footer className="board__foot">
        <div className="cas" aria-label={CASUALTY_LABEL[mode]}>
          <span className="cas__label">{CASUALTY_TAG[mode]}</span>
          <span className="cas__pair">
            <span className="cas__value">{casualtyView(board.a.injuries, board.a.race, mode).value}</span>
            <span className="cas__sep">/</span>
            <span className="cas__value">{casualtyView(board.b.injuries, board.b.race, mode).value}</span>
          </span>
        </div>
        <div className={`outlook outlook--${tone}`} aria-label="Match outlook">
          {signed(board.outlook)}
        </div>
      </footer>
    </article>
  )
}
