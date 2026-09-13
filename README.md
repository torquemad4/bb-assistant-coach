# Blood Bowl Round Coordinator

Tablet prototype for running a team Blood Bowl event from the coordinator's chair.
Two tabs: a read-only **Dashboard** showing every live board in the round, and a
**Match Control** tab holding every value a coordinator touches.

Built for a landscape tablet (≈1024–1400px). Dark, high contrast, 44px touch targets.

## Running it

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # production build into dist/
npm run typecheck
```

## The two tabs

**Dashboard** — one column per board, up to eight. Each column carries the team A
coach (NAF name + race) above the score, the team B coach below it, casualties
suffered by each side, and a first/second half pill. The frame across the bottom
gives the round-level number: a plain sum of all eight match outlooks, so it runs
from −8.0 to +8.0. The per-board strip beside it lets you read that sum back to
its parts.

**Match Control** — one row per board. Score, casualties and half are stepped here
(they stand in for the live feed, see below). The outlook stepper moves in 0.5
increments and clamps to −1.0 … +1.0; the arrow disables at each end rather than
silently no-opping. Positive outlook favours team A, negative favours team B.

## Shape of the code

| Path | What lives there |
| --- | --- |
| `src/types.ts` | Domain model, plus the outlook scale and its bounds |
| `src/data/round.ts` | The seed round — **the only file holding coach names** |
| `src/data/races.ts` | Blood Bowl 2020 races and their short tags |
| `src/state/useRound.ts` | Single source of truth; all mutation goes through here |
| `src/components/` | Dashboard, BoardCard, RoundOutlook, ControlPanel, Stepper |

Score, casualties and half are held as ordinary state in `useRound`, deliberately
separate from `outlook`. That split is the seam for the Tourplay integration:
a feed adapter replaces the seed values and pushes into the same setters, while
`outlook` stays coach-entered and never comes from the feed. `Board.tourplayMatchId`
is the join key, null while running on seed data.

## Known gaps in this prototype

- **The 16 coach names are invented, not real NAF coaches.** The brief asked for 16
  taken off the NAF website. The cloud environment this was built in runs a
  "Trusted" egress allowlist, so `thenaf.net` and `tourplay.net` are both refused
  at the proxy and no real records could be read. The handles are written in NAF
  style so the layout is judged at realistic name lengths, and `nafNumber` is left
  null rather than filled with a made-up number. Replacing them means editing
  `src/data/round.ts` and nothing else.
- **No persistence and no backend.** State resets on reload; `Reset round` restores
  the seed.
- **Races are fixed in the fixture.** Eight distinct per team, drawn at random once,
  with overlap between teams allowed — three races appear on both sides.

### Reaching NAF and Tourplay from a cloud session

Both domains have to be on the environment's network allowlist or the app cannot
fetch anything when it runs in Claude Code on the web. At claude.ai/code, open the
environment selector above the message box, edit the environment, set **Network
access** to **Custom**, and add:

```
thenaf.net
*.thenaf.net
tourplay.net
*.tourplay.net
```

Tick *"Also include default list of common package managers"*, or npm and GitHub
stop working. The change applies to sessions started afterwards — a running session
never re-reads it.
