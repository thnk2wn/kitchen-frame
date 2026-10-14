<script>
  import Icon from '../components/Icon.svelte';
  import TaskRow from '../components/TaskRow.svelte';
  import SortButton from '../components/SortButton.svelte';
  import { clock, lists, ui, completeItem, addItem, listSort, setListSort, sortList } from '../lib/state.svelte.js';
  // board: Tasks, one card per Todoist section (when it has sections; Reminders has none). Otherwise
  // one card, items in as many columns as fit (the same rule as Home's cards), under full-width
  // section names when the list has sections.
  let { name, title, accent, accentText, board = false } = $props();

  let list = $derived(lists[name]);
  let items = $derived(sortList(name, list.items || []));
  let sections = $derived(list.sections || []);
  let known = $derived(new Set(sections.map((x) => x.id)));
  let useBoard = $derived(board && sections.length > 0);
  // On the board, tasks without a section come first, unlabelled, in a full-width card (like Todoist's
  // list view), then every section in Todoist order, empty ones too so it mirrors Todoist. In one
  // card, sections with items in their order, then the rest under "Others" (as Reminders shows it);
  // a list with no sections is one unlabelled group.
  let loose = $derived(items.filter((i) => !i.section || !known.has(i.section)));
  let groups = $derived.by(() => {
    const bySection = new Map(sections.map((x) => [x.id, []]));
    for (const i of items) if (i.section) bySection.get(i.section)?.push(i);
    const out = [];
    for (const x of sections) {
      const its = bySection.get(x.id);
      if (useBoard || its.length) out.push({ id: x.id, name: x.name, items: its });
    }
    if (useBoard) return out;
    if (!out.length) return [{ id: '', name: '', items: loose }];
    if (loose.length) out.push({ id: '~others', name: 'Others', other: true, items: loose });
    return out;
  });
  const who = (item) => (item.assignee && list.people ? list.people[item.assignee] : null);
  let noun = $derived(name === 'todo' ? ['task', 'tasks'] : ['item', 'items']);
  let note = $derived(list.error && /TODOIST_TOKEN/.test(list.error) ? 'Todoist isn’t connected yet.' : list.error || list.warning);

  // Adding: the field only appears after tapping Add, and stays open for several in a row.
  let adding = $state(false);
  let draft = $state('');
  let saving = $state(false);
  let field = $state(null);
  // Tasks only: priority for the next add, cycled none → ! → !! → !!! by the button in the field.
  let priority = $state(0);
  const PRIORITY = ['No priority', 'Low priority', 'Medium priority', 'High priority'];
  function openAdd() { adding = true; requestAnimationFrame(() => field && field.focus()); }
  async function submit(e) {
    e.preventDefault();
    const text = draft.trim();
    if (!text || saving) return;
    saving = true;
    if (await addItem(name, text, priority)) { draft = ''; priority = 0; }
    saving = false;
    field && field.focus();
  }
</script>

