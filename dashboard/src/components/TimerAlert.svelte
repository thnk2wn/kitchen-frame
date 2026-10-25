<script>
  // Full screen when a timer ends, over everything (the clock screen included), until dismissed.
  // Not while the timers are full screen (TimerFull.svelte), where the timer turns red in place.
  import Icon from './Icon.svelte';
  import { timers, ringing, removeTimer, addTime, unnamed, spokenLength } from '../lib/timers.svelte.js';
  let list = $derived(ringing());
</script>

{#if list.length && !timers.big}
  <div class="alert" role="alertdialog" aria-label="Timer done">
    <div class="card sheet">
      <span class="ic"><Icon name="timer" size={44} /></span>
      {#each list as t (t.id)}
        <h1>{unnamed(t.label) ? 'Time’s up' : t.label}</h1>
        <p>{spokenLength(t.total)} timer is done</p>
        <div class="row">
          <button class="more" onclick={() => addTime(t.id, 60)}>+1 min</button>
          <button class="done" onclick={() => removeTimer(t.id)}>Dismiss</button>
        </div>
      {/each}
    </div>
  </div>
{/if}

<style>
  .alert { position: fixed; inset: 0; z-index: 50; display: grid; place-items: center; background: rgba(0, 0, 0, .55); }
  .card { min-width: 520px; max-width: 760px; padding: 36px 44px; border-radius: 28px; text-align: center; display: flex; flex-direction: column; align-items: center; gap: 6px; }
  .ic { width: 84px; height: 84px; border-radius: 50%; display: grid; place-items: center; background: var(--orange); color: #fff; margin-bottom: 8px; }
  h1 { margin: 6px 0 0; font-size: 44px; font-weight: 800; letter-spacing: -.02em; }
  p { margin: 0 0 12px; font-size: 22px; color: var(--secondary); }
  .row { display: flex; gap: 14px; margin-bottom: 10px; }
  .row button { height: 60px; min-width: 170px; padding: 0 26px; border-radius: 30px; font-size: 22px; font-weight: 700; }
  .more { background: var(--track); }
  .done { background: var(--orange); color: #fff; }
  .row button:active { opacity: .7; }
</style>
