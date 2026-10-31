<script>
  import Txt from './Txt.svelte';
  // Home's notice banners (lib/notices.svelte.js): newest first, up to `max`, then "+N more", each
  // with when it started.
  // Tap one for its message and Dismiss (components/NoticeSheet.svelte). An unread one says hi now
  // and then (nudges in lib/notices.svelte.js): a light sweeps across it and its icon rings.
  import Icon from './Icon.svelte';
  import { ui, clock } from '../lib/state.svelte.js';
  import { notices, iconOf, startedAt, nudges } from '../lib/notices.svelte.js';
  let { max = 2 } = $props();
  let list = $derived(notices());
  let shown = $derived(list.length > max ? list.slice(0, max - 1) : list);
</script>

{#if list.length}
  <div class="notices">
    {#each shown as n (n.id)}
      <button class="notice {n.tone}" onclick={() => (ui.noticesOpen = true)}>
        <!-- Keyed on the minute while nudging, so each nudge plays the animation afresh. -->
        {#key nudges(n, clock.now) && clock.now.getTime()}<span class="ic" class:ring={nudges(n, clock.now)}><Icon name={iconOf(n)} size={20} /></span>{#if nudges(n, clock.now)}<i class="shine"></i>{/if}{/key}<span><Txt text={n.title || n.message} /></span>{#if startedAt(n, clock.now)}<small class="at num">{startedAt(n, clock.now)}</small>{/if}
      </button>
    {/each}
    {#if list.length > shown.length}
      <button class="notice more" onclick={() => (ui.noticesOpen = true)}><span>+{list.length - shown.length} more {list.length - shown.length === 1 ? 'notice' : 'notices'}</span></button>
    {/if}
  </div>
{/if}

<style>
  .notices { display: flex; flex-direction: column; gap: 8px; margin-top: 16px; }
  .notice { position: relative; overflow: hidden; display: flex; align-items: center; gap: 10px; width: 100%; min-height: 48px; padding: 8px 14px; border-radius: 14px; background: var(--orange); color: #fff; font-size: 18px; font-weight: 700; text-align: left; }
  .notice.alert { background: var(--red); }
  .notice.info { background: var(--blue); }
  .notice.more { min-height: 36px; background: var(--track); color: var(--label); font-size: 16px; }
  .notice span { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .notice .at { flex: none; font-size: 15px; font-weight: 600; opacity: .85; }
  .notice:active { opacity: .7; }
  .notice .ic { flex: none; display: flex; }
  .notice .shine { position: absolute; top: 0; bottom: 0; left: 0; width: 30%; background: linear-gradient(100deg, rgba(255, 255, 255, 0), rgba(255, 255, 255, .5), rgba(255, 255, 255, 0)); transform: translateX(-100%); animation: sweep 1.2s ease-in-out .2s; pointer-events: none; }
  .ring { transform-origin: 50% 10%; animation: ring 1s ease-in-out .2s; }
  @keyframes sweep { to { transform: translateX(340%); } }
  @keyframes ring { 15% { transform: rotate(16deg); } 30% { transform: rotate(-14deg); } 45% { transform: rotate(10deg); } 60% { transform: rotate(-8deg); } 75% { transform: rotate(4deg); } 90% { transform: rotate(0); } }
</style>