<div class="wrap" style="--accent:{accent};--accent-text:{accentText}">
  <header class="bar">
    {#if adding}
      <form class="add" onsubmit={submit}>
        <span class="plus"><Icon name="plus" size={18} /></span>
        <input bind:this={field} bind:value={draft} placeholder={name === 'todo' ? 'New task' : 'Add to groceries'} enterkeyhint="done" autocomplete="off" aria-label={'Add to ' + title} />
        {#if name === 'todo'}
          <button type="button" class="prio" class:on={priority} onclick={() => { priority = (priority + 1) % 4; field && field.focus(); }} aria-label={PRIORITY[priority] + '. Tap to change.'} title={PRIORITY[priority]}>{priority ? '!'.repeat(priority) : '!'}</button>
        {/if}
        <button class="btn solid" disabled={!draft.trim() || saving}>Add</button>
        <button type="button" class="btn" onclick={() => { adding = false; draft = ''; priority = 0; }}>Done</button>
      </form>
    {:else}
      <!-- Groceries | Tasks: both Todoist lists live in one tab. -->
      <div class="seg" role="tablist" aria-label="Lists">
        {#each [['groceries', 'Groceries'], ['todo', 'Tasks']] as [id, label] (id)}
          <button role="tab" aria-selected={name === id} class:on={name === id} onclick={() => (ui.tab = id)}>
            {label}{#if lists[id].items}<span class="n num">{lists[id].items.length}</span>{/if}
          </button>
        {/each}
      </div>
      <div class="tools">
        <SortButton az={listSort[name] === 'az'} onchange={(az) => setListSort(name, az ? 'az' : 'added')} />
        <button class="btn tint" onclick={openAdd}><Icon name="plus" size={20} />Add</button>
      </div>
    {/if}
  </header>
  {#if note}<p class="note">{note}</p>{/if}

  {#if list.items && !items.length}
    <div class="sheet empty">
      <span class="empty-icon"><Icon name={name === 'todo' ? 'check' : 'cart'} size={34} /></span>
      <h2>{name === 'todo' ? 'All done' : 'Grocery list is empty'}</h2>
      <p>Add {noun[1]} here or in Todoist.</p>
      {#if !adding}<button class="btn tint" onclick={openAdd}><Icon name="plus" size={20} />Add</button>{/if}
    </div>
  {:else if useBoard}
    {#if loose.length}
      <div class="sheet loose" style="--cols:{Math.min(3, Math.max(1, Math.ceil(loose.length / 3)))}">
        {#each loose as item (item.id)}
          <TaskRow {item} now={clock.now} person={who(item)} lines={false} ondone={(i) => completeItem(name, i)} onopen={(i) => (ui.task = { list: name, id: i.id })} />
        {/each}
      </div>
    {/if}
    {#if groups.length}
    <div class="board" class:scroll={groups.length > 4}>
      {#each groups as g (g.id)}
        <section class="sheet card">
          <h2>{g.name}<span class="num">{g.items.length}</span></h2>
          <div class="card-items">
            {#each g.items as item (item.id)}
              <TaskRow {item} now={clock.now} person={who(item)} lines={false} ondone={(i) => completeItem(name, i)} onopen={(i) => (ui.task = { list: name, id: i.id })} />
            {:else}
              <p class="none">No {noun[1]}</p>
            {/each}
          </div>
        </section>
      {/each}
    </div>
    {/if}
  {:else if list.items}
    <!-- With sections, each section is a block in the grid (its items stacked under its name); without,
         the items themselves fill the grid. -->
    <div class="sheet flow" class:sectioned={!!groups[0]?.name} style="--min:{name === 'todo' || groups[0]?.name ? 300 : 240}px">
      {#each groups as g (g.id)}
        <section class="group">
          {#if g.name}<h2 class:other={g.other}>{g.name}</h2>{/if}
          {#each g.items as item (item.id)}
            <TaskRow {item} now={clock.now} person={who(item)} lines={false} ondone={(i) => completeItem(name, i)} onopen={(i) => (ui.task = { list: name, id: i.id })} />
          {/each}
        </section>
      {/each}
    </div>
  {/if}
</div>

<style>
  .wrap { height: 100%; padding: 6px 28px 28px; display: flex; flex-direction: column; gap: 16px; }
  .tools { display: flex; align-items: center; gap: 12px; }
  .tools :global(.sort) { width: 46px; height: 46px; }
  .bar { flex: none; display: flex; align-items: center; justify-content: space-between; gap: 16px; min-height: 56px; padding: 0 6px; }
  .seg { display: flex; padding: 3px; border-radius: 14px; background: var(--track); }
  .seg button { display: flex; align-items: center; justify-content: center; gap: 8px; min-width: 150px; height: 46px; padding: 0 20px; border-radius: 11px; font-size: 19px; font-weight: 500; }
  .seg button.on { background: var(--thumb); font-weight: 700; color: var(--accent-text); }
  .seg .n { font-size: 16px; font-weight: 600; color: var(--secondary); }
  .btn { display: inline-flex; align-items: center; gap: 6px; height: 48px; padding: 0 20px; border-radius: 24px; font-size: 19px; font-weight: 600; color: var(--accent-text); }
  .btn.tint { background: var(--track); }
  .btn.solid { background: var(--accent); color: #fff; }
  .btn:disabled { opacity: .4; }
  .btn:active { opacity: .7; }
  .add { flex: 1; display: flex; align-items: center; gap: 12px; height: 56px; padding: 0 6px 0 16px; border-radius: 28px; background: var(--sheet); }
  .plus { flex: none; width: 30px; height: 30px; border-radius: 50%; background: var(--accent); color: #fff; display: grid; place-items: center; }
  input { flex: 1; min-width: 0; height: 100%; border: 0; padding: 0; background: none; font: inherit; font-size: 22px; color: var(--label); outline: none; }
  input::placeholder { color: var(--secondary); }
  .prio { flex: none; min-width: 48px; height: 44px; padding: 0 12px; border-radius: 22px; background: var(--track); font-size: 21px; font-weight: 800; color: var(--secondary); opacity: .55; }
  .prio.on { opacity: 1; color: var(--orange-text); }
  .note { margin: -6px 6px 0; font-size: 17px; color: var(--secondary); }

  /* Tasks: unsectioned tasks in a full-width card on top (flowing into up to three columns as the
     list grows, row by row), then section cards side by side, each only as tall as its tasks. */
  /* A grid, not CSS columns: columns can spill items sideways out of the card, out of sight. */
  .loose { flex: none; max-height: 40%; overflow-y: auto; padding: 10px 20px; border-radius: 22px; display: grid; grid-template-columns: repeat(var(--cols), minmax(0, 1fr)); column-gap: 36px; align-content: start; }
  .board { flex: 1; min-height: 0; display: flex; align-items: flex-start; gap: 16px; }
  .board.scroll { overflow-x: auto; }
  .card { flex: 1 1 0; min-width: 0; max-height: 100%; display: flex; flex-direction: column; padding: 18px 20px 10px; border-radius: 22px; }
  .board.scroll .card { flex: 0 0 290px; }
  .card h2, .group h2 { margin: 0 0 2px; display: flex; align-items: baseline; gap: 8px; font-size: 19px; font-weight: 700; }
  .card h2 .num { font-size: 16px; font-weight: 600; color: var(--secondary); }
  .card-items { min-height: 0; overflow-y: auto; }
  .none { margin: 8px 0 10px; font-size: 18px; color: var(--secondary); }

  /* Groceries: one card, items flowing into columns; sections become small headed groups. */
  /* One card: rows left to right in as many columns as fit, scrolling down when long. (A grid, not
     CSS columns, which push what doesn't fit into extra columns off to the side, out of sight.) */
  .flow { align-self: stretch; max-height: 100%; overflow-y: auto; padding: 16px 26px 14px; border-radius: 22px; display: grid; grid-template-columns: repeat(auto-fill, minmax(var(--min), 1fr)); column-gap: 36px; align-content: start; }
  .group { display: contents; }
  .sectioned { row-gap: 18px; }
  .sectioned .group { display: block; min-width: 0; }
  .group h2 { margin-top: 2px; color: var(--accent-text); }
  .group h2.other { color: var(--secondary); }

  .empty { margin: auto; display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 36px 56px; text-align: center; border-radius: 26px; }
  .empty-icon { width: 64px; height: 64px; border-radius: 50%; display: grid; place-items: center; background: var(--track); color: var(--accent-text); }
  .empty h2 { margin: 8px 0 0; font-size: 26px; font-weight: 700; }
  .empty p { margin: 0 0 10px; font-size: 18px; color: var(--secondary); }
</style>
