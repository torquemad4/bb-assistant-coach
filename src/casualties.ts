import type { CasualtyMode } from './types'

/**
 * Reading a board's casualties as removals taken, or as players still on the pitch.
 *
 * The stored number is always casualties suffered — that is what Tourplay feeds
 * and what a finished round means forever. Players on pitch is a reading applied on
 * top: squad size − casualties. Keeping it that way round means switching the
 * mode never rewrites history, and a round entered last week still makes sense
 * under either heading.
 *
 * The consequence to keep in mind is that the stepper inverts: in players mode
 * "+" means one fewer casualty. That is handled here rather than in each
 * component, because getting it backwards in one place and not the other is how
 * a board ends up reading 9 on the tablet and 2 on a phone.
 */

/** A full Blood Bowl team on the pitch. */
export const SQUAD_DEFAULT = 11

/** Snotlings field more bodies than anyone else, and are the only side that do. */
export const SQUAD_SNOTLING = 14

/**
 * How many players this race puts on the pitch at kick-off.
 *
 * Derived from the race already on the board rather than configured per team:
 * there is nothing for a coordinator to set up, and nothing to get out of step
 * with the line-up.
 */
export function squadSize(race: string): number {
  return race === 'Snotling' ? SQUAD_SNOTLING : SQUAD_DEFAULT
}

export interface CasualtyView {
  /** The number to show. */
  value: number
  /** True when the down button should be dead. */
  atMin: boolean
  /** True when the up button should be dead — the cap the coordinator asked for. */
  atMax: boolean
}

/**
 * What to show for one side, and which ends of the range are spent.
 *
 * Removals are left uncapped, as they have always been. The cap belongs to the
 * players-on-pitch reading, where a team cannot field more than its squad.
 */
export function casualtyView(
  injuries: number,
  race: string,
  mode: CasualtyMode,
): CasualtyView {
  if (mode === 'players') {
    const squad = squadSize(race)
    const left = Math.max(0, Math.min(squad, squad - injuries))
    return { value: left, atMin: left <= 0, atMax: left >= squad }
  }
  return { value: injuries, atMin: injuries <= 0, atMax: false }
}

/**
 * Turns a press of the stepper into a change in casualties.
 *
 * In players mode the display counts the other way, so "+" — one more player
 * standing — is one fewer casualty.
 */
export function casualtyStep(direction: 1 | -1, mode: CasualtyMode): 1 | -1 {
  return mode === 'players' ? ((direction * -1) as 1 | -1) : direction
}

/** Wording for the pair of numbers, wherever they are labelled. */
export const CASUALTY_LABEL: Record<CasualtyMode, string> = {
  removals: 'Removals',
  players: 'Players on pitch',
}

/** The short form, for the dashboard card where there is no room for words. */
export const CASUALTY_TAG: Record<CasualtyMode, string> = {
  removals: 'CAS',
  players: 'PITCH',
}
