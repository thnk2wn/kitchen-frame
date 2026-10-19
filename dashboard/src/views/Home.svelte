<script>
  import { rotationLines } from '../lib/rotations.js';
  import Txt from '../components/Txt.svelte';
  // What's playing (or paused within the last 30 minutes), from App, which also feeds the top bar.
  let { playing = null } = $props();
  let slotH = $state(0);
  import Icon from '../components/Icon.svelte';
  import EventRow from '../components/EventRow.svelte';
  import TaskRow from '../components/TaskRow.svelte';
  import CalendarPicker from '../components/CalendarPicker.svelte';
  import NowPlaying from '../components/NowPlaying.svelte';
  import SortButton from '../components/SortButton.svelte';
  import NoticeBanners from '../components/NoticeBanners.svelte';
  import { clock, calendar, weather, lists, mealItems, rotationRules, ui, completeItem, loadCalendar, loadList, listSort, setListSort, sortList } from '../lib/state.svelte.js';
  import { clockTime, longDate, eventsOn, addDays, weatherInfo, dayInfo, time, dow, dayKey, dayName, uvBand } from '../lib/format.js';

  let events = $derived(calendar.data ? calendar.data.events : []);
  // Finished events drop off Home; the Calendar tab still shows them.
  let today = $derived(eventsOn(events, clock.now).filter((e) => e.allDay || Date.parse(e.end) > clock.now.getTime()));
  // Upcoming: the next 7 days from tomorrow, not just to Sunday, so a weekend still shows Monday on
  // (the feed is already sorted). The card lists as many as fit.
  let upcoming = $derived.by(() => {
    const tomorrow = addDays(clock.now, 1).getTime();
    const weekOn = addDays(clock.now, 8).getTime();
    return events.filter((e) => {
      const start = e.allDay ? new Date(e.start + 'T00:00').getTime() : Date.parse(e.start);
      return start >= tomorrow && start < weekOn;
    });
  });
  // Upcoming, grouped by day ("Tomorrow", "Thu, Oct 15") so days don't run together.
  // In time order and one entry per day, whatever order the feeds arrive in: a calendar from the Mac
  // comes after the others, and a day listed twice repeats its key, which stops the page (2026-10-19).
  let upcomingDays = $derived.by(() => {
    const startOf = (e) => (e.allDay ? new Date(e.start + 'T00:00').getTime() : Date.parse(e.start));
    const days = new Map();
    for (const e of [...upcoming].sort((a, b) => startOf(a) - startOf(b))) {
      const name = dayName(e, clock.now);
      if (!days.has(name)) days.set(name, { name, events: [] });
      days.get(name).events.push(e);
    }
    return [...days.values()];
  });
  // Tonight's dinner (and any other meal planned today) from Paprika, above today's events.
  let todaysMeals = $derived(mealItems().filter((m) => m.date === dayKey(clock.now)));
  // Rotations (lib/rotations.js): today's up early at the top, tonight's bedtime last, and once the
  // morning's over, tomorrow's up early under Tomorrow in Upcoming.
  let duties = $derived(rotationLines(rotationRules(), clock.now));
  let dutiesAt = (place) => duties.filter((d) => d.place === place);
  // Upcoming's days, with a Tomorrow for tomorrow's rotations even when it has no events.
  let upcomingShown = $derived(dutiesAt('tomorrow').length && (!upcomingDays.length || upcomingDays[0].name !== 'Tomorrow')
    ? [{ name: 'Tomorrow', events: [] }, ...upcomingDays] : upcomingDays);
  function openMeal(m) {
    if (!m.id) return;
    ui.openRecipe = { id: m.id, title: m.title };
    ui.tab = 'recipes';
  }
  let wx = $derived(weather.data);
  let info = $derived(wx ? weatherInfo(wx.code, wx.day) : null);
  // UV right now, for sunscreen (the same reading HA's weather shows, give or take the source). Hidden
  // when it's under 1: night, dawn and dusk. The day's peak is in the weather sheet.
  let uv = $derived(wx && wx.uvNow != null && wx.uvNow >= 1 ? { value: wx.uvNow, ...uvBand(wx.uvNow) } : null);
</script>

