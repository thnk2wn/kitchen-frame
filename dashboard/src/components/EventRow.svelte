<script>
  import Txt from './Txt.svelte';
  import Icon from './Icon.svelte';
  import { calVars, timeRange, isPast, isNow } from '../lib/format.js';
  import { canOpen, openEvent, pinFor } from '../lib/state.svelte.js';
  // place: show the location after the time (Today does; Upcoming keeps rows short).
  // leave: "Leave in 20 min · 14 min drive", for the next event with a drive (views/Home.svelte).
  // drive: minutes to drive there, shown beside the time (Today's other events with a drive).
  let { event, now, place = true, leave = '', drive = 0 } = $props();
  let live = $derived(isNow(event, now));
  let tappable = $derived(canOpen(event)); // calendars set to open show a chevron and open on tap
</script>

<div class="ev" class:past={isPast(event, now)} class:live={live && !event.allDay} class:tappable style={calVars(event)}
  role={tappable ? 'button' : undefined} tabindex={tappable ? 0 : undefined} onclick={() => openEvent(event)} onkeydown={(e) => e.key === 'Enter' && openEvent(event)}>
  <span class="dot"></span>
  <div class="body">
    <div class="title"><Txt text={event.title} /></div>
    <div class="meta">
      {#if event.allDay}All day{:else if live}<b class="now">Now</b> until {timeRange(event).split(' – ')[1]}{:else}{timeRange(event)}{/if}{#if drive}{' · '}<span class="drive"><Icon name="car" size={16} />{drive} min</span>{/if}{event.location && place ? ' · ' + event.location : ''}
    </div>
    {#if leave}<div class="leave"><Icon name="car" size={18} />{leave}</div>{/if}
  </div>
  <!-- A lock for a calendar that opens after its owner's PIN (CALENDAR_DETAILS pin:<name>). -->
  {#if tappable}<span class="more"><Icon name={pinFor(event) ? 'lock' : 'chevronRight'} size={pinFor(event) ? 16 : 20} /></span>{/if}
</div>

<style>
  .ev { display: flex; gap: 14px; padding: 10px 0; }
  .past .title { color: var(--secondary); }
  .dot { flex: none; width: 10px; height: 10px; border-radius: 50%; background: var(--c); margin-top: 9px; }
  .body { flex: 1; min-width: 0; }
  .tappable:active { opacity: .6; }
  .more { flex: none; align-self: center; color: var(--tertiary); }
  .title { font-size: 22px; font-weight: 600; letter-spacing: -.01em; overflow-wrap: anywhere; }
  .meta { font-size: 17px; color: var(--secondary); margin-top: 3px; overflow-wrap: anywhere; }
  /* Happening now: a card in the calendar's colour with a solid Now badge (in the text colour, so it reads on any calendar colour), so it reads from across the room. */
  .live { margin: 4px 0; padding: 12px 12px 12px 18px; border-radius: 14px; background: var(--c-tint); box-shadow: inset 5px 0 0 var(--c); }
  .live .dot { display: none; }
  .live .title { font-size: 24px; }
  .live .meta { color: var(--label); }
  /* Icons are display: block (style.css), so the car and its minutes sit in an inline row of their own. */
  .drive { display: inline-flex; align-items: center; gap: 4px; white-space: nowrap; vertical-align: bottom; }
  .leave { display: flex; align-items: center; gap: 6px; margin-top: 4px; font-size: 17px; font-weight: 600; color: var(--label); }
  .now { display: inline-block; margin-right: 6px; padding: 1px 9px; border-radius: 8px; background: var(--label); color: var(--sheet); font-weight: 700; letter-spacing: .02em; }
</style>
