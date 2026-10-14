<script>
  // One small button for a list's order, the same on Home, the Lists tab and Music: it shows the
  // order in use (a clock for "by time": as added, or most recently played; A→Z when alphabetical,
  // tinted) and switches between them.
  import Icon from './Icon.svelte';
  let { az = false, timeLabel = 'As added', onchange, size = 20 } = $props();
  let label = $derived((az ? 'Sorted A to Z' : 'Sorted ' + timeLabel.toLowerCase()) + '. Tap for ' + (az ? timeLabel.toLowerCase() : 'A to Z') + '.');
</script>

<button class="sort" class:az onclick={() => onchange(!az)} aria-label={label} title={label}>
  <Icon name={az ? 'sortAz' : 'sortTime'} {size} />
</button>

<style>
  .sort { flex: none; width: 40px; height: 40px; border-radius: 50%; display: grid; place-items: center; background: var(--track); color: var(--secondary); }
  .sort.az { color: var(--blue-text); }
  .sort:active { opacity: .6; }
</style>
