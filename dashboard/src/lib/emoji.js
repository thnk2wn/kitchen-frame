// Emoji the device can't draw, as pictures. The frame's Android 8.1 has 2017's emoji font, so newer
// ones (🥰, 🥳, 🫶 …) show as empty boxes. Each emoji is checked once by drawing it on a small canvas:
// a colour emoji comes out in colour, a missing one as a grey box. Missing ones are shown as Twemoji
// pictures (CC-BY 4.0, https://github.com/jdecked/twemoji), loaded from a CDN only when needed. On a
// device with a current emoji font nothing changes.
const CDN = 'https://cdn.jsdelivr.net/gh/jdecked/twemoji@15.1.0/assets/svg/';
// One emoji: a pictograph with its variation selector, skin tone and ZWJ joins, a flag (two regional
// indicators) or a keycap.
const EMOJI = /\p{Extended_Pictographic}(?:️|[\u{1F3FB}-\u{1F3FF}])?(?:‍\p{Extended_Pictographic}(?:️|[\u{1F3FB}-\u{1F3FF}])?)*|[\u{1F1E6}-\u{1F1FF}]{2}|[#*0-9]️?⃣/gu;
const ok = new Map();
let ctx = null;

function drawable(e) {
  if (ok.has(e)) return ok.get(e);
  let yes = true;
  try {
    if (!ctx) { const c = document.createElement('canvas'); c.width = c.height = 20; ctx = c.getContext('2d', { willReadFrequently: true }); ctx.textBaseline = 'top'; ctx.font = '16px sans-serif'; }
    ctx.clearRect(0, 0, 20, 20);
    ctx.fillStyle = '#000';
    ctx.fillText(e, 0, 0);
    const d = ctx.getImageData(0, 0, 20, 20).data;
    yes = false;
    for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 0 && (Math.abs(d[i] - d[i + 1]) > 20 || Math.abs(d[i + 1] - d[i + 2]) > 20)) { yes = true; break; }
  } catch { yes = true; }
  ok.set(e, yes);
  return yes;
}

// Twemoji's file name: the code points in hex, joined by '-', without FE0F unless it joins (ZWJ).
const file = (e) => [...(e.includes('‍') ? e : e.replace(/️/g, ''))].map((c) => c.codePointAt(0).toString(16)).join('-');

// text -> [string | { emoji, src }]: plain strings, and pictures for emoji this device can't draw.
export function emojiParts(text) {
  const s = String(text ?? '');
  if (!/[\u{1F000}-\u{1FFFF}☀-➿⬀-⯿⌀-⏿]/u.test(s)) return [s];
  const out = [];
  let last = 0;
  for (const m of s.matchAll(EMOJI)) {
    if (drawable(m[0])) continue;
    if (m.index > last) out.push(s.slice(last, m.index));
    out.push({ emoji: m[0], src: CDN + file(m[0]) + '.svg' });
    last = m.index + m[0].length;
  }
  if (last < s.length) out.push(s.slice(last));
  return out;
}

// The same for HTML built from escaped text (the House tab's markdown cards): emoji this device can't
// draw become <img>s. Safe to use on escaped HTML: the only thing added is a picture whose address is
// made of hex code points.
export function emojiHtml(html) {
  return emojiParts(html).map((p) => (typeof p === 'string' ? p : '<img class="emoji" src="' + p.src + '" alt="" draggable="false">')).join('');
}
