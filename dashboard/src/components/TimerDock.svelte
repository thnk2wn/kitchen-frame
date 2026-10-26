<script>
  // The running timers as a row along the bottom of every tab: readable from the stove without full
  // screen hiding the tab. Each timer gets a card with its picture, name, digits big enough to read at
  // a glance, its progress, +1 min and cancel; a tap on it, or the button at the end, opens them full screen. The tab
  // above shrinks to make room while they run (App.svelte), so nothing is covered. A timer that ends
  // still raises the alert (TimerAlert.svelte).
  import Icon from './Icon.svelte';
  import { timers, addTime, removeTimer, remaining, clockOf, timerPicture } from '../lib/timers.svelte.js';

  let list = $derived([...timers.list].sort((a, b) => (b.done - a.done) || a.end - b.end));
</script>

<div class="dock" role="group" aria-label="Timers">
  {#each list as t (t.id)}
    <div class="card" class:ring={t.done}>
      <!-- The picture, name and digits open the timers full screen, as the button at the end does. -->
      <button class="open" onclick={() => (timers.big = true)} aria-label={t.label + ', full screen'}>
      <span class="pic"><Icon name={timerPicture(t.label) || 'timer'} size={30} /></span>
      <span class="what">
        <span class="name">{t.label}</span>
        {#if t.done}
          <span class="digits up">Time’s up</span>
        {:else}
          <span class="digits num" class:soon={remaining(t) <= 60}>{clockOf(remaining(t))}</span>
          <span class="track"><span class="bar" style="transform: scaleX({remaining(t) / t.total})"></span></span>
        {/if}
      </span>
      </button>
      <button class="more" onclick={() => addTime(t.id, 60)}>+1 min</button>
      <button class="stop" onclick={() => removeTimer(t.id)} aria-label={(t.done ? 'Dismiss ' : 'Cancel ') + t.label}><Icon name={t.done ? 'check' : 'close'} size={24} /></button>
    </div>
  {/each}
  <button class="big" onclick={() => (timers.big = true)} aria-label="Timers full screen"><Icon name="maximize" size={26} /></button>
</div>

<style>
  .dock { position: relative; z-index: 1; flex: none; display: flex; align-items: center; gap: 12px; padding: 10px 28px 14px; border-top: 1px solid var(--sep); background: var(--ground); }
  .card { flex: 1; min-width: 0; max-width: 460px; height: 84px; display: flex; align-items: center; gap: 10px; padding: 0 10px 0 16px; border-radius: 22px; background: var(--sheet); }
  .card.ring { background: var(--pal-red-tint); }
  .open { flex: 1; min-width: 0; align-self: stretch; display: flex; align-items: center; gap: 12px; text-align: left; color: inherit; }
  .pic { flex: none; color: var(--secondary); }
  .what { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
  .name { font-size: 17px; font-weight: 600; color: var(--secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .digits { font-size: 40px; line-height: 1; font-weight: 700; letter-spacing: -.02em; color: var(--orange-text); white-space: nowrap; }
  .digits.soon, .digits.up { color: var(--red-text); }
  .digits.up { font-size: 28px; }
  .track { height: 6px; border-radius: 3px; background: var(--track); overflow: hidden; }
  .bar { display: block; height: 100%; background: var(--orange); transform-origin: left; transition: transform 1s linear; }
  .more { flex: none; height: 56px; padding: 0 16px; border-radius: 28px; font-size: 18px; font-weight: 700; text-align: center; background: var(--fill); }
  .stop { flex: none; width: 56px; height: 56px; border-radius: 50%; display: grid; place-items: center; background: var(--fill); color: var(--red-text); }
  .ring .stop { background: var(--orange); color: #fff; }
  .big { flex: none; margin-left: auto; width: 60px; height: 60px; border-radius: 50%; display: grid; place-items: center; background: var(--fill); }
  button:active { opacity: .7; }
</style>
