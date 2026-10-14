<script>
  import Icon from '../components/Icon.svelte';
  import EventRow from '../components/EventRow.svelte';
  import TaskRow from '../components/TaskRow.svelte';
  import NowPlaying from '../components/NowPlaying.svelte';
  import CalendarPicker from '../components/CalendarPicker.svelte';
  import NoticeBanners from '../components/NoticeBanners.svelte';
  import { nowPlaying } from '../lib/ha.svelte.js';
  import { clock, calendar, weather, lists, mealItems, ui, completeItem, loadCalendar, loadList } from '../lib/state.svelte.js';
  import { clockTime, longDate, eventsOn, addDays, weatherInfo, dayInfo, time, dow, dayKey, dayName, uvBand } from '../lib/format.js';

  let events = $derived(calendar.data ? calendar.data.events : []);
  // Finished events drop off Home; the Calendar tab still shows them.
  let today = $derived(eventsOn(events, clock.now).filter((e) => e.allDay || Date.parse(e.end) > clock.now.getTime()));
  // Upcoming: the rest of this week, tomorrow through Sunday (the feed is already sorted).
  let upcoming = $derived.by(() => {
    const tomorrow = addDays(clock.now, 1).getTime();
    const nextMonday = addDays(clock.now, (8 - clock.now.getDay()) % 7 || 7).getTime();
    return events.filter((e) => {
      const start = e.allDay ? new Date(e.start + 'T00:00').getTime() : Date.parse(e.start);
      return start >= tomorrow && start < nextMonday;
    });
  });
  // Upcoming, grouped by day ("Tomorrow", "Thu, Oct 15") so days don't run together.
  let upcomingDays = $derived.by(() => {
    const days = [];
    for (const e of upcoming) {
      const name = dayName(e, clock.now);
      if (!days.length || days[days.length - 1].name !== name) days.push({ name, events: [] });
      days[days.length - 1].events.push(e);
    }
    return days;
  });
  // Tonight's dinner (and any other meal planned today) from Paprika, above today's events.
  let todaysMeals = $derived(mealItems().filter((m) => m.date === dayKey(clock.now)));
  function openMeal(m) {
    if (!m.id) return;
    ui.openRecipe = { id: m.id, title: m.title };
    ui.tab = 'recipes';
  }
  let wx = $derived(weather.data);
  let info = $derived(wx ? weatherInfo(wx.code, wx.day) : null);
  // UV for sunscreen: today's peak until sunset, then tomorrow's (the current reading is 0 at dawn).
  let uv = $derived.by(() => {
    if (!wx || !wx.days || !wx.days[0]) return null;
    const afterSunset = wx.days[0].sunset && clock.now.getTime() > new Date(wx.days[0].sunset).getTime();
    const d = afterSunset ? wx.days[1] : wx.days[0];
    return d && d.uv != null ? { value: d.uv, tomorrow: afterSunset, ...uvBand(d.uv) } : null;
  });
  // clock.now re-checks the 30-minute hold every minute.
  let playing = $derived(nowPlaying({ hold: true, now: clock.now.getTime() }));
</script>

<div class="home">
  <section class="now">
    <div class="date">{longDate(clock.now)}</div>
    <div class="clock num">{clockTime(clock.now)}</div>
    {#if playing}<div class="np-slot"><NowPlaying player={playing} /></div>{/if}
    <!-- Home Assistant notices (lib/notices.svelte.js); one fits beside Now Playing, two without it. -->
    <NoticeBanners max={playing ? 1 : 2} />

    {#if wx}
      <div class="sheet weather">
        {#if uv}<span class="uv {uv.cls}" title="UV index">UV {uv.value} · {uv.tomorrow ? 'tomorrow' : uv.label}</span>{/if}
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
      {#each todaysMeals as m (m.type + m.title)}
        <button class="meal" class:link={m.id} onclick={() => openMeal(m)}>
          <span class="mic"><Icon name="utensils" size={16} /></span>
          <span class="mtxt"><span class="mtype">{m.type}</span> {m.title}</span>
        </button>
      {/each}
      {#if !calendar.data && calendar.offline}
        <p class="empty">Couldn’t load the calendar.</p>
      {:else}
        {#each today as e (e.uid + e.start)}
          <EventRow event={e} now={clock.now} />
        {:else}
          <p class="empty">{calendar.data ? 'No more events today' : 'Loading…'}</p>
        {/each}
      {/if}
      <h2 class="later">Upcoming</h2>
      {#each upcomingDays as d (d.name)}
        <div class="day-head">{d.name}</div>
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
  {@const items = list.items || []}
  {@const note = list.error && /TODOIST_TOKEN/.test(list.error) ? 'Todoist isn’t connected yet.' : list.error}
  <section class="sheet list {name}" style="--accent-text:{color}">
    <header>
      <h2><button class="jump" onclick={() => (ui.tab = name)}>{title}</button></h2>
      {#if list.items}<span class="count num">{items.length}</span>{/if}
    </header>
    <div class="scroll" class:cols={name === 'groceries'}>
      {#each items as item (item.id)}
        <TaskRow {item} now={clock.now} ondone={(i) => completeItem(name, i)} brief={name === 'groceries'}
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
  .home { display: grid; grid-template-columns: 384px 1.3fr 1fr; gap: 20px; height: 100%; padding: 10px 28px 28px; }
  .now { display: flex; flex-direction: column; min-width: 0; }
  .date { font-size: 26px; font-weight: 600; color: var(--secondary); padding: 6px 4px 0; }
  .clock { font-size: 146px; font-weight: 600; line-height: 1; letter-spacing: -.04em; margin: 2px 0 0 -4px; }

  .np-slot { margin-top: 18px; }
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
  .list.todo { flex: 0 1 auto; max-height: 38%; }
  /* Groceries on Home: short one-line items, two columns when the card is wide enough. */
  .scroll.cols { display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); column-gap: 16px; align-content: start; overflow-x: hidden; }
  .scroll.cols .empty { grid-column: 1 / -1; }
  .scroll { flex: 1; min-height: 0; overflow-y: auto; }
  footer { flex: none; display: flex; align-items: center; justify-content: space-between; gap: 12px; padding-top: 10px; border-top: 1px solid var(--sep); }
  h2 { margin: 0 0 4px; font-size: 24px; font-weight: 700; letter-spacing: -.01em; }
  h2.later { margin-top: 20px; color: var(--secondary); }
  /* One heading per upcoming day, with a thin line above it so days don't run together. */
  .day-head { margin-top: 8px; padding-top: 10px; border-top: 1px solid var(--sep); font-size: 15px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; color: var(--secondary); }
  h2.later + .day-head { margin-top: 2px; border-top: 0; padding-top: 4px; }
  .meal { display: flex; align-items: center; gap: 10px; width: 100%; padding: 8px 0 6px; text-align: left; font-size: 19px; font-weight: 600; }
  .meal.link:active { opacity: .6; }
  .mic { flex: none; width: 28px; height: 28px; border-radius: 50%; display: grid; place-items: center; background: var(--orange); color: #fff; }
  .mtxt { min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .mtype { color: var(--orange-text); }
  .list header { display: flex; align-items: baseline; justify-content: space-between; }
  .list h2 { color: var(--accent-text); }
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
