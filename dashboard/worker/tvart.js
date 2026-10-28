// Show posters from TVmaze (api.tvmaze.com: free, no key, images CC BY-SA) for what a TV is playing
// when Home Assistant has no picture of it. Apple TV only passes artwork on from apps that say what
// they're playing (the Apple TV app, Disney+); YouTube TV and Netflix don't, but YouTube TV still
// names the show and its channel ("Dancing With the Stars", "ABC 11"), and that's enough to find it.
//
// GET /api/tvart?q=<title>&ch=<channel> answers with the poster (TVmaze's medium size, ~210×295, about
// what the frame shows) or 404. Both the lookup and the poster are kept in the edge cache, so a show is
// looked up once a week however often the frame asks.

const norm = (s) => String(s || '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, ' ').trim();

// "ABC 11" -> "abc", "NBC 5 HD" -> "nbc": a local station's call sign is its network.
const channelOf = (ch) => norm(ch).replace(/\b(hd|\d+)\b/g, ' ').trim();

// TVmaze's search finds every country's version of a show (DWTS has more than twenty), so of the ones
// named exactly the title: the one on the channel playing it, else an American one, else the first.
export function pickShow(results, title, ch) {
  const want = norm(title);
  const shows = (results || []).map((r) => r && r.show).filter((s) => s && s.image && norm(s.name) === want);
  if (!shows.length) return null;
  const net = channelOf(ch);
  const nets = (s) => [s.network && s.network.name, s.webChannel && s.webChannel.name].filter(Boolean).map(norm);
  return (net && shows.find((s) => nets(s).some((n) => n === net || n.startsWith(net + ' '))))
    || shows.find((s) => !s.network || (s.network.country && s.network.country.code === 'US'))
    || shows[0];
}

const TTL = 604800; // a week
const notFound = () => new Response('not found', { status: 404, headers: { 'Cache-Control': 'public, max-age=86400' } });

export async function tvArtResponse(url, ctx) {
  const q = (url.searchParams.get('q') || '').slice(0, 120);
  const ch = (url.searchParams.get('ch') || '').slice(0, 60);
  if (!norm(q)) return notFound();
  const cacheKey = new Request('https://tvart.local/' + encodeURIComponent(norm(q)) + '/' + encodeURIComponent(channelOf(ch)));
  const hit = await caches.default.match(cacheKey);
  if (hit) return hit;
  let res;
  try {
    const r = await fetch('https://api.tvmaze.com/search/shows?q=' + encodeURIComponent(q));
    if (!r.ok) return new Response('lookup failed', { status: 502 }); // not cached: try again next time
    const show = pickShow(await r.json(), q, ch);
    const img = show && (show.image.medium || show.image.original);
    const pic = img && /^https:\/\/static\.tvmaze\.com\//.test(img) ? await fetch(img) : null;
    res = pic && pic.ok
      ? new Response(pic.body, { headers: { 'Content-Type': pic.headers.get('Content-Type') || 'image/jpeg', 'Cache-Control': 'public, max-age=' + TTL } })
      : notFound();
  } catch {
    return new Response('lookup failed', { status: 502 });
  }
  if (ctx && ctx.waitUntil) ctx.waitUntil(caches.default.put(cacheKey, res.clone()));
  return res;
}
