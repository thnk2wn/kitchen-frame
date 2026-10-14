// A colour from an album cover, for the Music tab's tint: the most common vivid colour among a
// 24x24 sample (very dark, very light and grey pixels left out), or the plain average if the cover
// has none. The image must allow cross-origin reads (Spotify's covers do). Remembered per cover.
const seen = new Map();

export function coverColor(url) {
  if (!url) return Promise.resolve(null);
  if (seen.has(url)) return seen.get(url);
  const p = new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const c = document.createElement('canvas');
        c.width = c.height = 24;
        const g = c.getContext('2d');
        g.drawImage(img, 0, 0, 24, 24);
        const d = g.getImageData(0, 0, 24, 24).data;
        const buckets = new Map();
        let all = [0, 0, 0, 0];
        for (let i = 0; i < d.length; i += 4) {
          const [r, gr, b] = [d[i], d[i + 1], d[i + 2]];
          all = [all[0] + r, all[1] + gr, all[2] + b, all[3] + 1];
          const max = Math.max(r, gr, b), min = Math.min(r, gr, b);
          if (max < 40 || min > 225 || max - min < 40) continue; // dark, light or grey
          const key = (r >> 5) + ',' + (gr >> 5) + ',' + (b >> 5);
          const k = buckets.get(key) || [0, 0, 0, 0, 0];
          buckets.set(key, [k[0] + r, k[1] + gr, k[2] + b, k[3] + 1, k[4] + (max - min)]);
        }
        // The bucket with the most vividness in total: many pixels, and vivid ones.
        let best = null;
        for (const k of buckets.values()) if (!best || k[4] > best[4]) best = k;
        const pick = best && best[3] >= 6 ? best : all;
        resolve(pick[3] ? [0, 1, 2].map((i) => Math.round(pick[i] / pick[3])) : null);
      } catch { resolve(null); }
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
  seen.set(url, p);
  if (seen.size > 40) seen.delete(seen.keys().next().value);
  return p;
}
