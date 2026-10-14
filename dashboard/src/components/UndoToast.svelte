<script>
  // "Completed “Milk” · Undo" for a few seconds after an item is ticked off (state.svelte.js holds
  // the completion back until then). Shows the newest; Undo puts it back where it was.
  import { undos, undoComplete } from '../lib/state.svelte.js';
  let last = $derived(undos.length ? undos[undos.length - 1] : null);
</script>

{#if last}
  {#key last.key}
    <div class="toast" role="status">
      <span class="text">Completed “{last.item.content}”</span>
      <button onclick={undoComplete}>Undo</button>
    </div>
  {/key}
{/if}

<style>
  .toast { position: fixed; left: 50%; bottom: 24px; z-index: 45; transform: translateX(-50%); max-width: calc(100vw - 40px); display: flex; align-items: center; gap: 18px; padding: 8px 8px 8px 24px; border-radius: 30px; background: rgba(28, 28, 30, .92); color: #fff; animation: up .2s ease-out; }
  .text { font-size: 19px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  button { flex: none; height: 46px; padding: 0 22px; border-radius: 23px; background: rgba(255, 255, 255, .16); font-size: 19px; font-weight: 700; color: #64d2ff; }
  button:active { opacity: .7; }
  @keyframes up { from { opacity: 0; transform: translate(-50%, 12px); } }
</style>
