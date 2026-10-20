<script>
  import EventRow from '../components/EventRow.svelte';
  import { clock, calendar } from '../lib/state.svelte.js';
  import { calVars, eventsOn, addDays, dayKey, formatDate } from '../lib/format.js';

  // A month of dots (iPhone Calendar style) beside the chosen day's events. offset: months from now.
  let { offset = 0 } = $props();
  const MAX_DOTS = 3;

  let events = $derived(calendar.data ? calendar.data.events : []);
  // Rebuilt when the day changes, not every minute (a derived string only updates when it differs).
  let todayKey = $derived(dayKey(clock.now));
  let first = $derived.by(() => { const [y, m] = todayKey.split('-').map(Number); return new Date(y, m - 1 + offset, 1); });
  let cells = $derived.by(() => {
    const start = addDays(first, -first.getDay()); // weeks start on Sunday
    const daysIn = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
    const count = Math.ceil((first.getDay() + daysIn) / 7) * 7;
    return Array.from({ length: count }, (_, i) => {
      const day = addDays(start, i);
      const key = dayKey(day);
      return { day, key, inMonth: day.getMonth() === first.getMonth(), today: key === todayKey, past: key < todayKey, events: eventsOn(events, day) };
    });
  });
  let rows = $derived(cells.length / 7);

  // Selected day: today in the current month, the 1st otherwise; reset when the month changes.
  let picked = $state(null);
  let lastOffset = offset;
  $effect(() => { if (offset !== lastOffset) { lastOffset = offset; picked = null; } });
  let selected = $derived(cells.find((c) => c.key === picked) || cells.find((c) => (offset === 0 ? c.today : c.inMonth && c.day.getDate() === 1)));
  const WEEKDAYS = Array.from({ length: 7 }, (_, i) => formatDate(new Date(2026, 1, i + 1), { weekday: 'short' })); // Feb 1 2026 is a Sunday
</script>

<div class="month">
  <section class="sheet grid" style="--rows:{rows}">
    {#each WEEKDAYS as w}<span class="wd">{w}</span>{/each}
    {#each cells as c (c.key)}
      <button class="cell" class:out={!c.inMonth} class:past={c.past} class:today={c.today} class:sel={selected && c.key === selected.key}
        onclick={() => (picked = c.key)} aria-label={c.day.toDateString() + ', ' + c.events.length + ' events'}>
        <span class="n num">{c.day.getDate()}</span>
        <span class="dots">
          {#each c.events.slice(0, MAX_DOTS) as e (e.uid + e.start)}<i style={calVars(e)}></i>{/each}
          {#if c.events.length > MAX_DOTS}<b>+</b>{/if}
        </span>
      </button>
    {/each}
  </section>

  <section class="sheet list">
    {#if selected}
      <h2>{formatDate(selected.day, { weekday: 'long', month: 'long', day: 'numeric' })}</h2>
      <div class="events">
        {#each selected.events as e (e.uid + e.start)}
          <EventRow event={e} now={clock.now} />
        {:else}
          <p class="none">No events</p>
        {/each}
      </div>
    {/if}
  </section>
</div>

<style>
  .month { flex: 1; min-height: 0; display: grid; grid-template-columns: 2fr 1fr; gap: 16px; }
  .grid { min-height: 0; display: grid; grid-template-columns: repeat(7, 1fr); grid-template-rows: auto repeat(var(--rows), 1fr); padding: 14px 16px 12px; row-gap: 2px; }
  .wd { padding-bottom: 6px; text-align: center; font-size: 15px; font-weight: 600; text-transform: uppercase; letter-spacing: .04em; color: var(--secondary); }
  .cell { min-height: 0; display: flex; flex-direction: column; align-items: center; justify-content: flex-start; gap: 4px; padding-top: 4px; border-radius: 14px; }
  .cell:active { background: var(--track); }
  .n { width: 42px; height: 42px; border-radius: 50%; display: grid; place-items: center; font-size: 22px; font-weight: 500; }
  .out .n { color: var(--tertiary); }
  .past:not(.out) .n { color: var(--secondary); }
  .today .n { color: var(--red-text); font-weight: 700; }
  .sel .n { background: var(--label); color: var(--sheet); font-weight: 700; }
  .sel.today .n { background: var(--red); color: #fff; }
  .dots { display: flex; align-items: center; gap: 4px; height: 10px; }
  .dots i { width: 8px; height: 8px; border-radius: 50%; background: var(--c); }
  .out .dots i, .past .dots i { opacity: .5; }
  .dots b { font-size: 13px; line-height: 1; color: var(--secondary); }
  .list { min-height: 0; display: flex; flex-direction: column; padding: 20px 22px; }
  .list h2 { margin: 0 0 6px; font-size: 22px; font-weight: 700; letter-spacing: -.01em; }
  .events { min-height: 0; overflow-y: auto; }
  .none { margin: 8px 0 0; font-size: 19px; color: var(--secondary); }
</style>
