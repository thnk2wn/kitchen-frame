import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import worker from './index.js';
import { cspPolicy, cspReport } from './csp.js';

const PAGE = '<html><head><script>window.a = 1;</script><script type="module" src="/assets/index-x.js"></script></head><body><script>b()</script></body></html>';
const sha = (s) => "'sha256-" + createHash('sha256').update(s).digest('base64') + "'";

test('the policy allows the page’s own inline scripts by hash, and nothing inline besides', async () => {
  const p = await cspPolicy(PAGE);
  const script = p.split('; ').find((d) => d.startsWith('script-src'));
  assert.ok(script.includes(sha('window.a = 1;')));
  assert.ok(script.includes(sha('b()')));
  assert.ok(!script.includes('unsafe-inline'));
  assert.match(p, /connect-src 'self'(;|$)/);
  assert.match(p, /report-uri \/api\/csp-report/);
});

test('the page is served with the report-only policy beside the enforced frame-ancestors', async () => {
  const env = { DASHBOARD_KEY: 'k', ASSETS: { fetch: async () => new Response(PAGE, { headers: { 'Content-Type': 'text/html' } }) } };
  const res = await worker.fetch(new Request('https://frame.test/'), env, { waitUntil() {} });
  assert.equal(res.headers.get('Content-Security-Policy'), "frame-ancestors 'none'");
  assert.ok(res.headers.get('Content-Security-Policy-Report-Only').includes(sha('b()')));
  assert.equal(await res.text(), PAGE);
});

test('a report keeps only the directive, the blocked origin and the path, once per 10 minutes', async () => {
  const points = [];
  const env = { METRICS: { writeDataPoint: (p) => points.push(p) } };
  const report = (blocked) => new Request('https://frame.test/api/csp-report', { method: 'POST', body: JSON.stringify({ 'csp-report': {
    'document-uri': 'https://frame.test/?tab=house&key=secret', 'effective-directive': 'connect-src', 'blocked-uri': blocked } }) });
  assert.equal((await cspReport(report('http://ha.example:8123/api/websocket?token=x'), env)).status, 204);
  assert.deepEqual(points[0].blobs, ['connect-src', 'http://ha.example:8123', '/']);
  await cspReport(report('http://ha.example:8123/other'), env);
  assert.equal(points.length, 1); // the same directive and origin again within 10 minutes
  // The Reporting API's shape too.
  await cspReport(new Request('https://frame.test/api/csp-report', { method: 'POST', body: JSON.stringify([{ type: 'csp-violation', body: {
    documentURL: 'https://frame.test/', effectiveDirective: 'img-src', blockedURL: 'inline' } }]) }), env);
  assert.deepEqual(points[1].blobs, ['img-src', 'inline', '/']);
});

test('a report over 16 KB or not JSON is refused', async () => {
  const env = { METRICS: { writeDataPoint() { throw new Error('should not write'); } } };
  assert.equal((await cspReport(new Request('https://frame.test/api/csp-report', { method: 'POST', body: 'x'.repeat(17 * 1024) }), env)).status, 413);
  assert.equal((await cspReport(new Request('https://frame.test/api/csp-report', { method: 'POST', body: 'nope' }), env)).status, 400);
});
