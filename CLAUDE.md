# Photo Frame Dashboard

A dashboard web app for a rooted Android photo frame. Read `docs/research.md` before changing
`dashboard/`.

## Target device

- Our frame: Pastigio FRAME156, Android 8.1, WebView 138 (swapped in from the vendor's 106,
  `docs/webview.md`), Rockchip RK3326, 2 GB RAM (flagged low-RAM by the firmware), Mali-G31,
  1920×1080 shown as 1280×720 CSS px at DPR 1.5, Wi-Fi around 1 Mbit/s (details in `docs/frame.md`).
- Design for the upstream floor too: Android 6, WebView 106 at best, quad-core Cortex-A7,
  Mali-400, 1280×800 at DPR 1.
- Don't use `oklch()`, `color-mix()`, CSS nesting, `:has()`, or 4/8-digit hex colours.
- Keep `build.target: 'chrome106'` and `cssTarget: 'chrome61'` in `dashboard/vite.config.js`.
- UI is Svelte 5 (no SvelteKit). Add a dependency only when it clearly earns its weight on this CPU.
- Render only the active tab (`{#if}`), not hidden views.

## Performance rules

- Measure with `?diag` (fps, jank, DOM count, image megapixels, heap) before and after a change, and
  on the frame with `dashboard/scripts/bench/` (tab-switch times, scrolling, memory).
- Animate only `transform` and `opacity`. Avoid `filter`, `backdrop-filter`, large blurs and large
  `box-shadow`s, which the Mali-400 struggles to paint.
- Serve images at display size. Never decode a full-resolution phone photo on the frame.
- No per-second timers when a per-minute one will do. Stop timers and animations for hidden views.
- Format dates and times with `formatDate` / `time` from `lib/format.js` (one cached `Intl` formatter per
  format), not `toLocaleDateString` / `toLocaleTimeString`, which build a new one per call: on the frame
  that was about 80 ms of opening Home. Same for sorting: a shared `Intl.Collator`, not `localeCompare`
  with options.

## Reference

`reference/photo-frame-dashboard/` is the upstream repo (gitignored). The device guides are in its
`docs/`. Our kiosk app is in `kiosk/` (upstream's is in its `dashboard/kiosk/`).
