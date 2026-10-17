# Rotations: who's up early, whose turn for bedtime

Household rotations on Home: who's up early with the kids, who puts whom to bed. A rotation with
`switchAt` is today's at the top of Today until then, and after it tomorrow's, under Tomorrow in
Upcoming (getting ready for the next day). One without (bedtime) is today's, last in Today.

**Needs:** nothing; it's optional, for households with turns to share. Nothing shows until you set
them, and there's no Setting for them: they're a Worker secret, so the names stay out of the repo.

```sh
printf '%s' '[
  {"name":"Up early with kids","icon":"sunrise","switchAt":"10:00",
   "days":{"mon":"Sam","tue":"Alex","wed":"Sam","thu":"Alex","fri":"Sam","sat":"Alex","sun":"Sam"}},
  {"name":"Bedtime","icon":"moon",
   "alternate":{"from":"2026-10-15","who":["Alex","Sam"],"what":["Mia","Leo"]}}
]' | npx wrangler secret put ROTATIONS
```

- `days` names someone per weekday; leave a day out to show nothing that day.
- `alternate` starts on `from` with `who[i]` on `what[i]`, and moves everyone on one each day, so
  two people swap nightly.
- `icon` is any icon name the dashboard has (`sunrise`, `moon`, `users`, …); `switchAt` is `HH:MM`.

The frame picks changes up within the hour (`GET /api/rotations`). Demo mode shows invented ones.
The logic is in `dashboard/src/lib/rotations.js`, with tests.
