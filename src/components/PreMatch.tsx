import { RACE_TAG, type Race } from '../data/races'
import { Flag } from './Flag'
import {
  gameCount,
  rateLabel,
  recordLabel,
  type ScoutBoard,
  type ScoutCoach,
  type ScoutFormGame,
  type ScoutRecord,
} from '../scout'
import type { RoundController } from '../state/useRound'
import { TAGS, TAG_LABEL, type Board, type CountryCode, type Side, type Tag } from '../types'

/** Fewer games than this and the figure is marked as a small sample. */
const THIN_SAMPLE = 5

function raceTag(race: string): string {
  return RACE_TAG[race as Race] ?? race.slice(0, 4).toUpperCase()
}

interface StatProps {
  label: string
  record: ScoutRecord | null | undefined
}

/** One record row: what it measures, the W/D/L, and the rate. */
function Stat({ label, record }: StatProps) {
  const games = gameCount(record)
  const thin = record != null && games > 0 && games < THIN_SAMPLE
  return (
    <div className={`pm-stat${record ? '' : ' pm-stat--empty'}`}>
      <span className="pm-stat__label">{label}</span>
      <span className="pm-stat__record">{recordLabel(record)}</span>
      <span className="pm-stat__rate">
        {rateLabel(record?.winRate)}
        {thin && (
          <span className="pm-stat__thin" title={`Only ${games} games`}>
            *
          </span>
        )}
      </span>
    </div>
  )
}

function Form({ games }: { games: ScoutFormGame[] | undefined }) {
  // No strip at all rather than a line saying there is no strip. The engine has
  // no last-N-games endpoint yet, so this is every coach on every board, and on
  // a tablet sixteen dead lines are sixteen lines of a card that had to scroll.
  // An absent strip claims nothing; the scouted line already says where the
  // figures came from.
  if (!games || games.length === 0) return null
  return (
    <div className="pm-form" aria-label="Recent form, most recent first">
      {games.slice(0, 10).map((g, i) => (
        <span
          key={`${g.date}-${i}`}
          className={`pm-pip pm-pip--${g.result.toLowerCase()}`}
          title={`${g.result} ${g.scoreFor}-${g.scoreAgainst} v ${g.opponent} (${g.opponentRace}), ${g.date}`}
        >
          {g.result}
        </span>
      ))}
    </div>
  )
}

interface CoachBlockProps {
  side: Side
  team: 'a' | 'b'
  country: CountryCode | null
  scout: ScoutCoach | null | undefined
  oppRace: string
}

function CoachBlock({ side, team, country, scout, oppRace }: CoachBlockProps) {
  const opp = raceTag(oppRace)
  return (
    <div className={`pm-coach pm-coach--${team}`}>
      <div className="pm-coach__head">
        <Flag country={country} />
        <span className="pm-coach__name" title={side.nafName}>
          {side.nafName}
        </span>
        <span className="pm-coach__race">{side.race}</span>
      </div>

      <div className="pm-rating">
        <span className="pm-rating__value">{scout?.ratingWithRace?.toFixed(1) ?? '—'}</span>
        <span className="pm-rating__sep">/</span>
        <span className="pm-rating__max">{scout?.ratingMax?.toFixed(1) ?? '—'}</span>
        <span className="pm-rating__note">
          {scout?.ratingMaxRace ? `best: ${scout.ratingMaxRace}` : 'rating / best'}
        </span>
      </div>

      <Stat label="With race" record={scout?.withRace} />
      <Stat label="vs 200+" record={scout?.withRaceVs200} />
      <Stat label={`vs ${opp}`} record={scout?.vsOppRace} />
      <Stat label={`vs ${opp} 200+`} record={scout?.vsOppRaceVs200} />

      <Form games={scout?.form} />
    </div>
  )
}

interface CardProps {
  board: Board
  scout: ScoutBoard | undefined
  controller: RoundController
  countryA: CountryCode | null
  countryB: CountryCode | null
  /** Where this board sits in the row, for the ends of the move arrows. */
  index: number
  count: number
}

