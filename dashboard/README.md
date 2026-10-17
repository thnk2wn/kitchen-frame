# dashboard

The dashboard itself: the web app the frame shows, and the Cloudflare Worker behind it. Always
needed; everything else in the repo is optional.

| Folder | What it is |
| --- | --- |
| `src/` | The web app (Svelte 5, no SvelteKit): Home, Calendar, Lists, Recipes, Media and House tabs, the doorbell pop-up, the clock screen. Built for the frame's old WebView: see the rules in [CLAUDE.md](../CLAUDE.md). |
| `worker/` | The Worker that serves the app and its API: calendars, weather, lists, photos, recipes, notices, messages, the frame's check-ins, and the Mac bridge's routes. Every credential for those services lives here as a secret, never on the frame. |
| `ops/` | The optional status page: a second Worker behind GitHub sign-in ([docs/frame.md](../docs/frame.md#status-page-optional)). |
| `scripts/` | Day-to-day tools: `push-secrets.sh` (`.dev.vars` to the Worker), `frame-url.sh` (the frame's one-time setup link), `frame-status.sh` (what the frame last reported, its event log, `--now`, `--reload`), and helpers for Spotify, Paprika and icons. |

## Run, test, deploy

```
npm install
npm run dev        # http://localhost:5173/?key=<DASHBOARD_KEY from .dev.vars>, or Settings → Demo mode
npm test           # the Worker, the app's logic and the status page
npm run deploy     # build and deploy the Worker (the frame reloads on its own, or scripts/frame-status.sh --reload)
npx wrangler deploy --config ops/wrangler.jsonc   # the status page
```

Settings and secrets go in the gitignored `.dev.vars` (and `.frame.vars` for the frame's own), then
`scripts/push-secrets.sh`. The README's [Getting started](../README.md#getting-started) has the
first deploy; each feature's page in [docs/](../docs) has its settings.
