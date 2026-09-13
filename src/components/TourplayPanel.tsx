import { useState } from 'react'
import type { RoundController } from '../state/useRound'

function clock(iso: string | null | undefined): string {
  if (!iso) return 'never'
  // D1 stores "YYYY-MM-DD HH:MM:SS" in UTC with no zone marker.
  const date = new Date(iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z')
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

/**
 * Links the round to a Tourplay tournament and shows whether match state is
 * being pulled from it. Importing replaces the board line-up, so it always
 * previews first.
 */
export function TourplayPanel(controller: RoundController) {
  const {
    round,
    connection,
    followingTourplay,
    syncing,
    syncError,
    liveRound,
    syncNow,
    setFollowing,
    linkPreview,
    linkError,
    linking,
    previewLink,
    confirmLink,
    cancelLink,
  } = controller

  const [slug, setSlug] = useState('')
  const [open, setOpen] = useState(false)
  const link = round.tourplay
  const disabled = connection !== 'live'

  return (
    <section className="tp">
      <div className="tp__row">
        <span className={`tp__dot${followingTourplay ? ' is-live' : ''}`} aria-hidden="true" />

        <div className="tp__status">
          {link?.slug ? (
            <>
              <strong>{followingTourplay ? 'Following' : 'Linked to'}</strong> {link.slug}
              <span className="tp__meta">
                {followingTourplay
                  ? ` · synced ${clock(link.lastSyncedAt)}`
                  : ' · sync off, entering by hand'}
              </span>
            </>
          ) : (
            <>
              <strong>Not linked to Tourplay.</strong>
              <span className="tp__meta"> Scores are entered by hand.</span>
            </>
          )}
        </div>

        {link?.slug && (
          <>
            <button
              type="button"
              className="tp__btn"
              onClick={syncNow}
              disabled={disabled || syncing || !followingTourplay}
            >
              {syncing ? 'Syncing…' : 'Sync now'}
            </button>
            <button
              type="button"
              className="tp__btn"
              onClick={() => setFollowing(!followingTourplay)}
              disabled={disabled}
            >
              {followingTourplay ? 'Take over by hand' : 'Follow Tourplay'}
            </button>
          </>
        )}

        <button
          type="button"
          className="tp__btn"
          onClick={() => setOpen((v) => !v)}
          disabled={disabled}
          aria-expanded={open}
        >
          {link?.slug ? 'Change tournament' : 'Link a tournament'}
        </button>
      </div>

      {liveRound !== null && (
        <p className="tp__notice">
          Tourplay has moved on to <strong>round {liveRound}</strong>. This screen is showing an
          earlier round, so scores are not being pulled into it. Switch round at the top, or link
          the tournament again to import round {liveRound}.
        </p>
      )}

      {syncError && (
        <p className="tp__error" role="alert">
          Could not reach Tourplay — the last known scores are still shown. {syncError}
        </p>
      )}

      {open && !linkPreview && (
        <div className="tp__link">
          <label className="tp__label" htmlFor="tp-slug">
            Tourplay tournament — paste the URL or just its name from the address bar
          </label>
          <div className="tp__link-row">
            <input
              id="tp-slug"
              className="tp__input"
              value={slug}
              placeholder="copa-la-forja-2026"
              onChange={(event) => setSlug(event.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
            <button
              type="button"
              className="tp__btn tp__btn--primary"
              onClick={() => previewLink(slug.trim())}
              disabled={!slug.trim() || linking}
            >
              {linking ? 'Looking…' : 'Look it up'}
            </button>
          </div>
          {linkError && (
            <p className="tp__error" role="alert">
              {linkError}
            </p>
          )}
        </div>
      )}

      {linkPreview && (
        <div className="tp__preview">
          <p className="tp__preview-head">
            <strong>{linkPreview.tournament.name}</strong> · round {linkPreview.currentRound} ·{' '}
            {linkPreview.boards.length} boards
            {linkPreview.truncated > 0 && (
              <span className="tp__meta">
                {' '}
                · {linkPreview.truncated} further boards will not be imported (8 is the maximum)
              </span>
            )}
          </p>

          <ol className="tp__preview-list">
            {linkPreview.boards.map((b) => (
              <li key={b.board}>
                <span className="tp__pv-no">{b.board}</span>
                <span className="tp__pv-side">
                  {b.a.coach} <em>{b.a.race}</em>
                </span>
                <span className="tp__pv-v">v</span>
                <span className="tp__pv-side">
                  {b.b.coach} <em>{b.b.race}</em>
                </span>
              </li>
            ))}
          </ol>

          <p className="tp__warn">
            {linkPreview.effect}. Boards and outlooks for that round are replaced; other
            tournaments and rounds are left alone.
          </p>

          {linkError && (
            <p className="tp__error" role="alert">
              {linkError}
            </p>
          )}

          <div className="tp__preview-actions">
            <button type="button" className="tp__btn" onClick={cancelLink} disabled={linking}>
              Cancel
            </button>
            <button
              type="button"
              className="tp__btn tp__btn--primary"
              onClick={confirmLink}
              disabled={linking}
            >
              {linking ? 'Importing…' : `Import ${linkPreview.boards.length} boards`}
            </button>
          </div>
        </div>
      )}
    </section>
  )
}
