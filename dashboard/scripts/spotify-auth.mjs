#!/usr/bin/env node
// One-time Spotify sign-in for the Worker: opens Spotify's "Allow" page, catches the redirect on
// http://127.0.0.1:8888/callback, and saves a refresh token as SPOTIFY_REFRESH_TOKEN in .dev.vars.
// Nothing secret is printed. Run from dashboard/: node scripts/spotify-auth.mjs
// Needs SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET in .dev.vars, and that redirect URI added to the
// app at developer.spotify.com. Then: scripts/push-secrets.sh SPOTIFY_CLIENT_ID SPOTIFY_CLIENT_SECRET SPOTIFY_REFRESH_TOKEN
import { createServer } from 'node:http';
import { readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { execFile } from 'node:child_process';

const FILE = new URL('../.dev.vars', import.meta.url);
const REDIRECT = 'http://127.0.0.1:8888/callback';
const SCOPES = 'playlist-read-private playlist-read-collaborative user-read-recently-played user-read-currently-playing user-read-playback-state';

const text = readFileSync(FILE, 'utf8');
const get = (k) => (new RegExp('^' + k + '="?([^"\\n]*)"?', 'm').exec(text) || [])[1] || '';
const id = get('SPOTIFY_CLIENT_ID'), secret = get('SPOTIFY_CLIENT_SECRET');
if (!id || !secret) { console.error('Put SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET in dashboard/.dev.vars first.'); process.exit(1); }

const state = randomBytes(16).toString('hex');
const auth = 'https://accounts.spotify.com/authorize?' + new URLSearchParams({ client_id: id, response_type: 'code', redirect_uri: REDIRECT, scope: SCOPES, state });

const server = createServer(async (req, res) => {
  const u = new URL(req.url, REDIRECT);
  if (u.pathname !== '/callback') { res.writeHead(404).end(); return; }
  const done = (msg, code = 0) => { res.writeHead(200, { 'Content-Type': 'text/plain' }).end(msg + '\n\nYou can close this tab.'); console.log(msg); server.close(); process.exitCode = code; };
  if (u.searchParams.get('state') !== state) return done('State mismatch; run the script again.', 1);
  if (u.searchParams.get('error')) return done('Spotify said: ' + u.searchParams.get('error'), 1);
  const r = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: 'Basic ' + Buffer.from(id + ':' + secret).toString('base64') },
    body: new URLSearchParams({ grant_type: 'authorization_code', code: u.searchParams.get('code'), redirect_uri: REDIRECT }),
  });
  if (!r.ok) return done('Token exchange failed: HTTP ' + r.status + ' ' + (await r.text()).slice(0, 200), 1);
  const { refresh_token } = await r.json();
  const now = readFileSync(FILE, 'utf8');
  const line = 'SPOTIFY_REFRESH_TOKEN="' + refresh_token + '"';
  writeFileSync(FILE, /^SPOTIFY_REFRESH_TOKEN=.*$/m.test(now) ? now.replace(/^SPOTIFY_REFRESH_TOKEN=.*$/m, line) : now.trimEnd() + '\n' + line + '\n');
  done('Saved SPOTIFY_REFRESH_TOKEN to dashboard/.dev.vars.');
});
server.listen(8888, '127.0.0.1', () => {
  console.log('Opening Spotify in your browser. If it does not open, visit:\n' + auth);
  execFile('open', [auth], () => {});
});
