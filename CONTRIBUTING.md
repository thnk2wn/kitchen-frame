# Contributing

Thanks for helping! This is a hobby project for a family wall display, so changes are judged by
one question: does it stay calm, readable and fast on a cheap photo frame?

## Set up

```sh
cd dashboard
npm install
cp .dev.vars.example .dev.vars   # fill in what you have; everything is optional
npm run dev                      # open http://localhost:5173/?key=<DASHBOARD_KEY from .dev.vars>
```

No accounts? Turn on **Settings → Demo mode**: invented calendar, tasks and groceries, nothing
reaches Todoist.

## Before you open a pull request

```sh
cd dashboard
npm test        # Worker and calendar tests (node:test, no network)
npm run build   # must build without new warnings
```

- **Target the frame, not your laptop.** It runs Android WebView 106 on a slow CPU and GPU: no
  `oklch()`, `color-mix()`, CSS nesting, `:has()` or 4/8-digit hex colours; flat fills (no shadows,
  blurs or filters); keep the `chrome106` / `chrome61` build targets. See `CLAUDE.md`.
- **Check UI changes at 1280×720** (the frame's CSS viewport), in light and dark, ideally in demo
  mode, and attach a screenshot to the PR.
- **Poll only what's on screen.** Use the existing `every()`, `single()` and `changed()` helpers in
  `dashboard/src/lib/` instead of new timers.
- **Never commit secrets or personal data**: tokens, calendar links, album links, addresses,
  real names or photos. `.dev.vars`, `.prod.vars` and `.frame.vars` are gitignored for that reason.
- Keep docs in step: `README.md`, `docs/*.md` for behaviour, and `CREDITS.md` for anything that
  needs attribution.

## Pull requests

1. Fork (or branch), make focused changes, and open a PR against `main`.
2. CI runs the tests and builds the dashboard and the kiosk APK; it must pass.
3. PRs are squash-merged, so the PR title becomes the commit message: write it as a short summary
   of the change.

By contributing you agree that your contribution is licensed under the [MIT License](LICENSE).
