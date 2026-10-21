<script>
  // A person's weight against their goal, opened from the weight chip on the Fitness tab: the pace,
  // what's left, the way down from the year's peak, the last weigh-in, and every weigh-in of the year
  // on a chart with the goal band and the fitted trend (lib/weight.js). Drawn from the differences from
  // the goal the phone sends; the weight and BMI appear only if its owner chose to show them.
  import Icon from './Icon.svelte';
  import { clock } from '../lib/state.svelte.js';
  import { formatDate } from '../lib/format.js';
  import { BAND } from '../lib/weight.js';
  import { hasOwnPin, confirmOwnPin } from '../lib/pin.svelte.js';
  // v: lib/weight.js weightView(); who: their name; id: their fitness id (whose PIN); onclose.
  let { v: full, who, id, onclose } = $props();
  // The weight (and the goal, BMI and body fat that give it away) shows only after its owner's own PIN,
  // and only until the sheet closes. Someone with no PIN of their own never has it shown here, even
  // if their phone sends it (an older app): the phone app asks for a PIN before it sends one.
  let unlocked = $state(false);
  let ownPin = $derived(hasOwnPin(id));
  let locked = $derived(full.goal != null && !(ownPin && unlocked));
  let v = $derived(locked ? { ...full, goal: null, weight: null, bmi: null, bodyFat: null } : full);
  async function unlock() { if (await confirmOwnPin(id, who + '’s PIN', 'to show the weight')) unlocked = true; }
  const u = $derived(v.unit);
  const signed = (n) => (n > 0 ? '+' : n < 0 ? '−' : '') + Math.abs(n).toFixed(1);
  const day = (date) => formatDate(new Date(date + 'T12:00:00'), { month: 'short', day: 'numeric' });
  const ago = (n) => (n === 0 ? 'today' : n === 1 ? 'yesterday' : n < 14 ? n + ' days ago' : Math.round(n / 7) + ' weeks ago');
  let tiles = $derived([
    { label: 'Pace', value: v.rate == null ? '–' : v.steady ? 'Steady' : signed(v.rate), unit: v.rate == null || v.steady ? '' : u.toUpperCase() + '/MO',
      sub: v.rate == null ? (v.change ? signed(v.change.by) + ' ' + u + ' since ' + day(v.change.from) : 'One weigh-in so far') : v.turn ? 'Since the ' + day(v.turn.date) + ' ' + v.turn.kind : 'Fitted over 6 months', tone: v.towards ? 'good' : v.rate != null && !v.steady ? 'low' : '' },
    { label: 'To goal', value: v.atGoal ? 'At goal' : v.toGo.toFixed(1), unit: v.atGoal ? '' : u.toUpperCase(), sub: v.eta ? '~' + formatDate(v.eta, { month: 'long', ...(v.eta.getFullYear() !== clock.now.getFullYear() ? { year: 'numeric' } : {}) }) + ' at this pace' : v.goal != null ? 'Goal ' + v.goal + ' ' + u : '' },
    { label: 'From peak', value: signed(v.latest.d - v.peak.d), unit: u.toUpperCase(), sub: 'Peak ' + day(v.peak.date) },
    { label: 'Last weigh-in', value: day(v.latest.date), unit: '', sub: ago(v.daysSince), tone: v.stale ? 'low' : '' },
    v.weight != null && { label: 'Weight', value: v.weight.toFixed(1), unit: u.toUpperCase(), sub: [v.bmi != null ? 'BMI ' + v.bmi.toFixed(1) : '', v.bodyFat != null ? v.bodyFat.toFixed(1) + '% fat' : ''].filter(Boolean).join(' · ') },
  ].filter(Boolean));

  // The chart: a year (or since the first weigh-in) to today, the goal at 0 with its band.
  const W = 712, H = 210, L = 44, R = 8, T = 10, B = 26;
  const t = (date) => new Date(date + 'T12:00:00').getTime();
  let x0 = $derived(Math.min(t(v.points[0].date), clock.now.getTime() - 60 * 864e5));
  let x1 = $derived(clock.now.getTime());
  let lo = $derived(Math.min(-BAND, ...v.points.map((p) => p.d)) - 1);
  let hi = $derived(Math.max(BAND, ...v.points.map((p) => p.d)) + 1);
  const X = (ms) => L + ((ms - x0) / (x1 - x0)) * (W - L - R);
  const Y = (d) => T + ((hi - d) / (hi - lo)) * (H - T - B);
  let path = $derived(v.points.map((p, i) => (i ? 'L' : 'M') + X(t(p.date)).toFixed(1) + ' ' + Y(p.d).toFixed(1)).join(' '));
  // Month labels: about four, at the first of the month.
  let months = $derived.by(() => {
    const out = [], d = new Date(x0); d.setDate(1); d.setMonth(d.getMonth() + 1);
    const step = Math.max(1, Math.round((x1 - x0) / 864e5 / 30 / 4));
    for (; d.getTime() < x1; d.setMonth(d.getMonth() + step)) out.push({ x: X(d.getTime()), label: formatDate(d, { month: 'short' }) });
    return out;
  });
  // Left labels: the goal, and the top, as the weight when it's shown, else as above the goal.
  const yLabel = (d) => (v.goal != null ? String(Math.round(v.goal + d)) : d === 0 ? 'Goal' : signed(d).replace('.0', ''));
  let top = $derived(Math.floor(hi));
  // A tapped weigh-in: its date and weight (or its distance from the goal, when the weight isn't
  // shown), above it; another tap, or tapping it again, moves or closes it.
  let picked = $state(null);
  const pickText = (p) => day(p.date) + ' · ' + (v.goal != null ? (v.goal + p.d).toFixed(1) + ' ' + u : signed(p.d) + ' ' + u + ' from goal');
