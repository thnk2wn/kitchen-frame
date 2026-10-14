<script>
  import Icon from './Icon.svelte';
  import { calVars, timeRange, isPast, isNow } from '../lib/format.js';
  import { canOpen, openEvent } from '../lib/state.svelte.js';
  // place: show the location after the time (Today does; Upcoming keeps rows short).
  let { event, now, place = true } = $props();
  let live = $derived(isNow(event, now));
  let tappable = $derived(canOpen(event)); // calendars set to open show a chevron and open on tap
</script>

<div class="ev" class:past={isPast(event, now)} class:tappable style={calVars(event)}
  role={tappable ? 'button' : undefined} tabindex={tappable ? 0 : undefined} onclick={() => openEvent(event)} onkeydown={(e) => e.key === 'Enter' && openEvent(event)}>
  <span class="dot"></span>
  <div class="body">
    <div class="title">{event.title}</div>
    <div class="meta">
      {#if event.allDay}All day{:else if live}<b>Now</b> · until {timeRange(event).split(' – ')[1]}{:else}{timeRange(event)}{/if}{event.location && place ? ' · ' + event.location : ''}
    </div>
  </div>
  {#if tappable}<span class="more"><Icon name="chevronRight" size={20} /></span>{/if}
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
  .meta b { color: var(--label); font-weight: 700; }
</style>
