interface StepperProps {
  /** Rendered between the two buttons. */
  display: string
  label: string
  onStep: (direction: 1 | -1) => void
  /** 'row' puts the two buttons either side; 'column' stacks them. */
  layout?: 'row' | 'column'
  /** Use ▲/▼ glyphs instead of −/+. */
  arrows?: boolean
  atMin?: boolean
  atMax?: boolean
  tone?: 'up' | 'down' | 'level' | 'plain'
  /** Tints the control in a team colour so an A/B pair is told apart at a glance. */
  team?: 'a' | 'b'
  /** Locks the control — used when the round could not be read from the database. */
  disabled?: boolean
}

/**
 * Touch-sized increment control. Buttons are 56px on their short edge so they
 * stay hittable with a finger on a tablet in a noisy hall.
 */
export function Stepper({
  display,
  label,
  onStep,
  layout = 'row',
  arrows = false,
  atMin = false,
  atMax = false,
  tone = 'plain',
  team,
  disabled = false,
}: StepperProps) {
  const up = (
    <button
      type="button"
      className="stepper__btn stepper__btn--up"
      onClick={() => onStep(1)}
      disabled={disabled || atMax}
      aria-label={`Increase ${label}`}
    >
      {arrows ? '▲' : '+'}
    </button>
  )

  const down = (
    <button
      type="button"
      className="stepper__btn stepper__btn--down"
      onClick={() => onStep(-1)}
      disabled={disabled || atMin}
      aria-label={`Decrease ${label}`}
    >
      {arrows ? '▼' : '−'}
    </button>
  )

  const value = (
    <output className={`stepper__value stepper__value--${tone}`} aria-label={label}>
      {display}
    </output>
  )

  return (
    <div className={`stepper stepper--${layout}${team ? ` stepper--team-${team}` : ''}`}>
      {layout === 'column' ? (
        <>
          {up}
          {value}
          {down}
        </>
      ) : (
        <>
          {down}
          {value}
          {up}
        </>
      )}
    </div>
  )
}