</script>

<div class="scrim" role="presentation" onclick={onclose}>
  <div class="panel sheet" role="dialog" aria-label="Weight" tabindex="-1" onclick={(ev) => ev.stopPropagation()} onkeydown={(ev) => ev.key === 'Escape' && onclose()}>
    <header>
      <span class="who"><Icon name="weight" size={20} />{who}</span>
      <span class="acts">
        {#if locked && ownPin}<button class="show" onclick={unlock}><Icon name="lock" size={18} />Show weight</button>
        {:else if locked}<span class="nopin">Set a PIN in the phone app to show the weight here</span>{/if}
        <button class="x" onclick={onclose} aria-label="Close"><Icon name="close" size={26} /></button>
      </span>
    </header>
    <h2>{v.rate == null ? 'Weight' : v.steady ? 'Holding steady' : v.rate < 0 ? 'Trending down' : 'Trending up'}</h2>
    <!-- From the year's peak to the goal: how much of the way down is done. -->
    {#if v.peak.d > 0}
      <div class="progress"><i style="transform: scaleX({v.progress})"></i></div>
      <!-- The weights at each end when the weight is shown, else the peak's date and the word Goal. -->
      <div class="ends"><span>Peak {v.goal != null ? (v.goal + v.peak.d).toFixed(1) + ' ' + u + ' · ' : ''}{day(v.peak.date)}</span><span>{Math.round(v.progress * 100)}% of the way</span><span>Goal{v.goal != null ? ' ' + v.goal + ' ' + u : ''}</span></div>
    {/if}
    <div class="tiles">
      {#each tiles as tl (tl.label)}
        <div class="tile"><span class="label">{tl.label}</span><span class="value num {tl.tone || ''}">{tl.value}{#if tl.unit}<small>{tl.unit}</small>{/if}</span>{#if tl.sub}<span class="sub">{tl.sub}</span>{/if}</div>
      {/each}
    </div>
    <svg viewBox="0 0 {W} {H}" class="chart" role="img" aria-label="Weigh-ins over the year">
      <rect x={L} y={Y(BAND)} width={W - L - R} height={Y(-BAND) - Y(BAND)} class="band" />
      <line x1={L} x2={W - R} y1={Y(0)} y2={Y(0)} class="goal" />
      <text x={L - 6} y={Y(0) + 5} class="ylab">{yLabel(0)}</text>
      {#if top > BAND + 1}<text x={L - 6} y={Y(top) + 5} class="ylab">{yLabel(top)}</text>{/if}
      {#each months as m (m.x)}<text x={m.x} y={H - 6} class="xlab">{m.label}</text>{/each}
      <path d={path} class="series" />
      {#each v.points as p (p.date)}<circle cx={X(t(p.date))} cy={Y(p.d)} r="4.5" class="dot" class:on={picked === p} />{/each}
      <!-- The fitted trend, over the weigh-ins it was fitted to, on top so it shows where they agree. -->
      {#if v.line}<line x1={X(t(v.line[0].date))} y1={Y(v.line[0].d)} x2={X(t(v.line[1].date))} y2={Y(v.line[1].d)} class="trend" />
        <!-- Said once, under its end: the line fitted through the weigh-ins (the pace), not a target. -->
        <text x={X(t(v.line[1].date)) - 4} y={Y(v.line[1].d) + 24} class="trendlab">trend</text>{/if}
      <!-- Finger-sized tap areas over the dots, then the tapped one's label, kept inside the chart. -->
      {#each v.points as p (p.date)}<circle cx={X(t(p.date))} cy={Y(p.d)} r="20" class="hit" role="button" tabindex="-1" aria-label={pickText(p)} onclick={() => (picked = picked === p ? null : p)} />{/each}
      {#if picked}
        <!-- About 8.6 px a character at this size, plus padding; kept inside the chart. -->
        {@const tw = Math.round(pickText(picked).length * 8.6 + 28)}
        {@const lx = Math.max(L + tw / 2, Math.min(W - R - tw / 2, X(t(picked.date))))}
        {@const ly = Y(picked.d) - 16 < T + 22 ? Y(picked.d) + 34 : Y(picked.d) - 16}
        <rect x={lx - tw / 2} y={ly - 22} width={tw} height="30" rx="15" class="tip" />
        <text x={lx} y={ly - 2} class="tiptext">{pickText(picked)}</text>
      {/if}
    </svg>
    {#if v.stale}<p class="note">The last weigh-in was {ago(v.daysSince)}. A weigh-in every week or two keeps the trend current.</p>{/if}
  </div>
</div>

<style>
  .scrim { position: fixed; inset: 0; z-index: 40; display: grid; place-items: center; background: rgba(0, 0, 0, .45); }
  .panel { width: 760px; max-width: calc(100vw - 40px); max-height: calc(100vh - 40px); display: flex; flex-direction: column; padding: 18px 24px 22px; border-radius: 26px; overflow: hidden; }
  header { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
  .who { display: flex; align-items: center; gap: 8px; font-size: 16px; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; color: var(--secondary); }
  .acts { display: flex; align-items: center; gap: 10px; }
  .show { display: flex; align-items: center; gap: 6px; height: 44px; padding: 0 16px; border-radius: 22px; background: var(--track); color: var(--label); font-size: 17px; font-weight: 600; }
  .show:active { opacity: .6; }
  .nopin { max-width: 260px; font-size: 14px; color: var(--secondary); text-align: right; }
  .x { flex: none; width: 48px; height: 48px; border-radius: 50%; display: grid; place-items: center; background: var(--track); color: var(--label); }
  h2 { margin: 2px 0 10px; font-size: 32px; line-height: 1.1; font-weight: 800; letter-spacing: -.01em; }
  .progress { height: 10px; border-radius: 5px; background: var(--track); overflow: hidden; }
  .progress i { display: block; height: 100%; background: #30c759; transform-origin: left; }
  .ends { display: flex; justify-content: space-between; margin: 4px 0 12px; font-size: 14px; font-weight: 600; color: var(--secondary); }
  .tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 8px; }
  .tile { display: flex; flex-direction: column; gap: 1px; padding: 10px 12px; border-radius: 14px; background: var(--fill); min-width: 0; }
  .label { font-size: 14px; font-weight: 600; color: var(--secondary); }
  .value { font-size: 26px; font-weight: 700; line-height: 1.15; white-space: nowrap; }
  .value small { font-size: 14px; font-weight: 700; margin-left: 3px; color: var(--secondary); }
  .value.good { color: #248a3d; }
  .value.low { color: var(--orange-text); }
  :global([data-theme='dark']) .value.good { color: #30d158; }
  .sub { font-size: 13px; color: var(--secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .chart { width: 100%; height: auto; margin-top: 12px; }
  .band { fill: rgba(48, 199, 89, .14); }
  .goal { stroke: #30c759; stroke-width: 2; }
  .trend { stroke: var(--orange); stroke-width: 2.5; stroke-dasharray: 7 6; opacity: .9; }
  .series { fill: none; stroke: var(--blue); stroke-width: 2.5; stroke-linejoin: round; }
  .dot { fill: var(--sheet); stroke: var(--blue); stroke-width: 2.5; }
  .dot.on { fill: var(--blue); }
  .hit { fill: transparent; cursor: pointer; }
  .tip { fill: var(--label); }
  .tiptext { font-size: 15px; font-weight: 700; fill: var(--sheet); text-anchor: middle; }
  .trendlab { font-size: 13px; font-weight: 700; fill: var(--orange-text); text-anchor: end; }
  .ylab { font-size: 13px; font-weight: 600; fill: var(--secondary); text-anchor: end; }
  .xlab { font-size: 13px; font-weight: 600; fill: var(--secondary); text-anchor: middle; }
  .note { margin: 8px 0 0; font-size: 15px; color: var(--secondary); }
</style>
