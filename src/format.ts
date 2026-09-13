/** Render an outlook or aggregate with an explicit sign, e.g. "+1.5", "0.0". */
export function signed(value: number): string {
  const fixed = value.toFixed(1)
  return value > 0 ? `+${fixed}` : fixed
}

/** Which way a number leans, for colour and arrow direction. */
export type Tone = 'up' | 'down' | 'level'

export function toneOf(value: number): Tone {
  if (value > 0) return 'up'
  if (value < 0) return 'down'
  return 'level'
}

/** Words for the round-level aggregate, scaled to the number of boards. */
export function aggregateVerdict(aggregate: number, range: number): string {
  if (range === 0) return 'No boards'
  const share = aggregate / range
  if (share >= 0.6) return 'Commanding'
  if (share >= 0.25) return 'Ahead'
  if (share > 0.05) return 'Edging it'
  if (share >= -0.05) return 'Line ball'
  if (share > -0.25) return 'Slipping'
  if (share > -0.6) return 'Behind'
  return 'Losing badly'
}
