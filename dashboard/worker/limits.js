// Request limits (from the 2026-10-20 security review): how big a request's body may be, and how
// often one key, or one address without a key, may call. Generous on purpose: they bound what a leaked
// key or a runaway client can do, not what the household does.

const MB = 1024 * 1024;
// The routes that take uploads, with room over their own caps (photos.js, shared-media.js,
// screenshot.js), which still apply; everything else gets DEFAULT_BODY.
const BIG = [
  [/^\/api\/bridge\/videos\//, 25 * MB],
  [/^\/api\/share\/media$/, 25 * MB],
  [/^\/api\/bridge\/photos\//, 2 * MB],
  [/^\/api\/frame\/screenshot/, 2 * MB],
  // The Mac bridge's calendars (with their notes), reminders and podcasts in one.
  [/^\/api\/bridge\/snapshot$/, 5 * MB],
  // A browser's policy report: small, and anyone may send one.
  [/^\/api\/csp-report$/, 16 * 1024],
];
export const DEFAULT_BODY = MB;
export function bodyLimit(path) {
  for (const [re, n] of BIG) if (re.test(path)) return n;
  return DEFAULT_BODY;
}
// By the size the request declares, so nothing is read first. A body sent without one (chunked) is
// left to the route's own cap and Cloudflare's.
export const tooBig = (req, path) => Number(req.headers.get('Content-Length') || 0) > bodyLimit(path);

// Cloudflare's rate limiter (the KEY_LIMIT and ADDRESS_LIMIT bindings in wrangler.jsonc). Each key
// counts on its own: a device by its id, the admin key as one. Missing (tests, a fork without the
// bindings) or failing, it lets the request through rather than lock the frame out.
export const rateKey = (who) => (who.device ? 'd:' + who.device.id : who.role);
export async function overLimit(limiter, key) {
  if (!limiter) return false;
  try { return !(await limiter.limit({ key })).success; } catch (e) { console.error('rate limiter:', e && e.message); return false; }
}
