import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { cloudflare } from '@cloudflare/vite-plugin';

// Most cheap frames run Android 6 and top out at WebView 106 (Chromium M106 was the last for API 23).
// cssTarget is lower on purpose: that WebView rejects 4/8-digit hex colours, and a newer target
// lets the minifier rewrite rgba() into that form (found on-device in wesbos/photo-frame-dashboard).
export default defineConfig({
  plugins: [svelte(), cloudflare()],
  // When this build was made, shown beside the version in Settings → About.
  define: { __BUILT_AT__: JSON.stringify(new Date().toISOString()) },
  build: {
    target: 'chrome106',
    cssTarget: 'chrome61',
  },
  // allowedHosts: lets bb's remote port share (*.getbb.app) reach the dev server.
  server: { host: true, allowedHosts: ['.getbb.app'] },
});
