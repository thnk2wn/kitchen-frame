<script>
  // Top bar: a button to start a timer (presets or custom), which joins the row of running timers
  // along the bottom (TimerDock.svelte), whose button opens them full screen. Hidden once three run.
  import Icon from './Icon.svelte';
  import { timers, startTimer, renameTimer, timerNames, MAX_TIMERS } from '../lib/timers.svelte.js';

  const PRESETS = [1, 3, 5, 10, 15, 20, 30, 45, 60];
  // Time first, like "set a 5 minute pasta timer": a time starts at once, then the menu offers
  // one-tap names for it (no microphone here, and nobody wants to type in a kitchen).
  const NAMES = timerNames();
  let naming = $state(null); // id of the timer just started, while its names are offered
  let open = $state(false);   // the start menu
  let custom = $state(10);    // minutes for the custom row
  let running = $derived(timers.list.filter((t) => !t.done).length);

  function start(min) { naming = startTimer(min + ' min', min * 60); }
  function done() { naming = null; open = false; }
  function nameIt(n) { renameTimer(naming, n); done(); }
  function toggle() { open = !open; naming = null; }
  // A tap anywhere outside closes the start menu (a timer already started keeps running, unnamed).
  let root = $state();
  $effect(() => {
    if (!open) return;
    const away = (e) => { if (root && !root.contains(e.target)) { if (naming) done(); else open = false; } };
    document.addEventListener('pointerdown', away, true);
    return () => document.removeEventListener('pointerdown', away, true);
  });
</script>

<div class="timers" bind:this={root}>
  <div class="wrapchip">
    {#if running < MAX_TIMERS}
      <button class="gear" onclick={toggle} aria-label="Start a timer" aria-expanded={open}><Icon name="timer" size={25} /></button>
    {/if}
    {#if open && naming}
      <div class="menu sheet start">
        <p class="hint">Started. Name it?</p>
        <div class="names">
          {#each NAMES as n (n)}<button onclick={() => nameIt(n)}>{n}</button>{/each}
        </div>
        <button class="skip" onclick={done}>No name</button>
      </div>
    {:else if open}
      <div class="menu sheet start">
        <div class="grid">
          {#each PRESETS as m (m)}<button onclick={() => start(m)}>{m < 60 ? m + ' min' : '1 hr'}</button>{/each}
        </div>
        <div class="custom">
          <button aria-label="Less" onclick={() => (custom = Math.max(1, custom - (custom > 10 ? 5 : 1)))}><Icon name="minus" size={18} /></button>
          <span class="num">{custom} min</span>
          <button aria-label="More" onclick={() => (custom = Math.min(240, custom + (custom >= 10 ? 5 : 1)))}><Icon name="plus" size={18} /></button>
          <button class="go" onclick={() => start(custom)}>Start</button>
        </div>
      </div>
    {/if}
  </div>
</div>

<style>
  .timers { display: flex; align-items: center; gap: 8px; }
  .wrapchip { position: relative; }
  .gear { width: 48px; height: 48px; border-radius: 50%; display: grid; place-items: center; color: var(--secondary); }
  .gear:active { background: var(--track); }
  .menu { position: absolute; top: 54px; right: 0; z-index: 20; display: flex; flex-direction: column; gap: 4px; padding: 8px; border-radius: 16px; min-width: 190px; box-shadow: 0 6px 20px rgba(0, 0, 0, .18); }
  .menu button { height: 46px; padding: 0 14px; border-radius: 10px; font-size: 18px; font-weight: 600; text-align: left; }
  .menu button:active { background: var(--track); }
  .start { width: 330px; }
  .hint { margin: 2px 6px 6px; font-size: 16px; color: var(--secondary); }
  .names { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }
  .names button { text-align: center; background: var(--orange); color: #fff; }
  .skip { margin-top: 4px; text-align: center !important; color: var(--secondary); }
  .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }
  .grid button { text-align: center; background: var(--track); }
  .custom { display: flex; align-items: center; gap: 8px; margin-top: 6px; padding-top: 8px; border-top: 1px solid var(--sep); }
  .custom button:not(.go) { width: 44px; padding: 0; display: grid; place-items: center; background: var(--track); border-radius: 50%; }
  .custom span { flex: 1; text-align: center; font-size: 19px; font-weight: 600; }
  .go { background: var(--orange) !important; color: #fff; text-align: center !important; }
</style>
