<script>
  import Txt from '../components/Txt.svelte';
  import Icon from '../components/Icon.svelte';
  import { clock, calendar, loadCalendar, canOpen, openEvent } from '../lib/state.svelte.js';
  import CalendarPicker from '../components/CalendarPicker.svelte';
  import { calVars, eventsOn, addDays, time, isPast, formatDate } from '../lib/format.js';
  import Month from './Month.svelte';

  const WEEKS = 5;   // week view pages through five weeks
  const MONTHS = 2;  // month view: this month and next (the Worker fetches ~10 weeks ahead)
  // Week or month, remembered on the frame.
  let view = $state(localStorage.getItem('frame-cal-view') === 'month' ? 'month' : 'week');
  function setView(v) { view = v; localStorage.setItem('frame-cal-view', v); }
  let month = $state(0); // 0 = this month, 1 = next
  let week = $state(0); // 0 = the next 7 days, 1 = the 7 after that, …
  let open = $state(null); // tapped event shows its full title, time range and location
  let days = $derived(Array.from({ length: 7 }, (_, i) => {
    const day = addDays(clock.now, week * 7 + i);
    return { day, i, today: week === 0 && i === 0, events: eventsOn(calendar.data ? calendar.data.events : [], day) };
  }));
  const short = (d) => formatDate(d, { month: 'short', day: 'numeric' });
  let label = $derived(view === 'month'
    ? formatDate(new Date(clock.now.getFullYear(), clock.now.getMonth() + month, 1), { month: 'long', year: 'numeric' })
    : week === 0 ? 'This week' : week === 1 ? 'Next week' : short(days[0].day) + ' – ' + short(days[6].day));
  // The arrows page whichever view is showing.
  let page = $derived(view === 'month' ? month : week);
  let pages = $derived(view === 'month' ? MONTHS : WEEKS);
  function go(n) { if (view === 'month') month = n; else week = n; }
  let nextCount = $derived.by(() => {
    // Events further out, so an empty week still hints that more is coming. Holidays don't count.
    if (view === 'month' || !calendar.data || week >= WEEKS - 1) return 0;
    const from = addDays(clock.now, (week + 1) * 7).getTime();
    return calendar.data.events.filter((e) => !e.holiday && Date.parse(e.start) >= from).length;
  });
  const key = (e) => e.uid + e.start;
</script>

