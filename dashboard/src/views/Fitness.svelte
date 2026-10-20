<script>
  // Fitness: each person's Activity rings today, steps, a nudge for what's left, the last 7 days and
  // recent workouts, as their phone last sent them (lib/fitness.js). Numbers more than a few hours
  // old are dimmed and say how old, so a phone that stopped sending never looks current.
  import Rings from '../components/Rings.svelte';
  import Icon from '../components/Icon.svelte';
  import { ui, clock } from '../lib/state.svelte.js';
  import { time, dayKey, formatDate } from '../lib/format.js';
  import { view, nudge, distance, workoutIcon, replayBeat, RING_COLORS, RING_COLORS_LIGHT } from '../lib/fitness.js';
  import { fitnessPeople, canAsk, askPhone, askState } from '../lib/fitness.svelte.js';
  import WorkoutSheet from '../components/WorkoutSheet.svelte';
  // The workout open in its sheet, with whose it is: { w, unit, who }.
  let open = $state(null);
  // ?workout=<n>: opens the first person's nth workout (screenshots, the smoke test).
  const askedWorkout = Number(new URLSearchParams(location.search).get('workout') ?? NaN);
  let askedDone = false;
  $effect(() => {
    const p = people[0], w = p && p.workouts && p.workouts[askedWorkout];
    if (!askedDone && w) { askedDone = true; open = { w, unit: p.unit, who: p.name }; }
  });

  let people = $derived(fitnessPeople(ui.demo, clock.now).map((p) => view(p, clock.now)));
  let light = $derived(ui.theme === 'light');
  // Replays the rings' and Behind's animations every few minutes (lib/fitness.js replayBeat).
  let beat = $derived(replayBeat(clock.now));
  let colors = $derived(light ? RING_COLORS_LIGHT : RING_COLORS);
  const letter = (d) => formatDate(d, { weekday: 'narrow' });
  function when(d) {
    const days = Math.round((new Date(dayKey(clock.now) + 'T00:00') - new Date(dayKey(d) + 'T00:00')) / 864e5);
    const day = days === 0 ? 'Today' : days === 1 ? 'Yesterday' : formatDate(d, { weekday: 'long' });
    return day + ', ' + time(d);
  }
  // The trend chips, on one line: a streak, today's steps and exercise against the usual by this time
  // of day (one chip, so "vs usual" is said once), and workout days over the 4 weeks.
  function chipsFor(tr) {
    // Each value in its own colour: up green, down orange.
    const part = (label, v) => v == null ? null : { label, value: (v >= 0 ? '+' : '') + v + '%', tone: v >= 0 ? 'good' : 'low' };
    const vs = [part('Steps', tr.steps), part('Exercise', tr.exercise)].filter(Boolean);
    return [
      tr.allStreak >= 2 ? { icon: 'flame', text: tr.allStreak + '-day streak', tone: 'good' } : tr.moveStreak >= 2 ? { icon: 'flame', text: tr.moveStreak + '-day Move streak', tone: 'good' } : null,
      vs.length ? { icon: 'activity', text: vs.map((x) => x.label + ' ' + x.value).join(' '), parts: vs, note: 'vs usual', tone: '' } : null,
      tr.workoutOf >= 7 ? { icon: 'dumbbell', text: tr.workoutDays + ' workout days', note: tr.workoutOf >= 28 ? 'in 4 wks' : 'in ' + tr.workoutOf + ' days', tone: '' } : null,
    ].filter(Boolean);
  }
  // The 7-day row's bubble: { id, i } of the day shown, closed again after a few seconds.
  // ?fitnessday=<n>: opens the first person's nth day (screenshots, the smoke test).
  const askedDay = Number(new URLSearchParams(location.search).get('fitnessday') ?? NaN);
  let dayOpen = $state(Number.isInteger(askedDay) && askedDay >= 0 && askedDay <= 6 ? { id: null, i: askedDay } : null);
  $effect(() => { if (dayOpen && dayOpen.id === null && people[0]) dayOpen = { id: people[0].id, i: dayOpen.i }; });
  let dayTimer;
  function showDay(id, i) {
    clearTimeout(dayTimer);
    dayOpen = dayOpen && dayOpen.id === id && dayOpen.i === i ? null : { id, i };
    if (dayOpen) dayTimer = setTimeout(() => (dayOpen = null), 6000);
  }
  $effect(() => () => clearTimeout(dayTimer));
  function ago(iso) {
    const min = Math.max(0, Math.round((clock.now - Date.parse(iso)) / 60000));
    return min < 2 ? 'just now' : min < 60 ? min + ' min ago' : min < 24 * 60 ? Math.round(min / 60) + ' hr ago' : when(new Date(iso));
  }
  // How current the numbers are: the newest Watch reading the phone had (dataAt), else when it sent
  // (apps from before dataAt). A recent send can still carry old data, before the Watch syncs.
  function asOf(p) {
    if (!p.dataAt) return 'Updated ' + ago(p.updated);
    const d = new Date(p.dataAt);
    return 'Watch data as of ' + (dayKey(d) === dayKey(clock.now) ? time(d) : when(d));
  }
