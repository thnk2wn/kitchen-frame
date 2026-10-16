<script>
  import Txt from './Txt.svelte';
  // One event in detail, opened by tapping it on Home or the Calendar tab: its calendar, when, where
  // and its notes. Only calendars set to open (CALENDAR_DETAILS) can be tapped; the Worker never
  // keeps notes for the others.
  import Icon from './Icon.svelte';
  import EventMap from './EventMap.svelte';
  import { ui, clock, calendar, calendarNames, eventNotes } from '../lib/state.svelte.js';
  import { calVars, timeRange, time, dayKey, addDays, isNow, isPast } from '../lib/format.js';
  import { reminderFor } from '../lib/reminders.svelte.js';
  import { speaker } from '../lib/announce.svelte.js';

  let e = $derived.by(() => {
    const want = ui.event, events = calendar.data && calendar.data.events;
    if (!want || !events) return null;
    return events.find((x) => x.uid === want.uid && (!want.start || x.start === want.start)) || null;
  });
  let notes = $derived(e ? eventNotes(e) : '');
  let calName = $derived(e ? calendarNames()[e.cal] || '' : '');
  // Demo mode maps only the stadiums: a local place ("Aquatic center") would be found near the
  // frame's real home and show its neighbourhood in screenshots.
  let mapFor = $derived(e && e.location && e.location !== 'Video call' && (!ui.demo || /stadium/i.test(e.location)) ? e.location : '');
  // Settings → Announcements → Event reminders: when this one will be said out loud.
  let reminder = $derived(e && Date.parse(e.start) > clock.now.getTime() ? reminderFor(e) : null);
  // "15 and 5 min before", "10 min before and as it starts".
  const whenSaid = (all) => {
    const mins = all.filter((m) => m > 0), start = all.includes(0);
    return [mins.length ? mins.join(' and ') + ' min before' : '', start ? 'as it starts' : ''].filter(Boolean).join(' and ');
  };
  let mapped = $state(false);
  let rowsHeight = $state(0); // the map matches the details beside it

  const plainDate = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  // "Today", "Tomorrow" or "Saturday, October 17".
  function dayLabel(d, long = true) {
    if (dayKey(d) === dayKey(clock.now)) return 'Today';
    if (dayKey(d) === dayKey(addDays(clock.now, 1))) return 'Tomorrow';
    return d.toLocaleDateString([], long ? { weekday: 'long', month: 'long', day: 'numeric' } : { weekday: 'short', month: 'short', day: 'numeric' });
  }
  let when = $derived.by(() => {
    if (!e) return null;
    if (e.allDay) {
      const a = plainDate(e.start), b = addDays(plainDate(e.end), -1);
      return dayKey(a) === dayKey(b) ? { day: dayLabel(a), hours: 'All day' } : { day: dayLabel(a, false) + ' – ' + dayLabel(b, false), hours: 'All day' };
    }
    const a = new Date(e.start), b = new Date(e.end);
    if (dayKey(a) !== dayKey(b) && b - a > 0 && !(b.getHours() === 0 && b.getMinutes() === 0 && b - a <= 864e5)) {
      return { day: dayLabel(a, false) + ', ' + time(a) + ' –', hours: dayLabel(b, false) + ', ' + time(b) };
    }
    return { day: dayLabel(a), hours: timeRange(e) };
  });
  let status = $derived(e ? (isNow(e, clock.now) ? 'Now' : isPast(e, clock.now) ? 'Ended' : '') : '');
  const close = () => { ui.event = null; };
</script>

{#if e}
  <div class="scrim" role="presentation" onclick={close}>
    <div class="panel sheet" class:wide={mapped && !!mapFor} role="dialog" aria-label={e.title} tabindex="-1" style={calVars(e)} onclick={(ev) => ev.stopPropagation()} onkeydown={(ev) => ev.key === 'Escape' && close()}>
      <header>
        <span class="cal"><i></i>{calName}</span>
        <button class="x" onclick={close} aria-label="Close"><Icon name="close" size={26} /></button>
      </header>
      <h2><Txt text={e.title} /></h2>
      <div class="content">
      <div class="rows" bind:clientHeight={rowsHeight}>
        <div class="row">
          <span class="ic"><Icon name="clock" size={24} /></span>
          <div><div class="day">{when.day}</div><div class="sub num">{when.hours}{#if status} · <b class:now={status === 'Now'}>{status}</b>{/if}</div></div>
        </div>
        {#if e.location}
          <div class="row"><span class="ic"><Icon name="mapPin" size={24} /></span><div class="day">{e.location}</div></div>
        {/if}
        {#if reminder}
          <div class="row"><span class="ic"><Icon name="volume" size={24} /></span><div class="sub">Announced {whenSaid(reminder.all)}{reminder.own ? (reminder.all.length > 1 ? ' (its own reminders)' : ' (its own reminder)') : ''}{speaker() ? ' on ' + speaker().label : ''}</div></div>
        {/if}
        {#if notes}
          <div class="row notes"><span class="ic"><Icon name="notes" size={24} /></span><p>{notes}</p></div>
        {/if}
      </div>
      {#if mapFor}{#key mapFor}<EventMap location={mapFor} height={Math.max(220, Math.min(rowsHeight, 420))} bind:found={mapped} />{/key}{/if}
      </div>
    </div>
  </div>
{/if}

<style>
  .scrim { position: fixed; inset: 0; z-index: 40; display: grid; place-items: center; background: rgba(0, 0, 0, .45); }
  .panel { width: 760px; max-width: calc(100vw - 40px); max-height: calc(100vh - 40px); display: flex; flex-direction: column; padding: 18px 24px 24px; border-radius: 26px; overflow: hidden; }
  header { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
  .cal { display: flex; align-items: center; gap: 8px; font-size: 16px; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; color: var(--secondary); }
  .cal i { width: 12px; height: 12px; border-radius: 50%; background: var(--c); }
  .x { flex: none; width: 48px; height: 48px; border-radius: 50%; display: grid; place-items: center; background: var(--track); color: var(--label); }
  h2 { margin: 4px 0 14px; font-size: 32px; line-height: 1.15; font-weight: 700; letter-spacing: -.01em; overflow-wrap: anywhere; }
  .panel.wide { width: 1080px; }
  .content { min-height: 0; display: flex; align-items: flex-start; gap: 24px; }
  .rows { flex: 1; min-width: 0; min-height: 0; display: flex; flex-direction: column; }
  .row { display: flex; gap: 14px; padding: 12px 0; border-top: 1px solid var(--sep); }
  .ic { flex: none; color: var(--secondary); padding-top: 2px; }
  .day { font-size: 21px; font-weight: 600; overflow-wrap: anywhere; }
  .sub { margin-top: 2px; font-size: 19px; color: var(--secondary); }
  .sub b { font-weight: 700; color: var(--label); }
  .sub b.now { color: var(--red-text); }
  .notes { min-height: 0; }
  .notes p { margin: 0; min-height: 0; max-height: 260px; overflow-y: auto; white-space: pre-line; font-size: 19px; line-height: 1.45; overflow-wrap: anywhere; }
</style>
