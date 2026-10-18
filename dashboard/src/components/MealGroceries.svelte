<script>
  // Groceries for the week's meals (Recipes → Meals): one list made from the planned recipes'
  // ingredients by the Worker (worker/meal-groceries.js), staples and what's already on Groceries left
  // out. Everything is shown first: tap a row to leave it off, then Add. Undo takes back exactly what
  // was just added.
  import Icon from './Icon.svelte';
  import { api } from '../lib/api.js';
  import { ui, addGroceries, takeBack, loadList } from '../lib/state.svelte.js';
  import { recipeTitle } from '../lib/format.js';

  let { onclose } = $props();

  let data = $state(null);   // the Worker's answer
  let error = $state(null);
  let skip = $state(new Set()); // names left off
  let busy = $state(false);
  let added = $state(null);  // the items as added, for Undo
  let undone = $state(0);

  async function load() {
    data = null; error = null; added = null; undone = 0; skip = new Set();
    try {
      const r = await api('/api/meals/groceries');
      if (r.error && !(r.items || []).length) error = r.error;
      data = r;
    } catch (e) { error = e.message; }
  }
  load();

  let items = $derived((data && data.items) || []);
  let picked = $derived(items.filter((x) => !skip.has(x.name)));
  function toggle(name) { const s = new Set(skip); s.has(name) ? s.delete(name) : s.add(name); skip = s; }
  const forText = (x) => x.for.map(recipeTitle).join(', ');

  async function add() {
    busy = true; error = null;
    try {
      added = await addGroceries(picked.map((x) => ({ content: x.amount ? x.name + ' (' + x.amount + ')' : x.name, description: 'For: ' + forText(x) })));
    } catch (e) { error = 'Couldn’t add: ' + e.message; }
    busy = false;
  }
  async function undo() {
    busy = true;
    try { undone = await takeBack(added); added = null; } catch (e) { error = 'Couldn’t undo: ' + e.message; }
    busy = false;
  }
  function showList() { onclose(); ui.tab = 'groceries'; loadList('groceries'); }
</script>

<div class="scrim" role="presentation" onclick={onclose}>
  <div class="panel sheet" role="dialog" aria-label="Groceries for the week" tabindex="-1" onclick={(e) => e.stopPropagation()} onkeydown={(e) => e.key === 'Escape' && onclose()}>
    <header>
      <h2>Groceries for the week</h2>
      <button class="x" onclick={onclose} aria-label="Close"><Icon name="close" size={26} /></button>
    </header>

    {#if data && data.meals}
      <p class="from">
        {#if data.meals.length}From {data.meals.map(recipeTitle).join(', ')}.{/if}
        {#if data.unplanned.length} No recipe for {data.unplanned.join(', ')}.{/if}
        Staples and what’s already on the list are left out.
      </p>
    {/if}

    <div class="list">
      {#if error}<p class="note err">{error}</p>{/if}
      {#if !data && !error}
        <p class="note">Working out the list from this week’s recipes…</p>
        {#each Array(6) as _, i (i)}<span class="ghost"></span>{/each}
      {:else if data && !items.length && !error}
        <p class="note">{data.meals.length ? 'Nothing to buy: it’s all on the list or in the cupboard.' : 'No meals with recipes planned this week.'}</p>
      {/if}
      {#each items as x (x.name)}
        <button class="item" class:off={skip.has(x.name)} disabled={!!added || busy} onclick={() => toggle(x.name)}>
          <span class="tick"><Icon name={skip.has(x.name) ? 'minus' : 'check'} size={18} /></span>
          <span class="txt"><span class="name">{x.name}</span>{#if x.amount}<span class="amt num">{x.amount}</span>{/if}<span class="for">{forText(x)}</span></span>
        </button>
      {/each}
    </div>

    <footer>
      {#if added}
        <span class="done"><Icon name="check" size={20} />Added {added.length} to Groceries</span>
        <button class="btn tint" disabled={busy} onclick={undo}>Undo</button>
        <button class="btn solid" onclick={showList}><Icon name="cart" size={20} />Show list</button>
      {:else}
        {#if undone}<span class="done">Took back {undone}</span>{/if}
        {#if items.length}<span class="hint">Tap anything you don’t need</span>{/if}
        <button class="btn solid" disabled={busy || !picked.length} onclick={add}><Icon name="cart" size={20} />Add {picked.length || ''} to Groceries</button>
      {/if}
    </footer>
  </div>
</div>

<style>
  .scrim { position: fixed; inset: 0; z-index: 40; display: grid; place-items: center; background: rgba(0, 0, 0, .45); }
  .panel { width: 760px; max-width: calc(100vw - 40px); max-height: calc(100vh - 60px); display: flex; flex-direction: column; padding: 18px 24px 16px; border-radius: 26px; }
  header { display: flex; align-items: center; justify-content: space-between; }
  h2 { margin: 0; font-size: 26px; font-weight: 800; }
  .x { width: 48px; height: 48px; border-radius: 50%; display: grid; place-items: center; background: var(--track); color: var(--label); }
  .from { margin: 4px 0 6px; font-size: 16px; line-height: 1.35; color: var(--secondary); }
  .list { overflow-y: auto; min-height: 0; }
  .note { margin: 12px 0; font-size: 18px; color: var(--secondary); }
  .note.err { color: var(--red-text); }
  .ghost { display: block; height: 22px; margin: 16px 0; width: 70%; border-radius: 8px; background: var(--track); }
  .item { display: flex; align-items: flex-start; gap: 12px; width: 100%; padding: 10px 0; border-bottom: 1px solid var(--sep); text-align: left; }
  .item:disabled { opacity: 1; }
  .tick { flex: none; width: 30px; height: 30px; margin-top: 1px; border-radius: 50%; display: grid; place-items: center; color: #fff; background: var(--blue); }
  .off .tick { background: var(--track); color: var(--secondary); }
  .txt { flex: 1; min-width: 0; display: flex; flex-wrap: wrap; align-items: baseline; column-gap: 10px; }
  .name { font-size: 20px; font-weight: 700; }
  .amt { font-size: 18px; color: var(--secondary); }
  .for { flex-basis: 100%; font-size: 14px; color: var(--secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .off .name, .off .amt { color: var(--secondary); text-decoration: line-through; }
  footer { display: flex; align-items: center; justify-content: flex-end; gap: 12px; padding-top: 12px; }
  .hint { margin-right: auto; font-size: 16px; color: var(--secondary); }
  .done { margin-right: auto; display: inline-flex; align-items: center; gap: 6px; font-size: 18px; font-weight: 600; }
  .btn { display: inline-flex; align-items: center; gap: 8px; height: 48px; padding: 0 20px; border-radius: 24px; font-size: 18px; font-weight: 600; color: var(--blue-text); }
  .btn.tint { background: var(--track); }
  .btn.solid { background: var(--blue); color: #fff; }
  .btn:disabled { opacity: .45; }
  .btn:active { opacity: .7; }
</style>