</script>

<div class="fitness" class:one={people.length === 1} class:many={people.length > 2}>
  {#each people as p (p.id)}
    {@const t = p.today}
    {@const n = nudge(t, clock.now)}
    {@const a = canAsk(ui.demo) ? askState(p, clock.now) : null}
    <section class="sheet person" class:stale={p.stale}>
      <header>
        <h2>{p.name}</h2>
        <div class="meta">
          {#if p.steps != null}<b class="num">{Math.round(p.steps).toLocaleString()} steps{p.meters != null ? ' · ' + distance(p.meters, p.unit) : ''}</b>{/if}
          <!-- Refresh, on the same line: a notification to their phone through Home Assistant
               (lib/fitness.svelte.js askPhone), while asking its state instead of the time. -->
          <span class="asof">
            {#if !a || a.state === 'ask'}<span class:old={p.stale}>{asOf(p)}</span>{/if}
            {#if a && a.state === 'ask'}<button class="ask" onclick={() => askPhone(p, ui.demo)}><Icon name="reload" size={14} />Refresh</button>
            {:else if a && a.state === 'asking'}<span class="asking">Asked {p.name}’s phone…</span>
            {:else if a && a.state === 'asked'}<span>{asOf(p)} · asked at {time(a.at)}</span>
            {:else if a}<span class="old">Couldn’t ask (Home Assistant)</span>{/if}
          </span>
        </div>
      </header>
      <div class="today">
        {#key beat}<Rings move={p.rings.move} exercise={p.rings.exercise} stand={p.rings.stand} size={people.length > 2 ? 120 : 140} {light} celebrate pulse={p.empty || p.waiting ? null : n.ring} />{/key}
        <!-- Waiting for the Watch: a dash, not a 0 that reads as nothing done. -->
        <dl>
          <div><dt style="color:{colors.move}">Move</dt><dd class="num">{p.waiting ? '–' : t.move}<span>/{t.moveGoal} kcal</span></dd></div>
          <div><dt style="color:{colors.exercise}">Exercise</dt><dd class="num">{p.waiting ? '–' : t.exercise}<span>/{t.exerciseGoal} min</span></dd></div>
          <div><dt style="color:{colors.stand}">Stand</dt><dd class="num">{p.waiting ? '–' : t.stand}<span>/{t.standGoal} hrs</span></dd></div>
        </dl>
      </div>
      {#if p.empty}
        <p class="nudge">No ring data yet. Check the phone’s Health access for Kitchen Frame.</p>
      {:else if p.waiting}
        <p class="nudge">Today’s rings haven’t come from the Watch yet</p>
      {:else}
      <p class="nudge" class:done={n.done} class:behind={!!n.ring} style={n.ring ? `--n:${colors[n.ring]}` : ''}>
        <b>{#if n.ring}{#key beat}<span class="pulse"></span>{/key}{/if}{n.headline}</b>
        {#if n.left.length}<span class="togo">to go</span>{#each n.left as l (l.ring)}<span class="chip" style="--c:{colors[l.ring]}">{l.text}</span>{/each}{/if}
      </p>
      {/if}
      <div class="week">
        {#each p.week as d, i (i)}
          <button class="day" class:today-col={i === 6} class:open={dayOpen && dayOpen.id === p.id && dayOpen.i === i} disabled={!d.raw} onclick={() => showDay(p.id, i)}>
            <Rings move={d.move} exercise={d.exercise} stand={d.stand} size={40} {light} />
            <span>{letter(d.date)}</span>
          </button>
        {/each}
        <!-- A tapped day's numbers, over the row; a second tap, or a few seconds, closes it. -->
        {#if dayOpen && dayOpen.id === p.id && p.week[dayOpen.i].raw}
          {@const d = p.week[dayOpen.i]}
          {@const r = d.raw}
          <div class="bubble" class:first={dayOpen.i === 0} class:last={dayOpen.i === 6} style="left:{(dayOpen.i / 6) * 100}%" role="status">
            <b>{formatDate(d.date, { weekday: 'short', month: 'short', day: 'numeric' })}</b>
            <span class="num"><i style="color:{colors.move}">{Math.round(r.move || 0)}</i>/{Math.round(r.moveGoal || 0)} kcal · <i style="color:{colors.exercise}">{Math.round(r.exercise || 0)}</i>/{Math.round(r.exerciseGoal || 0)} min · <i style="color:{colors.stand}">{Math.round(r.stand || 0)}</i>/{Math.round(r.standGoal || 0)} hrs</span>
            {#if r.steps != null || r.workoutMinutes}<span class="sub num">{[r.steps != null ? Math.round(r.steps).toLocaleString() + ' steps' : '', r.workoutMinutes ? Math.round(r.workoutMinutes) + ' min of workouts' : ''].filter(Boolean).join(' · ')}</span>{/if}
          </div>
        {/if}
      </div>
      <!-- Trends (lib/fitness.js trends()): streaks, today against the usual by this time of day, and
           workout days over 4 weeks. Steps and Exercise are percentages against the usual. -->
      {#if chipsFor(p.trends).length}
        <div class="trends">
          {#each chipsFor(p.trends) as c (c.text)}<span class="trend {c.tone}"><Icon name={c.icon} size={15} />{#if c.parts}{#each c.parts as x, i (x.label)}{i ? ' · ' : ''}{x.label} <b class={x.tone}>{x.value}</b>{/each}{:else}{c.text}{/if}{#if c.note}<i>{c.note}</i>{/if}</span>{/each}
        </div>
      {/if}
      <div class="wh">Recent workouts</div>
      <ul class="workouts">
        <!-- The latest four: what fits under the trends on the frame (the phone sends up to five). -->
        {#each p.workouts.slice(0, 4) as w, i (i)}
          <li><button class="workout" onclick={() => (open = { w, unit: p.unit, who: p.name })}>
            <!-- One line each, so four fit under the trends on the frame; a tap has the rest. -->
            <span class="wi"><Icon name={workoutIcon(w.kind)} size={18} /></span>
            <span class="wt"><b>{w.type}</b><span>{when(new Date(w.start))}</span></span>
            <span class="wn num">{Math.round(w.minutes || 0)} min<span>{w.meters ? distance(w.meters, p.unit) : w.kcal ? Math.round(w.kcal) + ' kcal' : ''}</span></span>
            <span class="more"><Icon name="chevronRight" size={16} /></span>
          </button></li>
        {:else}
          <li class="none">No workouts in the last two weeks</li>
        {/each}
      </ul>
    </section>
  {/each}
</div>

{#if open}<WorkoutSheet workout={open.w} unit={open.unit} who={open.who} onclose={() => (open = null)} />{/if}

<style>
  .fitness { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; height: 100%; padding: 10px 28px 28px; }
  .person { display: flex; flex-direction: column; min-width: 0; padding: 20px 24px; overflow: hidden; }
  /* Three or more: narrower cards side by side, scrolling sideways past three. */
  .fitness.many { grid-template-columns: none; grid-auto-flow: column; grid-auto-columns: minmax(376px, 1fr); overflow-x: auto; }
  .many .today { gap: 16px; }
  .many dd { font-size: 24px; }
  .many .togo { display: none; }
  .fitness.one { grid-template-columns: minmax(0, 640px); justify-content: center; }
  header { display: flex; align-items: flex-start; gap: 12px; }
  .meta { margin-left: auto; display: flex; flex-direction: column; align-items: flex-end; font-size: 14px; color: var(--secondary); }
  .meta b { font-size: 17px; font-weight: 600; color: var(--label); }
  .meta .old { color: var(--orange-text); font-weight: 600; }
  .asof { display: flex; align-items: center; gap: 2px; }
  /* Padding makes it big enough to hit on the frame without making the line taller. */
  .ask { display: flex; align-items: center; gap: 4px; margin: -10px -10px -10px 0; padding: 10px; font-size: 14px; font-weight: 600; color: var(--blue-text); }
  .ask:active { opacity: .6; }
  .asking { color: var(--blue-text); font-weight: 600; }
  /* Old numbers: still shown, but faded so they don't read as now. */
  .stale .today, .stale .nudge, .stale .week { opacity: .45; }
  .none { color: var(--secondary); font-size: 16px; }
  h2 { margin: 0 0 6px; font-size: 26px; font-weight: 700; letter-spacing: -.01em; }
  .today { display: flex; align-items: center; gap: 26px; }
  dl { margin: 0; display: flex; flex-direction: column; gap: 4px; }
  dt { font-size: 14px; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; }
  dd { margin: 0; font-size: 26px; font-weight: 600; line-height: 1.1; }
  dd span { font-size: 18px; font-weight: 500; color: var(--secondary); }
  .nudge { display: flex; align-items: center; gap: 8px; white-space: nowrap; margin: 12px 0 0; padding: 8px 12px; border-radius: 10px; background: var(--fill); font-size: 17px; font-weight: 600;
    box-shadow: inset 4px 0 0 var(--n, var(--secondary)); }
  .nudge b { margin-right: auto; display: flex; align-items: center; gap: 8px; }
  /* Behind: the headline in the ring's colour, with a dot that pulses for about 8 s when it appears
     and again every few minutes (beat); transform and opacity only, then still, so nothing animates
     for long on the frame's GPU. */
  .behind b { color: var(--n); font-weight: 800; }
  .pulse { width: 10px; height: 10px; border-radius: 50%; background: var(--n); animation: pulse 1.2s ease-in-out 7; }
  @keyframes pulse { 0%, 100% { transform: scale(1); opacity: 1; } 50% { transform: scale(1.6); opacity: .5; } }
  .togo { font-size: 14px; font-weight: 600; color: var(--secondary); }
  .chip { padding: 2px 8px; border-radius: 8px; font-size: 15px; font-weight: 700; color: var(--label); box-shadow: inset 0 -3px 0 var(--c); background: var(--sheet); }
  .nudge.done { box-shadow: none; color: var(--label); }
  .week { position: relative; display: flex; justify-content: space-between; margin: 10px 0 4px; }
  .day { color: inherit; padding: 0; }
  .day:disabled { opacity: 1; }
  .day.open span { color: var(--label); }
  .bubble { position: absolute; bottom: calc(100% + 6px); transform: translateX(-50%); z-index: 2; display: flex; flex-direction: column; gap: 2px; padding: 8px 12px;
    border-radius: 12px; background: var(--sheet); box-shadow: 0 2px 10px rgba(0, 0, 0, .25); white-space: nowrap; font-size: 15px; animation: pop .15s ease-out; }
  .bubble.first { transform: none; }
  .bubble.last { transform: translateX(-100%); }
  .bubble i { font-style: normal; font-weight: 800; }
  .bubble .sub { font-size: 13px; color: var(--secondary); }
  @keyframes pop { from { opacity: 0; } to { opacity: 1; } }
  /* Its own section: a rule and room above, then the list (at least 12px, more when there's space). */
  .wh { display: flex; align-items: baseline; gap: 6px; margin: auto 0 0; padding-top: 12px; border-top: 1px solid var(--sep); font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; color: var(--secondary); }
  .day { display: flex; flex-direction: column; align-items: center; gap: 3px; font-size: 14px; font-weight: 600; color: var(--secondary); }
  .today-col span { color: var(--label); }
  .trends { display: flex; flex-wrap: wrap; align-items: center; gap: 5px 6px; margin: 2px 0 12px; }
  .trend { display: flex; align-items: center; gap: 4px; padding: 4px 9px 4px 7px; border-radius: 999px; background: var(--fill); font-size: 14px; font-weight: 700; white-space: nowrap; }
  .trend i { font-style: normal; font-weight: 500; color: var(--secondary); margin-left: 2px; }
  .trend.good, .trend b.good { color: #248a3d; }
  .trend b { font-weight: 800; margin-left: 3px; }
  .trend b.low { color: var(--orange-text); }
  :global([data-theme='dark']) .trend.good, :global([data-theme='dark']) .trend b.good { color: #30d158; }
  :global([data-theme='dark']) .trend b.low { color: #ff9f0a; }
  .workouts { list-style: none; margin: 0; padding: 0; }
  .workouts li + li { border-top: 1px solid var(--sep); }
  .workout { width: 100%; display: flex; align-items: center; gap: 10px; padding: 6px 0; text-align: left; color: inherit; }
  .workout:active { opacity: .6; }
  .more { flex: none; color: var(--tertiary); }
  .wi { flex: none; display: flex; align-items: center; justify-content: center; width: 28px; height: 28px; border-radius: 50%; background: var(--track); color: var(--secondary); }
  .wt { flex: 1; min-width: 0; display: flex; align-items: baseline; gap: 8px; white-space: nowrap; overflow: hidden; }
  .wt b { font-size: 17px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; }
  .wt span, .wn span { font-size: 14px; color: var(--secondary); white-space: nowrap; }
  .wn { flex: none; display: flex; align-items: baseline; gap: 6px; font-size: 17px; font-weight: 600; }
</style>
