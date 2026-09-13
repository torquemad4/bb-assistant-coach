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

### From CI (the normal path)

`.github/workflows/deploy.yml` builds and deploys on every push to the working
branch, and can be run by hand from the repo's **Actions** tab → *Deploy to
Cloudflare* → **Run workflow**.

It needs one repository secret, at **Settings → Secrets and variables → Actions →
New repository secret**:

| Secret | Value |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | A Cloudflare API token — see the permissions below |

Create the token at **dash.cloudflare.com → My Profile → API Tokens → Create
Token**, starting from the **Edit Cloudflare Workers** template. Then add one more
permission row before saving:

- **Zone → DNS → Edit**, scoped to `englandbb.co.uk`

The template covers deploying the Worker itself, but attaching a custom domain
writes a DNS record, and that needs DNS edit rights on the zone. Without it the
build succeeds and the deploy fails at the custom-domain step.

If the run fails with an error about more than one account being available, add a
second secret `CLOUDFLARE_ACCOUNT_ID` and pass it to the deploy step as
`accountId`.

### Who can see the site

The deployed site is **not public** — it sits behind Cloudflare Access as a
self-hosted application on `coordinator.englandbb.co.uk`, managed at
`one.dash.cloudflare.com` → **Access controls** → **Applications**.

Protecting the hostname is sufficient here: `wrangler.jsonc` declares a route, so
the Worker has exactly one trigger and no `workers.dev` hostname to leave exposed.
If a `workers.dev` URL or a second route is ever added, protect the Worker itself
instead, or that route bypasses this policy.

Access is an allowlist, and an application with no policy denies every request.
Visitors sign in with a one-time PIN emailed to them; no Cloudflare account is
needed. To add or remove someone, edit the policy's **Emails** include rule.

This is dashboard-managed, not in this repo. Moving it here — an allowlist file plus
a CI step that reconciles the Access app — needs the deploy token extended with
**Access: Apps and Policies → Edit**.

Deploys are unaffected: CI authenticates with the API token, not a browser session.

### From your own machine

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
3. **Deploying needs network access to `api.cloudflare.com`.** GitHub Actions has
   it. A Claude Code cloud session on the default *Trusted* network policy does
   not — that allowlist refuses the host at the egress proxy — so use CI, or add
   the host under **Custom** (see the bottom of this README).

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

## Persistence

The round lives in a Cloudflare **D1** database, `bb-coordinator`
(`505406d3-dc0a-4e94-ae30-17a295a506db`, Western Europe). The Worker exposes a
small API and the client saves explicitly — nothing is written while you tap.

| Route | Does |
| --- | --- |
| `GET /api/round` | Reads the whole round |
| `PUT /api/round` | Writes the match state of every board in one batch |

`run_worker_first: ["/api/*"]` in `wrangler.jsonc` routes those paths to the
Worker; everything else is served from `dist/` with SPA handling. Without that,
SPA fallback would return `index.html` for API calls.

**A save writes only the match state** — score, casualties, half, outlook. The
roster is in the same tables but is never written from the client, so editing a
coach directly in D1 cannot be reverted by a tablet still showing the old
line-up. Changing the roster is a SQL update, not a deploy.

The Worker validates every field before writing, and the tables carry matching
`CHECK` constraints, so a bad value is rejected in two places rather than stored.
A save is a single `batch`, so it lands whole or not at all.

**Unsaved work** is tracked by comparing on-screen state to what the server last
confirmed. Changed rows are outlined and dotted, the Save button counts them, and
closing the tab mid-edit warns. **Discard** reverts to the last saved state.

**Watchers** poll every 10s so a second device stays current. Polling pauses
while there are unsaved edits, so a refresh can never wipe work in progress.

If the API cannot be reached the app falls back to the committed fixture, shows a
banner, and disables editing — saving into a round it could not read would be
worse than not saving.

### Migrations

`migrations/` holds the schema and seed. Apply with:

```bash
npm run db:migrate          # --remote, the live database
npx wrangler d1 migrations apply bb-coordinator --local   # local dev copy
```

### Local development

```bash
npm run build
npx wrangler dev --local    # serves dist/ and the API against a local D1
```

## Following a live tournament

A round can be linked to a Tourplay tournament, after which score, casualties and
half are pulled from it instead of tapped in. **Outlook is never pulled** — it is
the coach's read on the match and stays manual in every mode.

