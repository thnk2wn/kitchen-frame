import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { cloudflare } from '@cloudflare/vite-plugin';
import { execSync } from 'node:child_process';

// The release, from git at build time: "v1.2.0" on a tag, "v1.2.0+3 (a1b2c3d)" three commits past it,
// with "*" when the tree had uncommitted changes. Shown in Settings → About, reported by the frame's
// check-in and on the status page. Tag a release with `git tag vX.Y.Z` (and push the tag).
function release() {
  try {
    const d = execSync('git describe --tags --always --dirty=*', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    const m = /^(v\d+\.\d+\.\d+)(?:-(\d+)-g([0-9a-f]+))?(\*?)$/.exec(d);
    if (!m) return d; // no tag yet: the short hash
    return m[1] + (m[2] ? '+' + m[2] + ' (' + m[3] + ')' : '') + m[4];
  } catch { return 'dev'; }
}

// Most cheap frames run Android 6 and top out at WebView 106 (Chromium M106 was the last for API 23).
// cssTarget is lower on purpose: that WebView rejects 4/8-digit hex colours, and a newer target
// lets the minifier rewrite rgba() into that form (found on-device in wesbos/photo-frame-dashboard).
export default defineConfig({
  plugins: [svelte(), cloudflare()],
  // When this build was made, shown beside the version in Settings → About.
  define: { __BUILT_AT__: JSON.stringify(new Date().toISOString()), __RELEASE__: JSON.stringify(release()) },
  build: {
    target: 'chrome106',
    cssTarget: 'chrome61',
  },
  // allowedHosts: lets bb's remote port share (*.getbb.app) reach the dev server.
  server: { host: true, allowedHosts: ['.getbb.app'] },
});
