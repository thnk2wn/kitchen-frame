<script>
  // The notices sheet, opened from the top bar's bell or a banner on Home:
  //   New      anything since the sheet was last opened
  //   Earlier  the rest of the last 24 hours, newest first
  // Each row starts with the time it came in. A notice still on has its colour and Dismiss; one that
  // has ended is greyed, with how and when it ended. Dismiss all clears every notice still on.
  // Dismiss removes a notice in Home Assistant; closing the sheet marks everything read.
  import Icon from './Icon.svelte';
  import { ui, clock } from '../lib/state.svelte.js';
  import { notices, earlier, isNew, markSeen, dismissNotice, dismissAll, loadEarlier, iconOf } from '../lib/notices.svelte.js';
  import { time, dayKey, dow } from '../lib/format.js';
  import { said, keyOf } from '../lib/alerts.svelte.js';
  let list = $derived(notices());
  let past = $derived(earlier());
  let fresh = $derived([...list.filter(isNew), ...past.filter(isNew)]);
  const newest = (a, b) => String(b.created).localeCompare(String(a.created));
  let older = $derived([...list, ...past].filter((n) => !isNew(n)).sort(newest));
  let open = $state(null); // a gone notice showing its message
  const close = () => { ui.noticesOpen = false; open = null; markSeen(); };
  $effect(() => { if (ui.noticesOpen) loadEarlier(); });
  // The time column: "8:30 AM", with the day above it when it wasn't today.
  const dayOf = (t) => (t && dayKey(new Date(t)) !== dayKey(clock.now) ? dow(dayKey(new Date(t))) : '');
  const dur = (from, to) => {
    const m = Math.max(1, Math.round((to - from) / 60000));
    return m < 60 ? m + ' min' : m < 1440 ? Math.floor(m / 60) + ' h' + (m % 60 ? ' ' + (m % 60) + ' min' : '') : Math.floor(m / 1440) + ' d';
  };
  const HOW = { cleared: 'Cleared', dismissed: 'Dismissed', expired: 'Expired' };
  // "Cleared at 7:42 AM, after 14 min" / "On for 25 min".
  const status = (n) => n.ended
    ? (HOW[n.how] || 'Ended') + ' at ' + time(new Date(n.ended)) + (n.created ? ', after ' + dur(Date.parse(n.created), Date.parse(n.ended)) : '')
    : n.created ? 'On for ' + dur(Date.parse(n.created), clock.now.getTime()) : '';
  // Said out loud (Settings → Announcements → Home alerts).
  const spoken = (n) => !!said[keyOf(n)];
</script>