<div class="home">
  <section class="now">
    <div class="date">{longDate(clock.now)}</div>
    <div class="clock num">{clockTime(clock.now)}</div>
    <!-- Home Assistant notices come first (lib/notices.svelte.js). Now Playing takes whatever room is
         left above the weather: a row on the frame, a big cover on a taller screen, nothing when
         there's no room for even the row (it's still in Music). -->
    <NoticeBanners max={2} />
    <div class="np-slot" bind:clientHeight={slotH}>
      {#if playing && slotH >= 78}<NowPlaying player={playing} card slim={slotH < 136} cover={slotH >= 320 ? Math.min(slotH - 124, 360) : 0} />{/if}
    </div>

    {#if wx}
      <div class="sheet weather">
        {#if uv}<span class="uv {uv.cls}" title="UV index now">UV {uv.value} · {uv.label}</span>{/if}
        {#if wx.alerts && wx.alerts.length}
          {@const a = wx.alerts[0]}
          <button class="wx-alert" class:severe={a.severity === 'Severe' || a.severity === 'Extreme'} onclick={() => (ui.weatherDay = 0)}>
            <Icon name="alert" size={20} /><span>{a.event}{wx.alerts.length > 1 ? ' +' + (wx.alerts.length - 1) : ''}</span>
          </button>
        {/if}
        <!-- Tap today or a day for its detail sheet (components/WeatherSheet.svelte). -->
        <button class="wx-now" onclick={() => (ui.weatherDay = 0)}>
          <span class="temp num">{wx.temp}°</span>
          <span class="cond">
            <span class="ic {info.tint}"><Icon name={info.icon} size={34} /></span>
            <span>{info.label}</span>
            <span class="hl num">H:{wx.days[0].hi}° L:{wx.days[0].lo}°</span>
          </span>
        </button>
        <div class="days">
          {#each wx.days.slice(1, 4) as d, n (d.date)}
            {@const di = dayInfo(d)}
            <button class="day" onclick={() => (ui.weatherDay = n + 1)}>
              <span class="dname">{dow(d.date)}</span>
              <span class="ic {di.tint}"><Icon name={di.icon} size={26} /></span>
              <span class="pop num">{d.rain >= 30 ? d.rain + '%' : ''}</span>
              <span class="num"><b>{d.hi}°</b> {d.lo}°</span>
            </button>
          {/each}
        </div>
      </div>
    {:else if weather.error}
      <p class="note">Weather isn’t set up yet.</p>
    {/if}
  </section>

  <section class="sheet cal">
    <!-- The list scrolls inside the widget on a busy day; the footer action always stays visible. -->
    <div class="scroll">
      <h2>Today</h2>
      {#each dutiesAt('top') as d (d.name)}
        <div class="meal duty">
          <span class="mic"><Icon name={d.icon} size={16} /></span>
          <span class="mtxt"><span class="mtype">{d.name}</span> <Txt text={d.text} /></span>
        </div>
      {/each}
      {#each todaysMeals as m (m.type + m.title)}
        <button class="meal" class:link={m.id} onclick={() => openMeal(m)}>
          <span class="mic"><Icon name="utensils" size={16} /></span>
          <span class="mtxt"><span class="mtype">{m.type}</span> <Txt text={m.title} /></span>
        </button>
      {/each}
      {#if !calendar.data && calendar.offline}
        <p class="empty">Couldn’t load the calendar.</p>
      {:else}
        {#each today as e (e.uid + e.start)}
          <EventRow event={e} now={clock.now} />
        {:else}
          {#if !dutiesAt('last').length}<p class="empty">{calendar.data ? 'No more events today' : 'Loading…'}</p>{/if}
        {/each}
      {/if}
      {#each dutiesAt('last') as d (d.name)}
        <div class="meal duty last">
          <span class="mic"><Icon name={d.icon} size={16} /></span>
          <span class="mtxt"><span class="mtype">{d.name}</span> <Txt text={d.text} /></span>
        </div>
      {/each}
      <!-- No "Upcoming" heading: each day's own heading, with its line above, says it. -->
      {#each upcomingShown as d (d.name)}
        <div class="day-head">{d.name}</div>
        {#if d.name === 'Tomorrow'}
          {#each dutiesAt('tomorrow') as r (r.name)}
            <div class="meal duty">
              <span class="mic"><Icon name={r.icon} size={16} /></span>
              <span class="mtxt"><span class="mtype">{r.name}</span> <Txt text={r.text} /></span>
            </div>
          {/each}
        {/if}
        {#each d.events as e (e.uid + e.start)}
          <EventRow event={e} now={clock.now} place={false} />
        {/each}
      {:else}
        <p class="empty">{calendar.data ? 'Nothing else this week' : ''}</p>
      {/each}
    </div>
    <footer>
      {#if !calendar.data && calendar.offline}
        <button class="more" onclick={loadCalendar}>Try again</button>
      {:else}
        <span class="links"><button class="more" onclick={() => (ui.tab = 'calendar')}>Show week</button><CalendarPicker up plain /></span>
        {#if calendar.offline}<span class="note">Offline · {time(new Date(calendar.data.updated))}</span>{/if}
      {/if}
    </footer>
  </section>

  <!-- Groceries and Tasks share the right column: Groceries takes the room, Tasks sizes to its
       items (up to ~38%), since the family to-do list is usually short. -->
  <div class="lists">
    {@render listCard('groceries', 'Groceries', 'var(--orange-text)', 'Nothing to buy.')}
    {@render listCard('todo', 'Tasks', 'var(--blue-text)', 'All done.')}
  </div>
</div>

{#snippet listCard(name, title, color, doneText)}
  {@const list = lists[name]}
  {@const items = sortList(name, list.items || [])}
  {@const note = list.error && /TODOIST_TOKEN/.test(list.error) ? 'Todoist isn’t connected yet.' : list.error}
  <section class="sheet list {name}" style="--accent-text:{color}">
    <header>
      <h2><button class="jump" onclick={() => (ui.tab = name)}>{title}</button></h2>
      <SortButton az={listSort[name] === 'az'} onchange={(az) => setListSort(name, az ? 'az' : 'added')} size={18} />
      {#if list.items}<span class="count num">{items.length}</span>{/if}
    </header>
    <div class="scroll" style="--min:{name === 'todo' ? 300 : 230}px">
      {#each items as item (item.id)}
        <TaskRow {item} now={clock.now} ondone={(i) => completeItem(name, i)} onopen={(i) => (ui.task = { list: name, id: i.id })} brief={name === 'groceries'}
          person={item.assignee ? list.people?.[item.assignee] : null}
          section={item.section ? (list.sections || []).find((x) => x.id === item.section)?.name : null} />
      {:else}
        <p class="empty">{note || (list.items ? doneText : 'Loading…')}</p>
      {/each}
    </div>
    <footer>
      {#if list.error && list.items}
        <!-- Saved items are still shown, but say they may be out of date and offer a retry. -->
        <span class="note warn">{note.startsWith('Todoist isn') ? 'Not connected' : 'Couldn’t refresh'} · saved list</span>
        <button class="more" onclick={() => loadList(name)}>Retry</button>
      {:else}
        <button class="more" onclick={() => (ui.tab = name)}>Open list</button>
      {/if}
    </footer>
  </section>
{/snippet}

<style>
  /* Sized by the room left (basis 0), never by the card, so it can't push the weather down. */
  .np-slot { flex: 1 1 0; min-height: 0; overflow: hidden; padding: 10px 0 8px; display: flex; flex-direction: column; }
  .home { display: grid; grid-template-columns: 384px 1.3fr 1fr; gap: 20px; height: 100%; padding: 10px 28px 28px; }
  .now { display: flex; flex-direction: column; min-width: 0; }
  .date { font-size: 26px; font-weight: 600; color: var(--secondary); padding: 6px 4px 0; }
  .clock { font-size: 146px; font-weight: 600; line-height: 1; letter-spacing: -.04em; margin: 2px 0 0 -4px; }

  .weather { position: relative; margin-top: auto; padding: 22px 24px 18px; }
  /* Today's peak UV (tomorrow's after sunset), in the WHO colours. */
  .uv { position: absolute; top: 16px; right: 16px; padding: 4px 10px; border-radius: 10px; font-size: 15px; font-weight: 700; color: #fff; white-space: nowrap; }
  .uv-low { background: #34c759; }
  .uv-mod { background: #ffcc00; color: #1c1c1e; }
  .uv-high { background: #ff9500; }
  .uv-vhigh { background: #ff3b30; }
  .uv-ext { background: #af52de; }
  .wx-now { display: flex; align-items: center; gap: 18px; width: 100%; text-align: left; color: inherit; }
  .wx-now:active, .day:active, .wx-alert:active { opacity: .6; }
  .wx-alert { display: flex; align-items: center; gap: 8px; width: 100%; margin: -6px 0 12px; padding: 7px 12px; border-radius: 12px; background: var(--orange); color: #fff; font-size: 17px; font-weight: 700; text-align: left; }
  .wx-alert.severe { background: var(--red); }
  .wx-alert span { min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .temp { font-size: 76px; font-weight: 300; line-height: 1; letter-spacing: -.03em; }
  .cond { display: flex; flex-direction: column; gap: 3px; font-size: 19px; font-weight: 600; }
  .hl { font-weight: 500; color: var(--secondary); }
  .days { display: grid; grid-template-columns: repeat(3, 1fr); margin-top: 18px; padding-top: 14px; border-top: 1px solid var(--sep); }
  .day { display: flex; flex-direction: column; align-items: center; gap: 6px; font-size: 17px; color: var(--secondary); }
  .day b { color: var(--label); font-weight: 600; }
  .dname { font-weight: 600; color: var(--label); }
  .pop { height: 15px; font-size: 14px; font-weight: 700; color: var(--blue-text); line-height: 15px; }
  .ic { color: var(--secondary); }
  .ic.sun { color: var(--yellow); }
  .ic.rain { color: var(--blue); }

  .cal, .list { min-width: 0; min-height: 0; display: flex; flex-direction: column; padding-bottom: 16px; }
  .lists { min-width: 0; min-height: 0; display: flex; flex-direction: column; gap: 20px; }
  .list.groceries { flex: 1 1 0; }
  .list.todo { flex: 0 1 auto; max-height: 47%; } /* room for two tasks with their due line */
  /* Both lists: as many columns as fit (the same rule as the Lists tab), at most two; one on the
     frame's narrow card. */
  .scroll { flex: 1; min-height: 0; overflow-y: auto; overflow-x: hidden; display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, max(var(--min), calc(50% - 8px))), 1fr)); column-gap: 16px; align-content: start; }
  .scroll .empty { grid-column: 1 / -1; }
  footer { flex: none; display: flex; align-items: center; justify-content: space-between; gap: 12px; padding-top: 10px; border-top: 1px solid var(--sep); }
  h2 { margin: 0 0 4px; font-size: 24px; font-weight: 700; letter-spacing: -.01em; }
  /* One heading per upcoming day, with a thin line above it so days don't run together. */
  .day-head { margin-top: 8px; padding-top: 10px; border-top: 1px solid var(--sep); font-size: 15px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; color: var(--secondary); }
  /* Long dinner names and rotations wrap under themselves rather than being cut off. */
  .meal { display: flex; align-items: flex-start; gap: 10px; width: 100%; padding: 8px 0 6px; text-align: left; font-size: 19px; font-weight: 600; line-height: 1.35; }
  .meal.link:active { opacity: .6; }
  .mic { flex: none; width: 28px; height: 28px; border-radius: 50%; display: grid; place-items: center; background: var(--orange); color: #fff; }
  .mic { margin-top: -1px; }
  .mtxt { min-width: 0; overflow-wrap: anywhere; }
  .duty.last { padding-top: 10px; }
  .mtype { color: var(--orange-text); }
  .duty .mic { background: var(--purple); }
  .duty .mtype { color: var(--purple-text); }
  .list header { display: flex; align-items: baseline; justify-content: space-between; }
  .list h2 { color: var(--accent-text); }
  .list h2 { flex: 1; }
  .list header { gap: 12px; }
  .list header :global(.sort) { align-self: center; width: 34px; height: 34px; }
  .jump { font: inherit; color: inherit; padding: 0; }
  .jump:active { opacity: .5; }
  .count { font-size: 30px; font-weight: 700; }
  .empty { margin: 8px 0 0; font-size: 19px; color: var(--secondary); }
  .note { font-size: 16px; color: var(--secondary); }
  .note.warn { color: var(--red-text); min-width: 0; }
  .more { flex: none; padding: 8px 0 0; font-size: 19px; font-weight: 600; color: var(--blue-text); }
  .more:active { opacity: .5; }
  .links { display: flex; align-items: center; gap: 24px; }
</style>
