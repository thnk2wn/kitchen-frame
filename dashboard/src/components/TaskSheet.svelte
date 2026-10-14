<script>
  // One list item, opened by tapping its text on Home or the Lists tab: change its title or
  // priority, or complete it. Its due date, section, person and note are shown but not edited here.
  import Icon from './Icon.svelte';
  import { ui, clock, lists, editItem, completeItem } from '../lib/state.svelte.js';
  import { dueLabel, dueAt, shortTime } from '../lib/format.js';

  const PRIORITY = [[0, 'None'], [1, '!'], [2, '!!'], [3, '!!!']];
  let list = $derived(ui.task ? lists[ui.task.list] : null);
  let item = $derived(list && list.items ? list.items.find((i) => i.id === ui.task.id) || null : null);
  let title = $state('');
  let priority = $state(0);
  let saving = $state(false);
  let field = $state(null);

  // Fill the form each time a different item opens (not on every refresh of the same one).
  let openedId = null;
  $effect(() => {
    const id = item ? item.id : null;
    if (id === openedId) return;
    openedId = id;
    if (item) { title = item.content; priority = item.priority || 0; }
  });

  let at = $derived(item ? dueAt(item) : null);
  let due = $derived(item && item.due ? dueLabel(item.due, clock.now) + (at ? ' ' + shortTime(at) : '') : '');
  let section = $derived(item && item.section && list.sections ? (list.sections.find((x) => x.id === item.section) || {}).name : '');
  let person = $derived(item && item.assignee && list.people ? list.people[item.assignee] : '');
  let changes = $derived.by(() => {
    if (!item) return {};
    const c = {};
    if (title.trim() && title.trim() !== item.content) c.content = title.trim();
    if (priority !== (item.priority || 0)) c.priority = priority;
    return c;
  });
  let dirty = $derived(Object.keys(changes).length > 0);

  const close = () => { ui.task = null; };
  async function save(e) {
    e && e.preventDefault();
    if (!dirty || saving) return;
    saving = true;
    const ok = await editItem(ui.task.list, item, changes);
    saving = false;
    if (ok) close();
  }
  function done() {
    const name = ui.task.list;
    close();
    completeItem(name, item);
  }
</script>

{#if item}
  <div class="scrim" role="presentation" onclick={close}>
    <form class="panel sheet" role="dialog" aria-label={item.content} tabindex="-1" onsubmit={save} onclick={(ev) => ev.stopPropagation()} onkeydown={(ev) => ev.key === 'Escape' && close()}>
      <header>
        <span class="kind">{ui.task.list === 'todo' ? 'Task' : 'Grocery item'}</span>
        <button type="button" class="x" onclick={close} aria-label="Close"><Icon name="close" size={26} /></button>
      </header>
      <input bind:this={field} bind:value={title} aria-label="Title" autocomplete="off" enterkeyhint="done" />

      <div class="row">
        <span class="label">Priority</span>
        <div class="seg" role="radiogroup" aria-label="Priority">
          {#each PRIORITY as [p, label] (p)}
            <button type="button" role="radio" aria-checked={priority === p} class:on={priority === p} class:marks={p > 0} onclick={() => (priority = p)}>{label}</button>
          {/each}
        </div>
      </div>
      {#if item.flagged || due || section || person || item.note}
        <p class="info">{[item.flagged ? 'Flagged' : '', due, section, person, item.note].filter(Boolean).join(' · ')}</p>
      {/if}

      <footer>
        <button type="button" class="btn tint" onclick={done}><Icon name="check" size={20} />Complete</button>
        <button class="btn solid" disabled={!dirty || saving}>Save</button>
      </footer>
    </form>
  </div>
{/if}

<style>
  .scrim { position: fixed; inset: 0; z-index: 40; display: grid; place-items: center; background: rgba(0, 0, 0, .45); }
  /* Sits in the top half, so the frame's on-screen keyboard doesn't cover it. */
  .scrim { align-items: start; padding-top: 60px; }
  .panel { width: 640px; max-width: calc(100vw - 40px); display: flex; flex-direction: column; gap: 16px; padding: 18px 24px 22px; border-radius: 26px; }
  header { display: flex; align-items: center; justify-content: space-between; }
  .kind { font-size: 16px; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; color: var(--secondary); }
  .x { flex: none; width: 48px; height: 48px; border-radius: 50%; display: grid; place-items: center; background: var(--fill); color: var(--label); }
  input { height: 58px; padding: 0 18px; border: 0; border-radius: 16px; background: var(--fill); font: inherit; font-size: 24px; color: var(--label); outline: none; }
  .row { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
  .label { font-size: 19px; font-weight: 600; }
  .seg { display: flex; padding: 3px; border-radius: 14px; background: var(--fill); }
  .seg button { min-width: 84px; height: 46px; padding: 0 16px; border-radius: 11px; font-size: 18px; font-weight: 500; }
  .seg button.marks { font-weight: 800; color: var(--orange-text); }
  .seg button.on { background: var(--thumb); font-weight: 700; }
  .info { margin: 0; font-size: 17px; color: var(--secondary); }
  footer { display: flex; justify-content: space-between; gap: 12px; margin-top: 4px; }
  .btn { display: inline-flex; align-items: center; gap: 6px; height: 50px; padding: 0 24px; border-radius: 25px; font-size: 19px; font-weight: 600; color: var(--blue-text); }
  .btn.tint { background: var(--fill); }
  .btn.solid { background: var(--blue); color: #fff; }
  .btn:disabled { opacity: .4; }
  .btn:active { opacity: .7; }
</style>
