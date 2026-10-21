// A Content-Security-Policy for the page, for now report-only (2026-10-20 security review): the browser
// blocks nothing, but tells /api/csp-report what this policy would have blocked, so the real one can
// be written from what the frame actually loads rather than guessed. Home Assistant and the camera
// relay are on the home network at addresses set on the frame, not here, so connect-src starts at
// 'self' and their reports say what to add.

// The page's inline scripts (index.html) are allowed by hash, worked out from the page as served, so a
// build that changes them can't leave the policy behind.
const hashes = new Map(); // page text -> the policy's script hashes
async function scriptHashes(html) {
  if (hashes.has(html)) return hashes.get(html);
  const out = [];
  for (const m of html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(m[1]));
    out.push("'sha256-" + btoa(String.fromCharCode(...new Uint8Array(digest))) + "'");
  }
  if (hashes.size > 20) hashes.clear();
  hashes.set(html, out);
  return out;
}

export async function cspPolicy(html) {
  return [
    "default-src 'self'",
    // YouTube's player API (lib/youtube.js) and the scripts it loads.
    ["script-src 'self'", ...(await scriptHashes(html)), 'https://www.youtube.com', 'https://s.ytimg.com'].join(' '),
    // Svelte sets style attributes.
    "style-src 'self' 'unsafe-inline'",
    // Recipe photos, podcast art, emoji (a CDN), and pictures turned into blob: URLs (lib/ha-image.js).
    "img-src 'self' data: blob: https:",
    // Podcast episodes come from anywhere.
    "media-src 'self' data: blob: https:",
    "font-src 'self' data:",
    "connect-src 'self'",
    'frame-src https://www.youtube-nocookie.com https://www.youtube.com',
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    'report-uri /api/csp-report',
  ].join('; ');
}

// A report, kept as its directive, the origin it would have blocked (never the full address or page
// content) and the page's path, as a point in Workers Analytics Engine (index 'csp'):
// scripts/frame-metrics.sh csp. The same directive and origin is kept once per 10 minutes per Worker
// instance, so a page stuck in a loop can't use up the day's writes.
const seen = new Map();
const MAX_REPORT = 16 * 1024;
const originOf = (u) => {
  const s = String(u || '');
  if (!s) return '';
  if (/^(inline|eval|wasm-eval|trusted-types-sink|self)$/.test(s)) return s;
  try { const x = new URL(s); return /^https?:|^wss?:/.test(x.protocol) ? x.protocol + '//' + x.host : x.protocol; } catch { return s.slice(0, 40); }
};
export async function cspReport(req, env) {
  const text = await req.text();
  if (text.length > MAX_REPORT) return new Response(null, { status: 413 });
  let body;
  try { body = JSON.parse(text); } catch { return new Response(null, { status: 400 }); }
  // The older report-uri shape ({"csp-report": {…}}), or the Reporting API's list of reports.
  const reports = Array.isArray(body) ? body.filter((r) => r && r.type === 'csp-violation').map((r) => r.body || {}) : [body && body['csp-report']].filter(Boolean);
  for (const r of reports.slice(0, 10)) {
    const directive = String(r['effective-directive'] || r.effectiveDirective || r['violated-directive'] || '').split(' ')[0].slice(0, 40);
    const blocked = originOf(r['blocked-uri'] || r.blockedURL).slice(0, 80);
    let page = '';
    try { page = new URL(r['document-uri'] || r.documentURL).pathname.slice(0, 40); } catch {}
    const k = directive + ' ' + blocked;
    if (Date.now() - (seen.get(k) || 0) < 10 * 60 * 1000) continue;
    if (seen.size > 500) seen.clear();
    seen.set(k, Date.now());
    try { env.METRICS && env.METRICS.writeDataPoint({ indexes: ['csp'], blobs: [directive, blocked, page], doubles: [1] }); } catch {}
  }
  return new Response(null, { status: 204 });
}