{#snippet stamp(n)}
  <span class="at num">{#if dayOf(n.created)}<small>{dayOf(n.created)}</small>{/if}{n.created ? time(new Date(n.created)) : ''}</span>
{/snippet}

{#snippet row(n)}
  {#if n.ended}
    <button class="item past" onclick={() => (open = open === n.id + n.created ? null : n.id + n.created)}>
      {@render stamp(n)}
      <span class="ic {n.tone}"><Icon name={iconOf(n.tone)} size={18} /></span>
      <div class="txt">
        <div class="title">{n.title || 'Notice'}</div>
        {#if open === n.id + n.created && n.message && n.message !== n.title}<div class="msg">{n.message}</div>{/if}
        <div class="when">{status(n)}{#if spoken(n)} · <span class="said">Announced</span>{/if}</div>
      </div>
    </button>
  {:else}
    <div class="item">
      {@render stamp(n)}
      <span class="ic {n.tone}"><Icon name={iconOf(n.tone)} size={22} /></span>
      <div class="txt">
        <div class="title">{n.title || 'Notice'}</div>
        {#if n.message && n.message !== n.title}<div class="msg">{n.message}</div>{/if}
        <div class="when">{status(n)}{#if spoken(n)} · <span class="said">Announced</span>{/if}</div>
      </div>
      <button class="dismiss" onclick={() => dismissNotice(n.id)}>Dismiss</button>
    </div>
  {/if}
{/snippet}

{#if ui.noticesOpen}
  <div class="scrim" role="presentation" onclick={close}>
    <div class="panel sheet" role="dialog" aria-label="Notices" tabindex="-1" onclick={(e) => e.stopPropagation()} onkeydown={(e) => e.key === 'Escape' && close()}>
      <header>
        <h2>Notices</h2>
        <span class="tools">
          {#if list.length > 1}<button class="dismiss" onclick={dismissAll}>Dismiss all</button>{/if}
          <button class="x" onclick={close} aria-label="Close"><Icon name="close" size={26} /></button>
        </span>
      </header>
      <div class="list">
        {#if fresh.length}
          <h3>New</h3>
          {#each fresh as n (n.id + n.created)}{@render row(n)}{/each}
        {/if}
        {#if !fresh.length}<p class="none">Nothing new.</p>{/if}
        {#if older.length}
          <h3>Earlier <span>Last 24 hours</span></h3>
          {#each older as n (n.id + n.created)}{@render row(n)}{/each}
        {/if}
      </div>
    </div>
  </div>
{/if}

<style>
  .scrim { position: fixed; inset: 0; z-index: 40; display: grid; place-items: center; background: rgba(0, 0, 0, .45); }
  .panel { width: 720px; max-width: calc(100vw - 40px); max-height: calc(100vh - 60px); display: flex; flex-direction: column; padding: 18px 24px 16px; border-radius: 26px; }
  header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 2px; }
  h2 { margin: 0; font-size: 26px; font-weight: 800; }
  .tools { display: flex; align-items: center; gap: 12px; }
  .x { width: 48px; height: 48px; border-radius: 50%; display: grid; place-items: center; background: var(--track); color: var(--label); }
  .list { overflow-y: auto; min-height: 0; }
  h3 { display: flex; align-items: baseline; gap: 10px; margin: 14px 0 0; font-size: 15px; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; color: var(--secondary); }
  h3 span { font-size: 14px; font-weight: 500; text-transform: none; letter-spacing: 0; }
  .item { display: flex; align-items: flex-start; gap: 12px; width: 100%; padding: 12px 0; border-bottom: 1px solid var(--sep); text-align: left; }
  /* When it came in, in a column, so ages read at a glance. */
  .at { flex: none; width: 78px; padding-top: 9px; display: flex; flex-direction: column; font-size: 15px; font-weight: 600; color: var(--secondary); text-align: right; white-space: nowrap; }
  .at small { font-size: 13px; font-weight: 500; }
  .past .at { padding-top: 5px; }
  .ic { flex: none; width: 40px; height: 40px; border-radius: 50%; display: grid; place-items: center; color: #fff; background: var(--orange); }
  .ic.alert { background: var(--red); }
  .ic.info { background: var(--blue); }
  .txt { flex: 1; min-width: 0; }
  .title { font-size: 20px; font-weight: 700; }
  .msg { margin-top: 2px; font-size: 17px; line-height: 1.4; white-space: pre-line; }
  .when { margin-top: 4px; font-size: 15px; color: var(--secondary); }
  .dismiss { flex: none; height: 44px; padding: 0 18px; border-radius: 22px; background: var(--track); font-size: 17px; font-weight: 700; color: var(--label); }
  .dismiss:active { opacity: .6; }
  /* Gone: smaller and greyed, so it doesn't read as needing attention. */
  .past .ic { width: 32px; height: 32px; margin: 0 4px; opacity: .45; }
  .past .title { font-size: 18px; font-weight: 600; color: var(--secondary); }
  .past .msg { color: var(--secondary); }
  .past:active { opacity: .6; }
  .none { margin: 12px 0 4px; font-size: 18px; color: var(--secondary); }
  .said { font-weight: 600; }
</style>
