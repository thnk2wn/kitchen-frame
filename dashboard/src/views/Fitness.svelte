<script>
  // Fitness: each person's Activity rings today, the last 7 days, a nudge for what's left, and recent
  // workouts. A mockup on demo data (lib/fitness.js) until the phones send real numbers.
  import Rings from '../components/Rings.svelte';
  import Icon from '../components/Icon.svelte';
  import { ui, clock } from '../lib/state.svelte.js';
  import { time, dayKey } from '../lib/format.js';
  import { demoFitness, nudge, RING_COLORS, RING_COLORS_LIGHT } from '../lib/fitness.js';

  let people = $derived(demoFitness(clock.now));
  let light = $derived(ui.theme === 'light');
  let colors = $derived(light ? RING_COLORS_LIGHT : RING_COLORS);
  const letter = (d) => d.toLocaleDateString(undefined, { weekday: 'narrow' });
  function when(d) {
    const days = Math.round((new Date(dayKey(clock.now) + 'T00:00') - new Date(dayKey(d) + 'T00:00')) / 864e5);
    const day = days === 0 ? 'Today' : days === 1 ? 'Yesterday' : d.toLocaleDateString(undefined, { weekday: 'long' });
    return day + ', ' + time(d);
  }
</script>

<div class="fitness">
  {#each people as p (p.name)}
    {@const n = nudge(p, clock.now)}
    <section class="sheet person">
      <h2>{p.name}</h2>
      <div class="today">
        <Rings move={p.move / p.moveGoal} exercise={p.exercise / p.exerciseGoal} stand={p.stand / p.standGoal} size={176} {light} />
        <dl>
          <div><dt style="color:{colors.move}">Move</dt><dd class="num">{p.move}<span>/{p.moveGoal} kcal</span></dd></div>
          <div><dt style="color:{colors.exercise}">Exercise</dt><dd class="num">{p.exercise}<span>/{p.exerciseGoal} min</span></dd></div>
          <div><dt style="color:{colors.stand}">Stand</dt><dd class="num">{p.stand}<span>/{p.standGoal} hrs</span></dd></div>
        </dl>
      </div>
      <p class="nudge" class:done={n.done} style={n.ring ? `--n:${colors[n.ring]}` : ''}>
        <b>{n.headline}</b>
        {#if n.left.length}<span class="togo">to go</span>{#each n.left as l (l.ring)}<span class="chip" style="--c:{colors[l.ring]}">{l.text}</span>{/each}{/if}
      </p>
      <div class="week">
        {#each p.week as d, i (i)}
          <div class="day" class:today-col={i === 6}>
            <Rings move={d.move} exercise={d.exercise} stand={d.stand} size={46} {light} />
            <span>{letter(d.date)}</span>
          </div>
        {/each}
      </div>
      <ul class="workouts">
        {#each p.workouts as w (w.start.getTime())}
          <li>
            <span class="wi"><Icon name={w.icon} size={22} /></span>
            <div class="wt"><b>{w.type}</b><span>{when(w.start)}</span></div>
            <div class="wn num">{w.minutes} min<span>{w.km ? w.km + ' km · ' : ''}{w.kcal} kcal</span></div>
          </li>
        {/each}
      </ul>
    </section>
  {/each}
</div>

<style>
  .fitness { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; height: 100%; padding: 10px 28px 28px; }
  .person { display: flex; flex-direction: column; min-width: 0; padding: 20px 24px; overflow: hidden; }
  h2 { margin: 0 0 6px; font-size: 26px; font-weight: 700; letter-spacing: -.01em; }
  .today { display: flex; align-items: center; gap: 26px; }
  dl { margin: 0; display: flex; flex-direction: column; gap: 8px; }
  dt { font-size: 16px; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; }
  dd { margin: 0; font-size: 30px; font-weight: 600; line-height: 1.1; }
  dd span { font-size: 18px; font-weight: 500; color: var(--secondary); }
  .nudge { display: flex; align-items: center; gap: 8px; white-space: nowrap; margin: 12px 0 0; padding: 8px 12px; border-radius: 10px; background: var(--fill); font-size: 17px; font-weight: 600;
    box-shadow: inset 4px 0 0 var(--n, var(--secondary)); }
  .nudge b { margin-right: auto; }
  .togo { font-size: 14px; font-weight: 600; color: var(--secondary); }
  .chip { padding: 2px 8px; border-radius: 8px; font-size: 15px; font-weight: 700; color: var(--label); box-shadow: inset 0 -3px 0 var(--c); background: var(--sheet); }
  .nudge.done { box-shadow: none; color: var(--label); }
  .week { display: flex; justify-content: space-between; margin: 14px 0 6px; }
  .day { display: flex; flex-direction: column; align-items: center; gap: 3px; font-size: 14px; font-weight: 600; color: var(--secondary); }
  .today-col span { color: var(--label); }
  .workouts { list-style: none; margin: auto 0 0; padding: 0; }
  .workouts li { display: flex; align-items: center; gap: 12px; padding: 7px 0; border-top: 1px solid var(--sep); }
  .wi { flex: none; display: flex; align-items: center; justify-content: center; width: 38px; height: 38px; border-radius: 50%; background: var(--track); color: var(--secondary); }
  .wt { flex: 1; min-width: 0; display: flex; flex-direction: column; }
  .wt b { font-size: 18px; font-weight: 600; }
  .wt span, .wn span { font-size: 14px; color: var(--secondary); }
  .wn { text-align: right; font-size: 18px; font-weight: 600; display: flex; flex-direction: column; }
</style>
