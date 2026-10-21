# dashboard

The dashboard itself: the web app the frame shows, and the Cloudflare Worker behind it. Always
needed; everything else in the repo is optional.

| Folder | What it is |
| --- | --- |
| `src/` | The web app (Svelte 5, no SvelteKit): Home, Calendar, Lists, Recipes, Media and House tabs, the doorbell pop-up, the clock screen. Built for the frame's old WebView: see the rules in [CLAUDE.md](../CLAUDE.md). |
| `worker/` | The Worker that serves the app and its API: calendars, weather, lists, photos, recipes, notices, messages, the frame's check-ins, and the Mac bridge's routes. Every credential for those services lives here as a secret, never on the frame. |
| `ops/` | The optional status page: a second Worker behind GitHub sign-in ([docs/frame.md](../docs/frame.md#status-page-optional)). |
| `scripts/` | Day-to-day tools: `push-secrets.sh` (`.dev.vars` to the Worker), `frame-url.sh` (the frame's one-time setup link), `frame-status.sh` (what the frame last reported, its event log, `--now`, `--reload`), helpers for Spotify, Paprika and icons, `smoke.mjs` (opens every screen of a new build on the real data and in demo mode, and fails on any error; `npm run deploy` runs it first), `check.sh` and `deploy.sh` (what `npm run check` and `npm run deploy` run, here and in Cloudflare's builds), and `check-private.sh` (run `install-hooks.sh` once per clone: every commit and push is then checked for the household details listed in the gitignored `.private-terms`). |

## Run, test, deploy

```
npm install
npm run dev        # http://localhost:5173/#key=<DASHBOARD_KEY from .dev.vars>, or Settings → Demo mode
npm test           # the Worker, the app's logic and the status page
npm run deploy     # from this Mac when there's anything not in GitHub's main; else says Cloudflare deploys it
npm run deploy -- --local   # from this Mac whatever: checks (tests, build, smoke), deploy, live site, frame reload, rollback
npm run check      # just the checks (scripts/check.sh)
npx wrangler deploy --config ops/wrangler.jsonc   # the status page
```

Settings and secrets go in the gitignored `.dev.vars` (and `.frame.vars` for the frame's own), then
`scripts/push-secrets.sh`. The README's [Getting started](../README.md#getting-started) has the
first deploy; each feature's page in [docs/](../docs) has its settings.

## Builds in Cloudflare

Cloudflare's Workers Builds can deploy `main` on every push, with the same checks as this Mac (free
plan: 3,000 build minutes a month; a build is a few minutes). In the dashboard, Workers →
kitchen-frame → Settings → Builds → Connect, pick this repository (the Cloudflare GitHub app, for it
alone), then:

| Setting | Value |
| --- | --- |
| Branch | `main` (non-production branch builds off) |
| Root directory | `dashboard` |
| Build command | `npm ci && scripts/check.sh` |
| Deploy command | `scripts/deploy.sh --cloud` |
| Build variables | `DASHBOARD_URL` (the Worker's address); `FRAME_STATUS_KEY`, encrypted: `scripts/device-token.sh deploy` puts a key on the clipboard that reads the frame's status and reloads it, nothing else |

A failing test or build stops the deploy; after it, the live site and the frame are checked and a
frame that got the reload but doesn't come up on the new build is rolled back, as from this Mac. The
smoke test needs Chrome, which the build machines don't have, so it runs only here.

