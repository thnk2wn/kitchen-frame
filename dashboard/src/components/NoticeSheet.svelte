<script>
  // Every notice with its message and when it started; Dismiss removes it in Home Assistant.
  import Icon from './Icon.svelte';
  import { ui, clock } from '../lib/state.svelte.js';
  import { notices, dismissNotice } from '../lib/notices.svelte.js';
  import { time, dayKey, dow } from '../lib/format.js';
  let list = $derived(notices());
  const close = () => (ui.noticesOpen = false);
  const when = (t) => {
    if (!t) return '';
    const d = new Date(t);
    return (dayKey(d) === dayKey(clock.now) ? '' : dow(dayKey(d)) + ' ') + time(d);
  };
  // Closes itself once the last notice is gone.
  $effect(() => { if (ui.noticesOpen && !list.length) close(); });
</script>

{#if ui.noticesOpen && list.length}
  <div class="scrim" role="presentation" onclick={close}>
    <div class="panel sheet" role="dialog" aria-label="Notices" tabindex="-1" onclick={(e) => e.stopPropagation()} onkeydown={(e) => e.key === 'Escape' && close()}>
      <header>
        <h2>Home</h2>
        <button class="x" onclick={close} aria-label="Close"><Icon name="close" size={26} /></button>
      </header>
      <div class="list">
        {#each list as n (n.id)}
          <div class="item">
            <span class="ic {n.tone}"><Icon name={n.tone === 'info' ? 'bell' : 'alert'} size={22} /></span>
            <div class="txt">
              <div class="title">{n.title || 'Notice'}</div>
              {#if n.message && n.message !== n.title}<div class="msg">{n.message}</div>{/if}
              {#if n.created}<div class="when">{when(n.created)}</div>{/if}
            </div>
            <button class="dismiss" onclick={() => dismissNotice(n.id)}>Dismiss</button>
          </div>
        {/each}
      </div>
    </div>
  </div>
{/if}

<style>
  .scrim { position: fixed; inset: 0; z-index: 40; display: grid; place-items: center; background: rgba(0, 0, 0, .45); }
  .panel { width: 720px; max-width: calc(100vw - 40px); max-height: calc(100vh - 60px); display: flex; flex-direction: column; padding: 18px 24px 12px; border-radius: 26px; }
  header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; }
  h2 { margin: 0; font-size: 26px; font-weight: 800; }
  .x { width: 48px; height: 48px; border-radius: 50%; display: grid; place-items: center; background: var(--track); color: var(--label); }
  .list { overflow-y: auto; min-height: 0; }
  .item { display: flex; align-items: flex-start; gap: 14px; padding: 14px 0; border-top: 1px solid var(--sep); }
  .item:first-child { border-top: 0; }
  .ic { flex: none; width: 40px; height: 40px; border-radius: 50%; display: grid; place-items: center; color: #fff; background: var(--orange); }
  .ic.alert { background: var(--red); }
  .ic.info { background: var(--blue); }
  .txt { flex: 1; min-width: 0; }
  .title { font-size: 20px; font-weight: 700; }
  .msg { margin-top: 2px; font-size: 17px; line-height: 1.4; white-space: pre-line; }
  .when { margin-top: 4px; font-size: 15px; color: var(--secondary); }
  .dismiss { flex: none; height: 44px; padding: 0 18px; border-radius: 22px; background: var(--track); font-size: 17px; font-weight: 700; color: var(--label); }
  .dismiss:active { opacity: .6; }
</style>
