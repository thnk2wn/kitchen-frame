<script>
  // Top bar: running timers as countdown chips, and a button to start one (presets or custom).
  import Icon from './Icon.svelte';
  import { timers, startTimer, renameTimer, timerNames, addTime, removeTimer, remaining, clockOf } from '../lib/timers.svelte.js';

  const PRESETS = [1, 3, 5, 10, 15, 20, 30, 45, 60];
  // Time first, like "set a 5 minute pasta timer": a time starts at once, then the menu offers
  // one-tap names for it (no microphone here, and nobody wants to type in a kitchen).
  const NAMES = timerNames();
  let naming = $state(null); // id of the timer just started, while its names are offered
  let open = $state(false);   // the start menu
  let focus = $state(false);  // the running timers' menu
  let custom = $state(10);    // minutes for the custom row
  // One chip in the top bar: the timer that ends next, with "+N" when others run (up to 3 in all).
  const MAX = 3;
  let running = $derived(timers.list.filter((t) => !t.done).sort((a, b) => a.end - b.end));
  let next = $derived(running[0]);

  function start(min) { naming = startTimer(min + ' min', min * 60); }
  function nameIt(n) { renameTimer(naming, n); naming = null; open = false; }
  function toggle() { open = !open; focus = false; naming = null; }
  // A tap anywhere outside closes the menus (the start menu, a timer's details).
  let root = $state();
  $effect(() => {
    if (!open && !focus) return;
    const away = (e) => { if (root && !root.contains(e.target)) { open = false; focus = false; naming = null; } };
    document.addEventListener('pointerdown', away, true);
    return () => document.removeEventListener('pointerdown', away, true);
  });
</script>

<div class="timers" bind:this={root}>
  {#if next}
    <div class="wrapchip">
      <button class="chip num" class:soon={remaining(next) <= 60} onclick={() => { focus = !focus; open = false; }}>
        <Icon name="timer" size={18} /><span class="lbl">{next.label}</span>{clockOf(remaining(next))}{#if running.length > 1}<span class="more">+{running.length - 1}</span>{/if}
      </button>
      {#if focus}
        <div class="menu sheet list">
          {#if running.length < MAX}
            <button class="newt" onclick={() => { focus = false; open = true; naming = null; }}><Icon name="plus" size={18} />New timer</button>
          {/if}
          {#each running as t (t.id)}
            <div class="trow">
              <span class="tname">{t.label}</span><span class="tleft num">{clockOf(remaining(t))}</span>
              <button onclick={() => addTime(t.id, 60)}>+1</button>
              <button class="stop" aria-label={'Cancel ' + t.label} onclick={() => { removeTimer(t.id); if (running.length <= 1) focus = null; }}>✕</button>
            </div>
          {/each}
        </div>
      {/if}
    </div>
  {/if}
  <div class="wrapchip">
    <!-- With a timer running, starting another is in its menu, so the top bar stays narrow. -->
    {#if !next}
      <button class="gear" onclick={toggle} aria-label="Start a timer" aria-expanded={open}><Icon name="timer" size={25} /></button>
    {/if}
    {#if open && naming}
      <div class="menu sheet start">
        <p class="hint">Started. Name it?</p>
        <div class="names">
          {#each NAMES as n (n)}<button onclick={() => nameIt(n)}>{n}</button>{/each}
        </div>
        <button class="skip" onclick={() => { naming = null; open = false; }}>No name</button>
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
  .chip { display: flex; align-items: center; gap: 6px; height: 40px; padding: 0 14px; border-radius: 20px; background: var(--orange); color: #fff; font-size: 18px; font-weight: 700; }
  .chip.soon { background: var(--red); }
  .chip .more { margin-left: 2px; padding: 1px 7px; border-radius: 10px; background: rgba(255, 255, 255, .3); font-size: 14px; }
  .list { min-width: 300px; }
  .newt { display: flex; align-items: center; gap: 8px; color: var(--orange-text); }
  .trow { display: flex; align-items: center; gap: 8px; padding: 2px 4px 2px 10px; }
  .tname { flex: 1; min-width: 0; font-size: 18px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .tleft { font-size: 18px; font-weight: 700; color: var(--orange-text); }
  .trow button { width: 46px; padding: 0; text-align: center; background: var(--track); border-radius: 50%; }
  .chip .lbl { max-width: 96px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; opacity: .9; }
  .gear { width: 48px; height: 48px; border-radius: 50%; display: grid; place-items: center; color: var(--secondary); }
  .gear:active { background: var(--track); }
  .menu { position: absolute; top: 54px; right: 0; z-index: 20; display: flex; flex-direction: column; gap: 4px; padding: 8px; border-radius: 16px; min-width: 190px; box-shadow: 0 6px 20px rgba(0, 0, 0, .18); }
  .menu button { height: 46px; padding: 0 14px; border-radius: 10px; font-size: 18px; font-weight: 600; text-align: left; }
  .menu button:active { background: var(--track); }
  .menu .stop { color: var(--red-text); }
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
