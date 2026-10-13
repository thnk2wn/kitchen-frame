<script>
  import Icon from './Icon.svelte';
  import Avatar from './Avatar.svelte';
  import { dueLabel } from '../lib/format.js';
  // person: assignee's name (shared projects); section: section name, shown with the due date and
  // the item's note (its Todoist description, e.g. "For: Beef Mandi") on the small line underneath.
  // lines: the iOS inset separator under each row (off inside the Tasks/Groceries cards).
  // brief: one line, no due date or note (Home's grocery card, where space is tight).
  let { item, now, ondone, person = null, section = null, lines = true, brief = false } = $props();
  let checking = $state(false);
  let due = $derived(item.due ? dueLabel(item.due, now) : '');
  let rest = $derived([section, item.note].filter(Boolean).join(' · '));

  // The ring fills first, then the row goes, so a tap feels confirmed.
  function tap() {
    if (checking) return;
    checking = true;
    setTimeout(() => ondone(item), 350);
  }
</script>

<button class="row" class:checking class:plain={!lines} class:brief onclick={tap} aria-label={'Complete ' + item.content}>
  <span class="ring">{#if checking}<Icon name="check" size={17} />{/if}</span>
  <span class="body">
    <span class="main">
      <span class="text">{item.content}</span>
      {#if !brief && (due || rest)}<span class="due"><span class:late={due === 'Overdue'}>{due}</span>{due && rest ? ' · ' : ''}{rest}</span>{/if}
    </span>
    {#if person}<Avatar id={item.assignee} name={person} size={30} />{/if}
  </span>
</button>

<style>
  .row { display: flex; align-items: flex-start; gap: 14px; position: relative; width: 100%; padding: 12px 0 0; }
  .row:active .text { opacity: .6; }
  .ring { flex: none; width: 26px; height: 26px; margin-top: 1px; border-radius: 50%; border: 2px solid var(--ring); display: grid; place-items: center; color: #fff; transition: background-color .15s ease-out, border-color .15s ease-out; }
  .checking .ring { background: var(--accent); border-color: var(--accent); }
  .checking .text { color: var(--secondary); }
  /* Hairline under the text, not under the ring: the iOS inset separator. */
  .body { flex: 1; min-width: 0; display: flex; align-items: flex-start; gap: 12px; padding-bottom: 12px; border-bottom: 1px solid var(--sep); }
  .main { flex: 1; min-width: 0; }
  .text { display: block; font-size: 21px; overflow-wrap: anywhere; }
  .due { display: block; font-size: 16px; color: var(--secondary); margin-top: 3px; }
  .due .late { color: var(--red-text); }
  .plain { padding-top: 9px; }
  .plain .body { border-bottom: 0; padding-bottom: 9px; }
  .brief { gap: 10px; padding-top: 9px; }
  .brief .body { padding-bottom: 9px; }
  .brief .text { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
</style>
