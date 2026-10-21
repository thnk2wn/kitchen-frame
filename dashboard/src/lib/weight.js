// Body weight against a goal, for the Fitness tab (lib/fitness.js's people; worker/fitness.js keeps it).
// A phone that shares weight sends its weigh-ins of the last year as differences from its owner's goal
// (d: +11.8 is 11.8 above it), in the phone's unit, so the trend, the pace and what's left to go never
// need the weight itself. The goal (and height, for BMI) come too only when its owner chose to show
// their weight; without them there's no weight or BMI to show, by design.
//
// People weigh in now and then, not daily, so the trend is a straight line fitted through every
// weigh-in of the last TREND_DAYS, not the last two readings, and it isn't given at all on too little.
// When the weight turned inside that window (a peak, or a low), the line starts at the turn instead,
// if enough weigh-ins follow it: a line through a climb and the fall after it says neither.
export const TREND_DAYS = 180;
export const TREND_MIN = 3; // weigh-ins in the window for a trend
export const TREND_SPAN = 21; // days they have to cover
export const STEADY = 0.5; // a pace under this (per month) is "steady"
export const STALE_DAYS = 21; // a last weigh-in older than this says so
export const BAND = 5; // the goal band drawn on the chart: the goal, give or take this
const MONTH = 30.44;

const dayMs = 864e5;
const at = (date) => new Date(date + 'T12:00:00').getTime();
const round1 = (n) => Math.round(n * 10) / 10;

// Least-squares slope of d over days.
function slope(points) {
  const xs = points.map((p) => at(p.date) / dayMs), ys = points.map((p) => p.d);
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length, my = ys.reduce((a, b) => a + b, 0) / ys.length;
  let num = 0, den = 0;
  for (let i = 0; i < xs.length; i++) { num += (xs[i] - mx) * (ys[i] - my); den += (xs[i] - mx) ** 2; }
  return den ? { perDay: num / den, mx, my } : null;
}

export function weightView(w, now) {
  const points = (w && Array.isArray(w.points) ? w.points : []).filter((p) => p && p.date && Number.isFinite(p.d)).sort((a, b) => a.date.localeCompare(b.date));
  if (!points.length) return null;
  const unit = w.unit === 'kg' ? 'kg' : 'lb';
  const nowMs = now.getTime();
  const year = points.filter((p) => nowMs - at(p.date) <= 366 * dayMs);
  const shown = year.length ? year : points.slice(-1);
  const latest = shown[shown.length - 1];
  const daysSince = Math.max(0, Math.round((nowMs - at(latest.date)) / dayMs));

  // The pace: a fitted line through the window's weigh-ins when there are enough over long enough;
  // otherwise the change since the weigh-in before, as a plain difference (not called a trend).
  const spanOf = (pts) => (pts.length ? (at(pts[pts.length - 1].date) - at(pts[0].date)) / dayMs : 0);
  const enough = (pts) => pts.length >= TREND_MIN && spanOf(pts) >= TREND_SPAN;
  let win = shown.filter((p) => nowMs - at(p.date) <= TREND_DAYS * dayMs);
  // The window's highest or lowest weigh-in, whichever is later of those past the window's start
  // with enough weigh-ins after them (the latest weigh-in being the lowest is no turn).
  let turn = null;
  if (win.length > TREND_MIN) {
    const hi = win.reduce((m, p) => (p.d > m.d ? p : m), win[0]), lo = win.reduce((m, p) => (p.d < m.d ? p : m), win[0]);
    const from = (t) => win.filter((p) => p.date >= t.date);
    const t = [hi, lo].filter((x) => x !== win[0] && enough(from(x))).sort((a, b) => b.date.localeCompare(a.date))[0];
    if (t) { turn = { date: t.date, kind: t === hi ? 'peak' : 'low' }; win = from(t); }
  }
  const fit = enough(win) ? slope(win) : null;
  const rate = fit ? round1(fit.perDay * MONTH) : null;
  const prev = shown.length >= 2 ? shown[shown.length - 2] : null;
  const change = prev ? { from: prev.date, by: round1(latest.d - prev.d) } : null;

  const toGo = round1(latest.d); // above the goal; negative is under it
  const towards = rate != null && Math.abs(rate) >= STEADY && Math.sign(rate) === -Math.sign(toGo);
  // The highest of the year, the start of the way down (the progress bar's left end).
  const peak = shown.reduce((m, p) => (p.d > m.d ? p : m), shown[0]);
  const progress = peak.d > 0 && toGo < peak.d ? Math.max(0, Math.min(1, 1 - toGo / peak.d)) : toGo <= 0 ? 1 : 0;
  // When the goal comes at this pace: only from a real trend heading there, and not years out.
  let eta = null;
  if (fit && win.length >= 4 && towards && Math.abs(toGo) > 0.5) {
    const months = Math.abs(toGo) / Math.abs(rate);
    if (months <= 24) eta = new Date(at(latest.date) + months * MONTH * dayMs);
  }
  // The fitted line's ends, for the chart.
  const line = fit ? [win[0].date, win[win.length - 1].date].map((date) => ({ date, d: round1(fit.my + fit.perDay * (at(date) / dayMs - fit.mx)) })) : null;
  const goal = Number.isFinite(w.goal) ? w.goal : null;
  const weight = goal != null ? round1(goal + latest.d) : null;
  const kg = weight != null ? (unit === 'kg' ? weight : weight * 0.45359237) : null;
  // The scale's own BMI when it sent one (its height setting can differ from Health's), else worked out.
  const bmi = weight == null ? null : Number.isFinite(w.bmi) ? w.bmi : kg != null && w.heightM > 0 ? round1(kg / (w.heightM * w.heightM)) : null;
  const bodyFat = weight != null && Number.isFinite(w.bodyFat) ? w.bodyFat : null;
  return {
    unit, points: shown, latest, daysSince, stale: daysSince > STALE_DAYS,
    rate, steady: rate != null && Math.abs(rate) < STEADY, towards, change, line, turn,
    toGo, atGoal: Math.abs(toGo) <= 0.5 || toGo < 0, peak, progress, eta,
    goal, weight, bmi, bodyFat,
  };
}

// The Fitness card's chip: the pace first (what's happening), then what's left.
export function weightChip(v) {
  if (!v) return null;
  const u = v.unit;
  // Never the weight itself, even when it's shown: that's behind its owner's PIN on the sheet.
  const pace = v.rate == null ? null : v.steady ? 'Steady' : (v.rate < 0 ? '↓ ' : '↑ ') + Math.abs(v.rate).toFixed(1) + ' ' + u + '/mo';
  const left = v.atGoal ? 'at goal' : v.toGo.toFixed(1) + ' ' + u + ' to go';
  return { text: [pace, left].filter(Boolean).join(' · '), tone: v.towards || v.atGoal ? 'good' : v.rate != null && !v.steady ? 'low' : '' };
}

// Invented weigh-ins for demo mode: about every two weeks, down from a summer peak toward the goal.
export function demoWeight(now) {
  const ago = (days) => { const d = new Date(now.getTime() - days * dayMs); return d.toISOString().slice(0, 10); };
  const pts = [[330, 9.2], [290, 10.6], [250, 12.1], [215, 14.5], [190, 17], [160, 19.8], [135, 18.6], [110, 17.2], [85, 16], [60, 14.6], [38, 13.4], [18, 12.3], [4, 11.6]];
  return { unit: 'lb', points: pts.map(([days, d]) => ({ date: ago(days), d })) };
}
