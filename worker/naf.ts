/**
 * The NAF handle for a coach, rather than whatever Tourplay shows.
 *
 * Tourplay displays `userNameToShow`, which is whatever the coach typed into
 * their profile. For some that is their NAF handle; for plenty it is their real
 * name — "Silvio Phoenix Pergreffi" on Tourplay is Phoenix11 on NAF, "Matteo
 * Diegoli" is Matte8. A dashboard read across a hall wants the handle, because
 * that is the name on the fixture list, in the scouting, and in what everyone
 * calls each other.
 *
 * Tourplay's fixture payload carries no NAF field at all, so the chain is:
 * the player's Tourplay id, which the inscriptions endpoint maps to a NAF
 * number, which the Scout engine maps to the canonical handle.
 */

import { engineBase } from './scout'

/** The engine's lightest endpoint that names a coach — 391 bytes of it. */
const REPORT_TIMEOUT_MS = 20_000

/**
 * Picks the name to show.
 *
 * Case is deliberately not imposed. NAF stores handles as they were typed years
 * ago and is inconsistent about it — torquemada, greenskinphil, thulean and
 * KFoged are all NAF's own spelling of handles this app already had right — so
 * taking NAF's casing wholesale would make eight correct names worse to fix two
 * wrong ones. A difference of case is not the problem this solves; a real name
 * standing in for a handle is.
 */
export function chooseName(stored: string, naf: string | null | undefined): string {
  const current = (stored ?? '').trim()
  const handle = (naf ?? '').trim()
  if (!handle) return current
  if (!current) return handle
  if (current.toLowerCase() === handle.toLowerCase()) return current
  return handle
}

/**
 * Canonical NAF handles for a set of NAF numbers.
 *
 * One request per coach, all in flight together — sixteen small reads against a
 * service that takes about a second each, so serially it would be a visible
 * wait on an import.
 *
 * Never throws. A coach the engine cannot answer for is simply absent from the
 * map, and `chooseName` then keeps whatever the board already had: an import
 * must not fail, or blank a line-up, because a scouting service is down.
 */
export async function nafHandles(
  numbers: (number | null | undefined)[],
  base?: string,
): Promise<Map<number, string>> {
  const wanted = [...new Set(numbers.filter((n): n is number => typeof n === 'number' && n > 0))]
  const found = new Map<number, string>()
  if (wanted.length === 0) return found

  const root = engineBase(base)
  await Promise.all(
    wanted.map(async (id) => {
      try {
        const response = await fetch(`${root}/coaches/${id}/report?scope=competitive`, {
          signal: AbortSignal.timeout(REPORT_TIMEOUT_MS),
          headers: { accept: 'application/json' },
        })
        if (!response.ok) return
        const body = (await response.json()) as { coach_name?: string }
        if (body?.coach_name) found.set(id, String(body.coach_name).trim())
      } catch {
        // Down, slow, or no such coach. The board keeps the name it has.
      }
    }),
  )
  return found
}
