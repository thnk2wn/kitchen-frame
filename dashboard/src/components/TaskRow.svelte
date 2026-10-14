<script>
  import Txt from './Txt.svelte';
  import Icon from './Icon.svelte';
  import Avatar from './Avatar.svelte';
  import { dueLabel, dueAt, shortTime } from '../lib/format.js';
  // person: assignee's name (shared projects); section: section name, shown with the due date and
  // the item's note (its Todoist description, e.g. "For: Beef Mandi") on the small line underneath.
  // lines: the iOS inset separator under each row (off inside the Tasks/Groceries cards).
  // brief: one line, no due date or note (Home's grocery card, where space is tight).
  // item.priority (3 high, 2, 1 low) shows as !!!, !! or ! before the title, as in Reminders.
  // item.flagged (Reminders, with REMINDERS_EXTRAS) adds an orange flag after the title.
  // item.time adds the time to the due day ("Today 4 PM"), red once it has passed.
  // Only the circle completes an item; tapping the rest opens it (onopen: its sheet, to edit).
  let { item, now, ondone, onopen = null, person = null, section = null, lines = true, brief = false } = $props();
  let checking = $state(false);
  let at = $derived(dueAt(item));
  let day = $derived(item.due ? dueLabel(item.due, now) : '');
  let due = $derived(at && day !== 'Overdue' ? day + ' ' + shortTime(at) : day);
  let late = $derived(day === 'Overdue' || (at && at < now));
  let rest = $derived([section, item.note].filter(Boolean).join(' · '));

  // The ring fills first, then the row goes, so a tap feels confirmed.
  function tap() {
    if (checking) return;
    checking = true;
    setTimeout(() => ondone(item), 350);
  }
</script>

<div class="row" class:checking class:pending={item.pending} class:plain={!lines} class:brief>
  <!-- The circle's tap area reaches past it on every side, so it's easy to hit on purpose. -->
  <button class="hit" onclick={tap} aria-label={'Complete ' + item.content}><span class="ring">{#if checking}<Icon name="check" size={17} />{/if}</span></button>
  <button class="body" onclick={() => onopen && onopen(item)} aria-label={item.content} tabindex={onopen ? 0 : -1}>
    <span class="main">
      <span class="text">{#if item.priority}<span class="prio" aria-label={['', 'Low', 'Medium', 'High'][item.priority] + ' priority'}>{'!'.repeat(item.priority)}</span>{/if}<Txt text={item.content} />{#if item.flagged}<span class="flag" aria-label="Flagged"><Icon name="flag" size={16} /></span>{/if}</span>
      {#if !brief && (due || rest)}<span class="due"><span class:late>{due}</span>{due && rest ? ' · ' : ''}{rest}</span>{/if}
    </span>
    {#if person}<Avatar id={item.assignee} name={person} size={30} />{/if}
  </button>
</div>

<style>
  .row { display: flex; align-items: flex-start; gap: 14px; position: relative; width: 100%; padding: 12px 0 0; }
  .body:active .text { opacity: .6; }
  .hit { flex: none; margin: -12px -10px -12px -12px; padding: 12px 10px 12px 12px; align-self: flex-start; }
  .hit:active .ring { border-color: var(--accent); }
  /* Added here, not yet confirmed by Todoist or Reminders. */
  .row.pending .text { opacity: .5; }
  .ring { flex: none; width: 26px; height: 26px; margin-top: 1px; border-radius: 50%; border: 2px solid var(--ring); display: grid; place-items: center; color: #fff; transition: background-color .15s ease-out, border-color .15s ease-out; }
  .checking .ring { background: var(--accent); border-color: var(--accent); }
  .checking .text { color: var(--secondary); }
  /* Hairline under the text, not under the ring: the iOS inset separator. */
  .body { flex: 1; min-width: 0; text-align: left; display: flex; align-items: flex-start; gap: 12px; padding-bottom: 12px; border-bottom: 1px solid var(--sep); }
  .main { flex: 1; min-width: 0; }
  .text { display: block; font-size: 21px; overflow-wrap: anywhere; }
  .due { display: block; font-size: 16px; color: var(--secondary); margin-top: 3px; }
  .due .late { color: var(--red-text); }
  .prio { margin-right: 6px; font-weight: 700; color: var(--orange-text); }
  .flag { display: inline-block; margin-left: 8px; vertical-align: -1px; color: var(--orange); }
  .plain { padding-top: 9px; }
  .plain .body { border-bottom: 0; padding-bottom: 9px; }
  .brief { gap: 10px; padding-top: 9px; }
  .brief .body { padding-bottom: 9px; }
  .brief .text { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
</style>
