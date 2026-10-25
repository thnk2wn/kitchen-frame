<script>
  // The timers full screen, to read from across the kitchen: opened from the timers' menu in the top
  // bar, and by itself for a timer started through Alexa (lib/timers.svelte.js fromVoice). One timer
  // fills the screen; two or three share it in columns, ending soonest first. A timer that ends turns
  // red in its place, with +1 min and Dismiss, instead of the alert card. It closes when the last
  // timer is dismissed or cancelled, or with its button. Only the digits' text changes each second.
  import Icon from './Icon.svelte';
  import { timers, startTimer, addTime, removeTimer, remaining, clockOf, MAX_TIMERS } from '../lib/timers.svelte.js';

  const PRESETS = [1, 3, 5, 10, 15, 20, 30, 45, 60];
  let list = $derived([...timers.list].sort((a, b) => (b.done - a.done) || a.end - b.end));
  let running = $derived(timers.list.filter((t) => !t.done).length);
  let adding = $state(false);
  // Digits as big as a column allows: each character is about 0.6 of the font size wide, and a
  // timer of an hour or more ("1:02:30") has more of them. Capped so one timer leaves room for its
  // name and buttons.
  let w = $state(window.innerWidth);
  let size = $derived.by(() => {
    const n = Math.max(1, list.length), chars = Math.max(4, ...list.map((t) => (t.done ? 4 : clockOf(remaining(t)).length)));
    const col = (w - 48 - 16 * (n - 1)) / n - 40;
    return Math.floor(Math.min(n === 1 ? 280 : n === 2 ? 200 : 150, col / (chars * 0.6)));
  });
</script>

<svelte:window onresize={() => (w = window.innerWidth)} />

{#if timers.big && list.length}
  <div class="full" role="dialog" aria-label="Timers" tabindex="-1"
    onkeydown={(e) => { if (e.key === 'Escape') timers.big = false; }}>
    <div class="cols" style="--digits: {size}px">
      {#each list as t (t.id)}
        <div class="col" class:ring={t.done}>
          <span class="name">{t.label}</span>
          {#if t.done}
            <span class="digits up">Time’s up</span>
          {:else}
            <span class="digits num" class:soon={remaining(t) <= 60}>{clockOf(remaining(t))}</span>
            <span class="track"><span class="bar" style="transform: scaleX({remaining(t) / t.total})"></span></span>
          {/if}
          <div class="row">
            <button class="more" onclick={() => addTime(t.id, 60)}>+1 min</button>
            {#if t.done}
              <button class="done" onclick={() => removeTimer(t.id)}>Dismiss</button>
            {:else}
              <button class="stop" onclick={() => removeTimer(t.id)}>Cancel</button>
            {/if}
          </div>
        </div>
      {/each}
    </div>
    <div class="foot">
      {#if adding}
        {#each PRESETS as m (m)}<button class="preset" onclick={() => { startTimer(m + ' min', m * 60); adding = false; }}>{m < 60 ? m + ' min' : '1 hr'}</button>{/each}
        <button class="preset" onclick={() => (adding = false)} aria-label="Never mind"><Icon name="close" size={22} /></button>
      {:else if running < MAX_TIMERS}
        <button class="new" onclick={() => (adding = true)}><Icon name="plus" size={22} />New timer</button>
      {/if}
    </div>
    <button class="small" onclick={() => (timers.big = false)} aria-label="Smaller"><Icon name="minimize" size={28} /></button>
  </div>
{/if}

<style>
  .full { position: fixed; top: 0; right: 0; bottom: 0; left: 0; z-index: 46; display: flex; flex-direction: column; background: var(--ground); color: var(--label); }
  .cols { flex: 1; display: flex; gap: 16px; padding: 84px 24px 8px; min-height: 0; }
  .col { flex: 1; min-width: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 14px; border-radius: 28px; background: var(--sheet); padding: 20px; }
  .col.ring { background: var(--pal-red-tint); }
  .name { max-width: 100%; font-size: 34px; font-weight: 700; color: var(--secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .digits { font-size: var(--digits); line-height: 1; font-weight: 700; letter-spacing: -.03em; color: var(--orange-text); white-space: nowrap; }
  .digits.soon, .digits.up { color: var(--red-text); }
  .digits.up { font-size: calc(var(--digits) * .55); }
  .track { width: 80%; height: 10px; border-radius: 5px; background: var(--track); overflow: hidden; }
  .bar { display: block; height: 100%; background: var(--orange); transform-origin: left; transition: transform 1s linear; }
  .row { display: flex; gap: 14px; margin-top: 6px; }
  .row button { height: 60px; min-width: 140px; padding: 0 22px; border-radius: 30px; font-size: 22px; font-weight: 700; background: var(--fill); }
  .row .done { background: var(--orange); color: #fff; }
  .row .stop { color: var(--red-text); }
  .foot { display: flex; justify-content: center; align-items: center; gap: 8px; height: 92px; padding: 0 24px 16px; }
  .new, .preset { height: 60px; padding: 0 22px; border-radius: 30px; font-size: 21px; font-weight: 700; background: var(--fill); }
  .new { display: flex; align-items: center; gap: 8px; color: var(--orange-text); }
  .preset { padding: 0 16px; display: grid; place-items: center; }
  .small { position: absolute; top: 16px; right: 16px; width: 60px; height: 60px; border-radius: 50%; display: grid; place-items: center; background: var(--fill); }
  button:active { opacity: .7; }
</style>
