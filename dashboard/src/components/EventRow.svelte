<script>
  import { calVars, timeRange, isPast, isNow } from '../lib/format.js';
  // place: show the location after the time (Today does; Upcoming keeps rows short).
  let { event, now, place = true } = $props();
  let live = $derived(isNow(event, now));
</script>

<div class="ev" class:past={isPast(event, now)} style={calVars(event)}>
  <span class="dot"></span>
  <div class="body">
    <div class="title">{event.title}</div>
    <div class="meta">
      {#if event.allDay}All day{:else if live}<b>Now</b> · until {timeRange(event).split(' – ')[1]}{:else}{timeRange(event)}{/if}{event.location && place ? ' · ' + event.location : ''}
    </div>
  </div>
</div>

<style>
  .ev { display: flex; gap: 14px; padding: 10px 0; }
  .past .title { color: var(--secondary); }
  .dot { flex: none; width: 10px; height: 10px; border-radius: 50%; background: var(--c); margin-top: 9px; }
  .body { min-width: 0; }
  .title { font-size: 22px; font-weight: 600; letter-spacing: -.01em; overflow-wrap: anywhere; }
  .meta { font-size: 17px; color: var(--secondary); margin-top: 3px; overflow-wrap: anywhere; }
  .meta b { color: var(--label); font-weight: 700; }
</style>
