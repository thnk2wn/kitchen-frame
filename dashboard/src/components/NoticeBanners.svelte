<script>
  // Home's notice banners (lib/notices.svelte.js): newest first, up to `max`, then "+N more".
  // Tap one for its message and Dismiss (components/NoticeSheet.svelte).
  import Icon from './Icon.svelte';
  import { ui } from '../lib/state.svelte.js';
  import { notices, iconOf } from '../lib/notices.svelte.js';
  let { max = 2 } = $props();
  let list = $derived(notices());
  let shown = $derived(list.length > max ? list.slice(0, max - 1) : list);
</script>

{#if list.length}
  <div class="notices">
    {#each shown as n (n.id)}
      <button class="notice {n.tone}" onclick={() => (ui.noticesOpen = true)}>
        <Icon name={iconOf(n.tone)} size={20} /><span>{n.title || n.message}</span>
      </button>
    {/each}
    {#if list.length > shown.length}
      <button class="notice more" onclick={() => (ui.noticesOpen = true)}><span>+{list.length - shown.length} more {list.length - shown.length === 1 ? 'notice' : 'notices'}</span></button>
    {/if}
  </div>
{/if}

<style>
  .notices { display: flex; flex-direction: column; gap: 8px; margin-top: 16px; }
  .notice { display: flex; align-items: center; gap: 10px; width: 100%; min-height: 48px; padding: 8px 14px; border-radius: 14px; background: var(--orange); color: #fff; font-size: 18px; font-weight: 700; text-align: left; }
  .notice.alert { background: var(--red); }
  .notice.info { background: var(--blue); }
  .notice.more { min-height: 36px; background: var(--track); color: var(--label); font-size: 16px; }
  .notice span { min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .notice:active { opacity: .7; }
</style>
