// A brake for runaway loops. On 2026-10-15 a reactive loop pressed a camera's "Take Snapshot"
// thousands of times in seconds: Home Assistant fell behind and dropped the frame's connection, each
// failure became an event log entry saved to storage, and the frame froze until it was unplugged.
// Nothing the frame does legitimately repeats the same thing that fast, so past these rates the
// extra calls (and log entries) are dropped, and the caller is told once to report it.
//   const allow = limiter({ perKey: 5, perKeyMs: 2000, total: 60, totalMs: 5000 });
//   allow('button.press|button.garage_take_snapshot') -> 'ok' | 'drop' | 'report' (drop, and say so)
// A key that trips stays blocked for cooldownMs, so a loop doesn't keep trickling through.
// 'report' comes once per key a minute, so the report itself can't flood.
export function limiter({ perKey = 5, perKeyMs = 2000, total = 60, totalMs = 5000, cooldownMs = 30000, reportEveryMs = 60000 } = {}) {
  const byKey = new Map(), all = [], reported = new Map(), blocked = new Map();
  const trim = (list, since) => { while (list.length && list[0] <= since) list.shift(); };
  return function allow(key, now = Date.now()) {
    const mine = byKey.get(key) || [];
    trim(mine, now - perKeyMs);
    trim(all, now - totalMs);
    if (now < (blocked.get(key) || 0) || mine.length >= perKey || all.length >= total) {
      byKey.set(key, mine);
      if (mine.length >= perKey && !(now < (blocked.get(key) || 0))) blocked.set(key, now + cooldownMs);
      if (now - (reported.get(key) || 0) < reportEveryMs) return 'drop';
      reported.set(key, now);
      return 'report';
    }
    mine.push(now); all.push(now);
    byKey.set(key, mine);
    return 'ok';
  };
}