<div class="wrap">
  <header class="bar">
    <h2>{label}</h2>
    <div class="pager">
      {#if page > 0}<button class="today-btn" onclick={() => go(0)}>Today</button>{/if}
      <CalendarPicker />
      <div class="seg" role="tablist" aria-label="Calendar view">
        <button role="tab" aria-selected={view === 'week'} class:on={view === 'week'} onclick={() => setView('week')}>Week</button>
        <button role="tab" aria-selected={view === 'month'} class:on={view === 'month'} onclick={() => setView('month')}>Month</button>
      </div>
      <button class="nav" disabled={page === 0} onclick={() => go(page - 1)} aria-label={'Previous ' + view}><Icon name="chevronLeft" size={26} /></button>
      <button class="nav" disabled={page >= pages - 1} onclick={() => go(page + 1)} aria-label={'Next ' + view}><Icon name="chevronRight" size={26} />{#if nextCount}<span class="badge num">{nextCount}</span>{/if}</button>
    </div>
  </header>
  {#if view === 'month'}
    <Month offset={month} />
  {:else}
  <div class="sheet week">
    {#if !calendar.data && calendar.offline}
      <div class="fail">
        <p>Couldn’t load the calendar.</p>
        <button onclick={loadCalendar}>Try again</button>
      </div>
    {:else}
      {#each days as d (d.i)}
        <section class="day">
          <header>
            <span class="dow">{formatDate(d.day, { weekday: 'short' })}</span>
            <span class="num date" class:today={d.today}>{d.day.getDate()}</span>
          </header>
          <!-- Busy days scroll inside their column; nothing is hidden behind a count. -->
          <div class="events">
            {#each d.events as e (key(e))}
              <button class="ev" class:past={isPast(e, clock.now)} class:open={open === key(e)} style={calVars(e)}
                onclick={() => (canOpen(e) ? openEvent(e) : (open = open === key(e) ? null : key(e)))}>
                <span class="title"><Txt text={e.title} /></span>
                {#if !e.allDay}<span class="t num">{time(new Date(e.start))}{open === key(e) ? ' – ' + time(new Date(e.end)) : ''}</span>{/if}
                {#if open === key(e) && e.location}<span class="t">{e.location}</span>{/if}
              </button>
            {/each}
          </div>
        </section>
      {/each}
    {/if}
  </div>
  {/if}
  {#if calendar.data && calendar.offline}<p class="stale">Offline · showing the calendar from {time(new Date(calendar.data.updated))}</p>{/if}
</div>

<style>
  .wrap { position: relative; height: 100%; padding: 0 28px 28px; display: flex; flex-direction: column; }
  .bar { flex: none; display: flex; align-items: center; justify-content: space-between; padding: 0 6px 10px; }
  .bar h2 { margin: 0; font-size: 24px; font-weight: 700; letter-spacing: -.01em; }
  .pager { display: flex; align-items: center; gap: 8px; }
  .nav { position: relative; width: 52px; height: 44px; border-radius: 12px; background: var(--track); display: grid; place-items: center; color: var(--label); }
  .nav:disabled { opacity: .3; }
  .nav:not(:disabled):active { opacity: .6; }
  .badge { position: absolute; top: -6px; right: -6px; min-width: 22px; height: 22px; padding: 0 6px; border-radius: 11px; background: var(--red); color: #fff; font-size: 13px; font-weight: 700; display: grid; place-items: center; }
  .seg { display: flex; padding: 3px; border-radius: 12px; background: var(--track); margin-right: 6px; }
  .seg button { min-width: 84px; height: 38px; padding: 0 14px; border-radius: 9px; font-size: 17px; font-weight: 500; text-align: center; color: var(--label); }
  .seg button.on { background: var(--thumb); font-weight: 600; }
  .today-btn { height: 44px; padding: 0 16px; border-radius: 12px; font-size: 18px; font-weight: 600; color: var(--blue-text); }
  .week { flex: 1; min-height: 0; display: grid; grid-template-columns: repeat(7, 1fr); padding: 20px 0; }
  .day { min-width: 0; min-height: 0; display: flex; flex-direction: column; padding: 0 10px; border-left: 1px solid var(--sep); }
  .day:first-child { border-left: 0; }
  .day header { flex: none; display: flex; flex-direction: column; align-items: center; gap: 4px; padding-bottom: 14px; }
  .dow { font-size: 15px; font-weight: 600; text-transform: uppercase; letter-spacing: .04em; color: var(--secondary); }
  .date { width: 46px; height: 46px; border-radius: 50%; display: grid; place-items: center; font-size: 26px; font-weight: 500; }
  .date.today { background: var(--red); color: #fff; font-weight: 600; }
  .events { flex: 1; min-height: 0; overflow-y: auto; }
  /* Tinted block plus a solid bar in the calendar's colour: a tint alone muddies on dark (orange reads brown). */
  .ev { display: block; width: 100%; padding: 7px 9px 7px 10px; margin-bottom: 6px; border-radius: 10px; background: var(--c-tint); border-left: 4px solid var(--c); }
  .ev:active { opacity: .7; }
  /* Past: drop the colour fill and soften the title, but keep it readable. */
  /* At night a dim tint turns orange brown and yellow olive, so (as iOS Calendar does) the title takes
     the calendar's bright colour instead; by day the tint carries it and titles stay black. */
  :global([data-theme="dark"]) .ev:not(.past) .title { color: var(--c); }
  .ev.past { background: transparent; border-left-color: transparent; padding-left: 0; padding-right: 0; }
  .ev.past .title { color: var(--secondary); }
  .title { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; font-size: 17px; font-weight: 600; line-height: 1.2; overflow-wrap: anywhere; }
  .open .title { display: block; }
  .t { display: block; font-size: 14px; color: var(--secondary); margin-top: 2px; }
  .fail { grid-column: 1 / -1; align-self: center; text-align: center; font-size: 22px; color: var(--secondary); }
  .fail p { margin: 0 0 12px; }
  .fail button, .stale { font-size: 19px; font-weight: 600; color: var(--blue-text); }
  .stale { position: absolute; right: 52px; bottom: 34px; margin: 0; color: var(--secondary); font-weight: 500; font-size: 16px; }
</style>