On **Match Control**, the bar at the top shows the link. *Link a tournament* takes
a Tourplay slug (the name in its URL), **previews the pairings it would import**,
and only replaces the boards when you confirm. *Take over by hand* stops the sync
and unlocks the steppers; *Follow Tourplay* resumes it.

While following, the score, casualties and half steppers are **disabled** — editing
them by hand would be overwritten within ten seconds, so the UI does not pretend
otherwise.

| Route | Does |
| --- | --- |
| `POST /api/link` | `{slug}` previews the import; `{slug, confirm: true}` performs it |
| `POST /api/sync` | Pulls current match state |
| `POST /api/sync-mode` | `{enabled}` follows Tourplay, or goes manual |

Two things the import deliberately does:

- **Replaces every board** — pairings, coaches, races and match ids — and resets
  outlooks to zero. It previews first because of that.
- **Clears the team names and flags** to Home/Away. An imported round is not the
  previous fixture, and showing England and Italy flags over someone else's
  tournament would be worse than showing none. Set them afterwards with a SQL
  update if the event has two named squads.

Every viewer polls, so `POST /api/sync` **throttles**: if Tourplay was read less
than 8 seconds ago it returns the stored round untouched. Several tablets watching
does not mean several trips to Tourplay.

If Tourplay cannot be reached, the last known scores stay on screen and a message
appears — the round is never blanked because a fetch failed.

## Pulling squads from Tourplay

`scripts/fetch-tourplay.mjs` reads a tournament's squads and coaches from
Tourplay's public API.

```bash
npm run tourplay -- eurobowl-xvii
npm run tourplay -- https://tourplay.net/en/blood-bowl/eurobowl-xvii/players
npm run tourplay -- eurobowl-xvii --json data/eurobowl-xvii.json
```

It prints a summary and, with `--json`, writes the full structure: tournament
metadata plus every squad's coaches with NAF name, NAF number, country and coach
rank.

Things worth knowing about that API, since none of it is documented:

- **Tourplay 403s a default user-agent.** `robots.txt` is empty, so there is no
  scraping prohibition — it just expects browser headers, which the script sends.
- **The page is an Angular SPA**; the HTML has no data in it. The endpoints were
  read out of the JS bundle.
- **`api/inscriptions/{slug}` requires a logged-in account** (401). The
  per-category variant the script uses is public.
- **Races are absent until rosters are submitted**, close to the event. Before
  then `roster.teamName` is just the squad's name, not a Blood Bowl team.
- A tournament's `coachesRegistered` count can exceed the coaches actually
  listed; the difference appears to be unconfirmed registrations, which the
  public endpoint does not expose. The script says so when the numbers disagree.
- Node's built-in `fetch` ignores `HTTPS_PROXY`. Inside a Claude Code cloud
  session, run it as `NODE_USE_ENV_PROXY=1 npm run tourplay -- <slug>`.

The live match state comes from two calls, both verified on 13 Sep 2026 against a
tournament that was mid-round:

- `api/tournament/{slug}/phase-status` → the phase id
- `api/tournament/{slug}/phases?phaseId={id}` → every board's score, casualties,
  both coaches, both races and `matchId`
- `api/match/{matchId}` → `turn.half`, plus the turn number and whose turn it is

Half is the only field needing a call per board, so a full refresh of 8 boards is
9 requests.

## Shape of the code

| Path | What lives there |
| --- | --- |
| `src/types.ts` | Domain model, plus the outlook scale and its bounds |
| `src/data/round.ts` | The seed round — **the only file holding coach names** |
| `src/data/races.ts` | Blood Bowl 2020 races and their short tags |
| `src/state/useRound.ts` | Single source of truth; load, dirty tracking, save, polling |
| `src/api.ts` | Typed client for the two API routes |
| `worker/index.ts` | The API — validation and D1 access |
| `worker/tourplay.ts` | Reads live match state from Tourplay |
| `migrations/` | Schema and seed |
| `scripts/fetch-tourplay.mjs` | Pulls squads and coaches from Tourplay |
| `src/components/` | Dashboard, BoardCard, RoundOutlook, ControlPanel, Stepper |

Score, casualties and half are held separately from `outlook`, which is the seam
for the Tourplay integration: a feed adapter writes the match state — ideally
straight into D1 — while `outlook` stays coach-entered and never comes from the
feed. `Board.tourplayMatchId` is the join key, null until a feed fills it in.

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
