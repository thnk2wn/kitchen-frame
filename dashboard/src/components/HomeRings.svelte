<script>
  // Each person's rings on Home, in the room under the clock when notices and Now Playing leave it
  // (Home decides). Roomy: big rings with the three numbers; tight: smaller rings and the nudge.
  // A tap opens Fitness. Faded when a phone's numbers are old (lib/fitness.js STALE_MS); "Waiting for
  // the Watch" when the phone hasn't had today's rings yet.
  import Rings from './Rings.svelte';
  import { ui, clock } from '../lib/state.svelte.js';
  import { nudge, replayBeat, RING_COLORS, RING_COLORS_LIGHT } from '../lib/fitness.js';
  // people: lib/fitness.js view()s; height: the room there is, in px.
  let { people, height } = $props();
  let light = $derived(ui.theme === 'light');
  let colors = $derived(light ? RING_COLORS_LIGHT : RING_COLORS);
  // Replays Behind's pulsing every few minutes on a Home that's been up a while (lib/fitness.js).
  let beat = $derived(replayBeat(clock.now));
  let roomy = $derived(height >= 104);
  // With two or more side by side there's only room for "Behind": its colour says which ring.
  const label = { move: 'Move', exercise: 'Exercise', stand: 'Stand' };
  let size = $derived(roomy ? Math.min(88, height - 16) : Math.max(40, Math.min(56, height - 12)));
</script>

<button class="home-rings" class:roomy onclick={() => (ui.tab = 'fitness')} aria-label="Fitness">
  {#each people as p (p.id)}
    {@const t = p.today}
    {@const n = nudge(t, clock.now, p.usual)}
    <span class="person" class:stale={p.stale}>
      {#key beat}<Rings move={p.rings.move} exercise={p.rings.exercise} stand={p.rings.stand} {size} {light} pulse={p.waiting ? null : n.ring} />{/key}
      <span class="text">
        <b>{p.name}</b>
        {#if p.waiting}<span class="note">Waiting for the Watch</span>
        {:else if roomy && n.ring}<span class="behind" style="--n:{colors[n.ring]}">{#key beat}<span class="pulse"></span>{/key}{people.length > 1 ? 'Behind' : label[n.ring] + ' behind'}</span>{/if}
        {#if p.waiting}
          <!-- No rings for today yet (lib/fitness.js view()): the note above says so, no zeros. -->
        {:else if roomy}
          <span class="num" style="color:{colors.move}">{t.move}<i>/{t.moveGoal}</i></span>
          <span class="num" style="color:{colors.exercise}">{t.exercise}<i>/{t.exerciseGoal} min</i></span>
          <span class="num" style="color:{colors.stand}">{t.stand}<i>/{t.standGoal} hrs</i></span>
        {:else}
          {#if n.ring}<span class="behind" style="--n:{colors[n.ring]}">{#key beat}<span class="pulse"></span>{/key}{people.length > 1 ? 'Behind' : label[n.ring] + ' behind'}</span>
          {:else}<span class="note">{n.done ? 'All closed' : n.idle ? 'Not started' : n.ahead ? 'Ahead' : 'On track'}</span>{/if}
        {/if}
      </span>
    </span>
  {/each}
</button>

<style>
  .home-rings { display: flex; gap: 12px; width: 100%; padding: 0 4px; text-align: left; color: inherit; }
  .home-rings:active { opacity: .6; }
  .person { flex: 1 1 0; min-width: 0; display: flex; align-items: center; gap: 10px; }
  .stale { opacity: .45; }
  .text { min-width: 0; display: flex; flex-direction: column; line-height: 1.15; }
  b { font-size: 18px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .num { font-size: 17px; font-weight: 700; white-space: nowrap; }
  .num i { font-style: normal; font-size: 13px; font-weight: 500; color: var(--secondary); }
  /* Behind: bold, in the ring's colour, its dot pulsing for about 8 s when it appears and every few minutes (Fitness.svelte). */
  .behind { display: flex; align-items: center; gap: 6px; font-size: 15px; font-weight: 800; color: var(--n); white-space: nowrap; }
  .pulse { flex: none; width: 8px; height: 8px; border-radius: 50%; background: var(--n); animation: pulse 1.2s ease-in-out 7; }
  @keyframes pulse { 0%, 100% { transform: scale(1); opacity: 1; } 50% { transform: scale(1.6); opacity: .5; } }
  .note { font-size: 14px; color: var(--secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
</style>
