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

## Deploying to coordinator.englandbb.co.uk

Deploys as a **static-asset Worker** (no server code — `dist/` is served directly).
Config is in `wrangler.jsonc`; the custom domain is declared there, so wrangler
creates the DNS record itself on first deploy.

```bash
npm run cf-login   # once per machine — opens a browser to authorise wrangler
npm run deploy     # builds, then wrangler deploy
```

Three things have to be true before that works:

1. **The `englandbb.co.uk` zone must sit on the Cloudflare account you authorise,
   on Cloudflare nameservers.** Workers custom domains — unlike Pages — do not
   support a domain whose nameservers Cloudflare does not manage. If the domain is
   on someone else's account, drop the `routes` block and have whoever runs DNS
   point a CNAME at the `workers.dev` hostname instead.
2. **`coordinator.englandbb.co.uk` must have no existing CNAME record.** Cloudflare
   refuses to create a custom domain over one. Delete it first if it exists —
   wrangler will add its own record.
3. **You must run it from a machine with network access to `api.cloudflare.com`.**
   It cannot be run from a Claude Code cloud session on the default *Trusted*
   network policy — that allowlist refuses `api.cloudflare.com` at the egress
   proxy. Add it under **Custom** (see the bottom of this README) to deploy from a
   cloud session.

To deploy without the custom domain — useful for a first smoke test — delete the
`routes` block and run `npm run deploy`; the app lands on
`bb-round-coordinator.<your-subdomain>.workers.dev`.

## The two tabs

**Dashboard** — one column per board, up to eight. Each column carries the England
coach (flag, NAF name, race) above the score, the Italy coach below it, casualties
suffered by each side, and a first/second half pill. The frame across the bottom
gives the round-level number: a plain sum of all eight match outlooks, so it runs
from −8.0 to +8.0. The per-board strip beside it lets you read that sum back to
its parts.

**Match Control** — one row per board. Score, casualties and half are stepped here
(they stand in for the live feed, see below). The outlook stepper moves in 0.5
increments and clamps to −1.0 … +1.0; the arrow disables at each end rather than
silently no-opping. Positive outlook favours team A, negative favours team B.

## Teams and colour

The fixture is locked to **England v Italy**. England is team A (positive outlook
favours them), Italy is team B.

The team colours have to sit next to the semantic red/green that mean *behind* and
*ahead*, so they are separated on both hue and saturation, and by role:

| Role | Token | Value | |
| --- | --- | --- | --- |
| England | `--team-a` | `#b8616c` | muted brick-rose, hue 352° |
| "behind" signal | `--down` | `#f85149` | vivid orange-red, hue 3° |
| Italy | `--team-b` | `#50956d` | muted sage, hue 145° |
| "ahead" signal | `--up` | `#3fb950` | vivid green, hue 128° |

Team colours only ever appear as edge rules and low-alpha washes; the signal
colours only ever appear as solid filled chips. Keep that split if you add
anything — it is what stops a red England column reading as a losing table.

Flags are inline SVG in `src/components/Flag.tsx`; adding a nation means adding a
case there and a member to `CountryCode`.

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

- **`nafNumber` is null for every coach.** No NAF numbers were available; they are
  left null rather than filled with made-up values.
- **Italy's races are placeholders.** The eight coach names are as given; their
  races are the randomly drawn set the prototype started with. England's races are
  as specified.
- **No persistence and no backend.** State resets on reload; `Reset round` restores
  the seed.

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
api.cloudflare.com
```

`api.cloudflare.com` is only needed if you want to run `npm run deploy` from a
cloud session rather than your own machine.

Tick *"Also include default list of common package managers"*, or npm and GitHub
stop working. The change applies to sessions started afterwards — a running session
never re-reads it.