function PreMatchCard({ board, scout, controller, countryA, countryB, index, count }: CardProps) {
  const { tagBoard, unlockBoard, moveBoard, tagging, reordering, isDirty, connection } = controller
  const locked = board.tagLocked
  // Both tagging and reordering write straight through, so both would lose
  // unsaved match edits to the server's copy. Neither is offered while dirty.
  const disabled = connection !== 'live' || tagging || reordering || isDirty
  const matchup = scout?.matchup

  return (
    <article className={`pm-card${locked ? ' pm-card--locked' : ''}`}>
      <header className="pm-card__head">
        <span className="pm-order">
          <button
            type="button"
            className="pm-move"
            onClick={() => moveBoard(board.id, -1)}
            disabled={disabled || index === 0}
            aria-label={`Move board ${board.id} left`}
            title="Move this pairing one board to the left"
          >
            ◀
          </button>
          <span className="pm-card__no">B{board.id}</span>
          <button
            type="button"
            className="pm-move"
            onClick={() => moveBoard(board.id, 1)}
            disabled={disabled || index === count - 1}
            aria-label={`Move board ${board.id} right`}
            title="Move this pairing one board to the right"
          >
            ▶
          </button>
        </span>

        {locked && board.tag ? (
          <span className="pm-card__locked">
            <span className={`tag tag--${board.tag}`}>{TAG_LABEL[board.tag]}</span>
            <button
              type="button"
              className="pm-unlock"
              onClick={() => unlockBoard(board.id)}
              disabled={disabled}
              title="Reopen this board — the tag and its outlook stay as they are"
            >
              Unlock
            </button>
          </span>
        ) : (
          <span className="pm-tags" role="group" aria-label={`Board ${board.id} tag`}>
            {TAGS.map((tag: Tag) => (
              <button
                key={tag}
                type="button"
                className={`pm-tag-btn${board.tag === tag ? ' is-active' : ''}`}
                onClick={() => tagBoard(board.id, tag)}
                disabled={disabled}
                title={`${TAG_LABEL[tag]} — starts this board's outlook at ${
                  tag === 'swing' ? '−0.5' : tag === 'anchor' ? '0' : '+0.5'
                }`}
              >
                {TAG_LABEL[tag]}
              </button>
            ))}
          </span>
        )}
      </header>

      <CoachBlock
        side={board.a}
        team="a"
        country={countryA}
        scout={scout?.a}
        oppRace={board.b.race}
      />

      <div className="pm-matchup">
        <span className="pm-matchup__races">
          {raceTag(board.a.race)} <em>v</em> {raceTag(board.b.race)}
        </span>
        <span className="pm-matchup__rate">{rateLabel(matchup?.winRate)}</span>
        <span className="pm-matchup__note">
          {matchup?.games ? `${matchup.games.toLocaleString()} games` : 'Euro rules, home side'}
        </span>
      </div>

      <CoachBlock
        side={board.b}
        team="b"
        country={countryB}
        scout={scout?.b}
        oppRace={board.a.race}
      />
    </article>
  )
}

