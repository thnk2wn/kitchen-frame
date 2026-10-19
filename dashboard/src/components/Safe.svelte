<script>
  // One part of the screen that can fail on its own. Anything it throws while drawing or updating
  // (a list with the same key twice, a value of the wrong type in some data) is caught here: the part
  // shows a quiet placeholder, the error goes to the event log (and so the status page and the phone's
  // Ops tab), and the part tries again after RETRY_MS. Everything else on the frame keeps working.
  // Without it, one bad card stopped the whole page and the frame showed white (2026-10-19).
  //   name: what the part is, for the log and the placeholder ("Upcoming", "the House tab")
  //   quiet: draw nothing when it fails (for small parts where a message wouldn't fit)
  //   fallback: a snippet to draw instead when it fails (the clock screen keeps a way back to the dashboard)
  import { log } from '../lib/log.svelte.js';

  let { name, quiet = false, fallback, children } = $props();
  const RETRY_MS = 60000;
  let timer;

  function caught(error, reset) {
    log('ui.error', { part: name, error: String((error && error.message) || error).slice(0, 200) }, 'error');
    clearTimeout(timer);
    timer = setTimeout(reset, RETRY_MS);
  }
</script>

<svelte:boundary onerror={caught}>
  {@render children()}
  {#snippet failed()}
    {#if fallback}{@render fallback()}{:else if !quiet}<div class="failed" role="status">{name} couldn’t show just now. Trying again shortly.</div>{/if}
  {/snippet}
</svelte:boundary>

<style>
  .failed { margin: 12px; padding: 14px 18px; border-radius: 14px; background: var(--track); color: var(--secondary); font-size: 16px; }
</style>
