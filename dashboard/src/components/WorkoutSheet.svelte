<script>
  // One workout in detail, opened by tapping it on the Fitness tab: when, time, distance, calories,
  // climb, pace (or speed), average heart rate when its owner shares it, Apple's effort score and the
  // weather the Watch saved. Only what the phone sent (worker/fitness.js); no route or place.
  import Icon from './Icon.svelte';
  import { ui } from '../lib/state.svelte.js';
  import { time } from '../lib/format.js';
  import { workoutIcon, distance } from '../lib/fitness.js';
  // workout: one of a person's workouts; unit: their phone's (mi or km); who: their name; onclose.
  let { workout: w, unit, who, onclose } = $props();
  let light = $derived(ui.theme === 'light');
  // The Fitness app's colours per measure, darker on a light background.
  let c = $derived(light
    ? { time: '#b08600', dist: '#0a7fd6', kcal: '#e0004d', climb: '#3e9b00', pace: '#008c9e', heart: '#e0341f' }
    : { time: '#ffd60a', dist: '#3ea8ff', kcal: '#ff375f', climb: '#8ef24d', pace: '#4fe0f0', heart: '#ff5a3c' });

  const metric = $derived(unit === 'km');
  const seconds = $derived(Math.round((w.minutes || 0) * 60));
  const clock = (s) => Math.floor(s / 3600) + ':' + String(Math.floor((s % 3600) / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
  const end = $derived(new Date(Date.parse(w.start) + seconds * 1000));
  // Pace for walks and runs (min per mile or km), speed for rides; nothing for the rest.
  let pace = $derived.by(() => {
    if (!w.meters || !seconds) return null;
    const per = metric ? w.meters / 1000 : w.meters / 1609.344;
    if (w.kind === 'bike') return { label: 'Avg. Speed', value: (per / (seconds / 3600)).toFixed(1), unit: metric ? 'KM/H' : 'MPH' };
    if (w.kind !== 'walk' && w.kind !== 'run') return null;
    const s = Math.round(seconds / per);
    return { label: 'Avg. Pace', value: Math.floor(s / 60) + '′' + String(s % 60).padStart(2, '0') + '″', unit: metric ? '/KM' : '/MI' };
  });
  // Apple's effort scale: 1-3 easy, 4-6 moderate, 7-8 hard, 9-10 all out.
  const effortWord = (n) => (n <= 3 ? 'Easy' : n <= 6 ? 'Moderate' : n <= 8 ? 'Hard' : 'All Out');
  const effortColor = (n) => (n <= 3 ? '#30c79a' : n <= 6 ? (light ? '#b08600' : '#ffd60a') : n <= 8 ? (light ? '#d46b00' : '#ff9f0a') : (light ? '#d70015' : '#ff453a'));
  let tiles = $derived([
    { label: 'Workout Time', value: clock(seconds), color: c.time },
    w.meters != null && { label: 'Distance', value: distance(w.meters, unit).split(' ')[0], unit: metric ? 'KM' : 'MI', color: c.dist },
    w.kcal != null && { label: 'Active Calories', value: Math.round(w.kcal), unit: 'CAL', color: c.kcal },
    w.totalKcal != null && { label: 'Total Calories', value: Math.round(w.totalKcal), unit: 'CAL', color: c.kcal },
    w.climbMeters != null && { label: 'Elevation Gain', value: Math.round(metric ? w.climbMeters : w.climbMeters * 3.28084), unit: metric ? 'M' : 'FT', color: c.climb },
    pace && { ...pace, color: c.pace },
    w.heartRate != null && { label: 'Avg. Heart Rate', value: Math.round(w.heartRate), unit: 'BPM', color: c.heart },
  ].filter(Boolean));
  let weather = $derived(w.tempC == null ? null : (metric ? Math.round(w.tempC) : Math.round(w.tempC * 9 / 5 + 32)) + '°' + (w.humidity != null ? ' · ' + Math.round(w.humidity) + '% humidity' : ''));
  const day = (d) => d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
</script>

<div class="scrim" role="presentation" onclick={onclose}>
  <div class="panel sheet" role="dialog" aria-label={w.type} tabindex="-1" onclick={(ev) => ev.stopPropagation()} onkeydown={(ev) => ev.key === 'Escape' && onclose()}>
    <header>
      <span class="who"><Icon name={workoutIcon(w.kind)} size={20} />{who}</span>
      <button class="x" onclick={onclose} aria-label="Close"><Icon name="close" size={26} /></button>
    </header>
    <h2>{w.type}</h2>
    <div class="when num">{day(new Date(w.start))}, {time(new Date(w.start)) + ' – ' + time(end) + (weather ? ' · ' + weather : '')}</div>
    <div class="tiles">
      {#each tiles as t (t.label)}
        <div class="tile"><span class="label">{t.label}</span><span class="value num" style="color:{t.color}">{t.value}{#if t.unit}<small>{t.unit}</small>{/if}</span></div>
      {/each}
    </div>
    {#if w.effort != null}
      <div class="effort" style="--e:{effortColor(w.effort)}">
        <span class="label">Effort</span>
        <span class="score num">{Math.round(w.effort)}</span><b>{effortWord(w.effort)}</b>
        <span class="bars">{#each [2, 4, 6, 8, 10] as b (b)}<i class:on={w.effort >= b - 1} style="height:{8 + b * 2.4}px"></i>{/each}</span>
      </div>
    {/if}
  </div>
</div>

<style>
  .scrim { position: fixed; inset: 0; z-index: 40; display: grid; place-items: center; background: rgba(0, 0, 0, .45); }
  .panel { width: 760px; max-width: calc(100vw - 40px); max-height: calc(100vh - 40px); display: flex; flex-direction: column; padding: 18px 24px 24px; border-radius: 26px; overflow: hidden; }
  header { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
  .who { display: flex; align-items: center; gap: 8px; font-size: 16px; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; color: var(--secondary); }
  .x { flex: none; width: 48px; height: 48px; border-radius: 50%; display: grid; place-items: center; background: var(--track); color: var(--label); }
  h2 { margin: 2px 0 4px; font-size: 34px; line-height: 1.1; font-weight: 800; letter-spacing: -.01em; }
  .when { font-size: 18px; color: var(--secondary); margin-bottom: 16px; }
  .tiles { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; }
  .tile { display: flex; flex-direction: column; gap: 2px; padding: 12px 16px; border-radius: 16px; background: var(--fill); }
  .label { font-size: 15px; font-weight: 600; color: var(--secondary); }
  .value { font-size: 34px; font-weight: 700; line-height: 1.1; white-space: nowrap; }
  .value small { font-size: 18px; font-weight: 700; margin-left: 2px; }
  .effort { display: flex; align-items: center; gap: 12px; margin-top: 10px; padding: 12px 16px; border-radius: 16px; background: var(--fill); }
  .effort .label { margin-right: 4px; }
  .score { display: grid; place-items: center; width: 40px; height: 40px; border-radius: 50%; background: var(--sheet); font-size: 20px; font-weight: 700; color: var(--e); }
  .effort b { font-size: 26px; font-weight: 700; color: var(--e); }
  .bars { margin-left: auto; display: flex; align-items: flex-end; gap: 5px; }
  .bars i { width: 12px; border-radius: 4px; background: var(--sheet); }
  .bars i.on { background: var(--e); }
</style>