/** Tab three: the pre-round read on every board, and where boards get tagged. */
export function PreMatch(controller: RoundController) {
  const {
    round,
    isDirty,
    refreshScout,
    scouting,
    scoutError,
    scoutSkipped,
    scoutedCount,
    enginePing,
    pingEngine,
    pinging,
    matchupReport,
    connection,
  } = controller
  const scout = round.scout
  const byBoard = new Map((scout?.boards ?? []).map((b) => [b.boardId, b]))

  // Every seat that failed for want of a NAF number can be retried with a name
  // lookup; anything else (an engine error, a vacant opponent) cannot.
  const missingNumbers = scoutSkipped.filter((s) => s.reason.startsWith('no NAF number'))

  // When the engine is down every seat fails the same way, and sixteen copies
  // of one sentence hide what happened. One line per distinct reason, with the
  // seats it hit named underneath.
  const byReason = new Map<string, typeof scoutSkipped>()
  for (const skip of scoutSkipped) {
    const seats = byReason.get(skip.reason)
    if (seats) seats.push(skip)
    else byReason.set(skip.reason, [skip])
  }
  const seatLabel = (skip: (typeof scoutSkipped)[number]) =>
    `${skip.boardId}${skip.side.toUpperCase()} ${skip.coach.trim()}`

  return (
    <div className="pm">
      <div className="pm__bar">
        <p className="pm__hint">
          Tag each board before the round starts. <strong>Swing</strong> opens at −0.5,{' '}
          <strong>Anchor</strong> at 0, <strong>Bonus</strong> at +0.5. Tagging locks the board;
          unlocking is deliberate. The arrows move a pairing along the row — coaches, tag and
          scouting travel with it.
        </p>
        <span className="pm__scouted">
          <span className="pm__scouted-when" title={scout?.vs200Basis}>
            {scout
              ? `Scouted ${new Date(scout.generatedAt).toLocaleString([], {
                  day: 'numeric',
                  month: 'short',
                  hour: '2-digit',
                  minute: '2-digit',
                })}`
              : 'No scouting yet for this round'}
          </span>
          {scout?.dataDate && <span className="pm__data-date">NAF data {scout.dataDate}</span>}
          <button
            type="button"
            className="pm__pull"
            onClick={() => refreshScout(false)}
            disabled={scouting || connection !== 'live'}
            title="Pull fresh scouting from the NAF Scout engine"
          >
            {scouting ? 'Scouting…' : scout ? 'Re-scout' : 'Scout this round'}
          </button>
        </span>
      </div>

      {isDirty && (
        <p className="pm__blocked">
          Unsaved match edits on the control tab. Save or discard them before tagging or
          reordering — both write straight to the database and would take the saved scores back.
        </p>
      )}

      {matchupReport?.error && (
        <p className="pm__note">
          {matchupReport.source ? (
            <>
              <strong>Race matchups from {matchupReport.source}.</strong> The live source could not
              be read ({matchupReport.error}), so these figures are not today's.
            </>
          ) : (
            <>
              <strong>Race matchups unavailable.</strong> {matchupReport.error} — the figure between
              each pair of coaches shows as a dash.
            </>
          )}
        </p>
      )}

      {scoutError && (
        <p className="pm__error">
          <strong>Scouting failed.</strong> {scoutError}
        </p>
      )}

      {scoutSkipped.length > 0 && (
        <div className="pm__skipped">
          <p className="pm__skipped-head">
            {scoutedCount === 0
              ? 'No coach could be scouted:'
              : `Scouted ${scoutedCount}, but ${scoutSkipped.length} seat${
                  scoutSkipped.length === 1 ? '' : 's'
                } could not be:`}
          </p>
          <ul>
            {[...byReason].map(([reason, seats]) => (
              <li key={reason}>
                <strong>
                  {seats.length} seat{seats.length === 1 ? '' : 's'}
                </strong>{' '}
                — {reason}
                <span className="pm__skipped-who">{seats.map(seatLabel).join(' · ')}</span>
              </li>
            ))}
          </ul>

          <div className="pm__skipped-actions">
            {missingNumbers.length > 0 && (
              <button
                type="button"
                className="pm__pull"
                onClick={() => refreshScout(true)}
                disabled={scouting || connection !== 'live'}
                title="Ask the engine to find these coaches by NAF name. Only an exact, unambiguous match is used."
              >
                Try matching {missingNumbers.length} by name
              </button>
            )}
            <button
              type="button"
              className="pm__pull"
              onClick={pingEngine}
              disabled={pinging || connection !== 'live'}
              title="Ask the Scout engine whether it is answering at all"
            >
              {pinging ? 'Testing…' : 'Test the engine'}
            </button>
          </div>

          {enginePing && (
            <p className={`pm__ping${enginePing.ok ? ' pm__ping--ok' : ''}`}>
              <strong>{enginePing.ok ? 'Engine is up.' : 'Engine is not answering.'}</strong>{' '}
              {enginePing.health}
              {enginePing.base && <span className="pm__ping-base">{enginePing.base}</span>}
              {enginePing.version && <span className="pm__ping-base">{enginePing.version}</span>}
            </p>
          )}
        </div>
      )}

      {!scout && (
        <p className="pm__empty">
          No scouting for this round yet. Press <strong>Scout this round</strong> to pull it from
          the NAF Scout engine. Boards can be tagged either way — every figure below shows as a
          dash until scouting arrives.
        </p>
      )}

      <div className="pm__grid">
        {round.boards.map((board, index) => (
          <PreMatchCard
            key={board.id}
            board={board}
            scout={byBoard.get(board.id)}
            controller={controller}
            countryA={round.teamA.country}
            countryB={round.teamB.country}
            index={index}
            count={round.boards.length}
          />
        ))}
      </div>
    </div>
  )
}
