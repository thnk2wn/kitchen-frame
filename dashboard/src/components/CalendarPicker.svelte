<script>
  // Calendars: show or hide each feed on this device (Home, week, month, clock screen). The choice
  // is kept in localStorage, so it survives reloads and restarts. up: open the menu upwards.
  import Icon from './Icon.svelte';
  import { hiddenCals, toggleCalendar, calendarNames } from '../lib/state.svelte.js';
  import { calColorVars } from '../lib/format.js';
  let { up = false, plain = false } = $props();
  let picking = $state(false);
  let names = $derived(calendarNames());
</script>

{#if names.length > 1}
  <div class="cals" class:up class:plain>
    <button class="cal-btn" class:some-off={hiddenCals.set.size} onclick={() => (picking = !picking)} aria-expanded={picking}>
      Calendars{#if hiddenCals.set.size}<span class="off num">{names.length - hiddenCals.set.size}/{names.length}</span>{/if}
    </button>
    {#if picking}
      <div class="cal-menu sheet" role="menu">
        {#each names as name, i (i)}
          <button role="menuitemcheckbox" aria-checked={!hiddenCals.set.has(i)} class:hidden={hiddenCals.set.has(i)} onclick={() => toggleCalendar(i)} style={calColorVars(i)}>
            <span class="box">{#if !hiddenCals.set.has(i)}<Icon name="check" size={16} />{/if}</span>{name}
          </button>
        {/each}
      </div>
    {/if}
  </div>
{/if}

<style>
  .cals { position: relative; margin-right: 6px; }
  .cal-btn { display: flex; align-items: center; gap: 8px; height: 44px; padding: 0 16px; border-radius: 12px; background: var(--track); font-size: 17px; font-weight: 600; color: var(--label); }
  .cal-btn .off { font-size: 14px; color: var(--secondary); }
  .cal-menu { position: absolute; top: 52px; right: 0; z-index: 5; min-width: 260px; padding: 8px; border-radius: 16px; display: flex; flex-direction: column; box-shadow: 0 6px 20px rgba(0, 0, 0, .18); }
  .cal-menu button { display: flex; align-items: center; gap: 12px; height: 48px; padding: 0 12px; border-radius: 10px; font-size: 18px; font-weight: 500; text-align: left; }
  .cal-menu button:active { background: var(--track); }
  .cal-menu button.hidden { color: var(--secondary); }
  .box { flex: none; width: 24px; height: 24px; border-radius: 7px; border: 2px solid var(--c); background: var(--c); color: #fff; display: grid; place-items: center; }
  .hidden .box { background: none; }
  .up .cal-menu { top: auto; bottom: 52px; left: 0; right: auto; }
  /* plain: a text link, like the card footer's "Show week". */
  .plain .cal-btn { height: auto; padding: 8px 0 0; background: none; font-size: 19px; color: var(--blue-text); }
</style>
