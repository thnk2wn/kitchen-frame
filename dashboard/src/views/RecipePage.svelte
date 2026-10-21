<script module>
  // Where you are in each recipe's directions, kept while the page is open so leaving a recipe (or
  // the clock screen taking over) and coming back keeps your place. Forgotten after 4 hours.
  const places = new Map(); // recipe id -> { step, at }
  const PLACE_MS = 4 * 3600 * 1000;
</script>

<script>
  import Icon from '../components/Icon.svelte';
  import { recipeTitle, formatDate, stars } from '../lib/format.js';
  import { mediaUrl } from '../lib/api.js';
  import { recipes, paprika, inPaprika, saveRecipe, removeRecipe, addToGroceries } from '../lib/state.svelte.js';
  import { startTimer, splitDurations } from '../lib/timers.svelte.js';
  let { recipe, onback } = $props();
  let showNutrition = $state(false);

  // Tap a step to make it the current one: it's highlighted and the steps before it are checked off.
  // Tap it again to clear. Times inside a step still start timers.
  const saved = places.get(recipe.id);
  let current = $state(saved && Date.now() - saved.at < PLACE_MS ? saved.step : -1);
  function setStep(i) {
    current = current === i ? -1 : i;
    if (current < 0) places.delete(recipe.id); else places.set(recipe.id, { step: current, at: Date.now() });
  }

  // A recipe opened from Explore has an "mdb:" id; a saved one has its own id, savedAt and maybe ref.
  // While loading, recipe is a stand-in with the card's title and photo (loading: true).
  let savedCopy = $derived((recipes.saved || []).find((r) => r.id === recipe.id || (r.ref && r.ref === recipe.id)));
  let isSavedView = $derived(!!recipe.savedAt);
  // With a Paprika account, Save puts the recipe in Paprika; one that's already there says so instead.
  let toPaprika = $derived(!!paprika.configured);
  let already = $derived(toPaprika && !recipe.savedAt && !String(recipe.id).startsWith('pap:') ? inPaprika(recipe) : null);
  const savedText = (res) => (res && res.paprika ? (res.existing ? 'Already in Paprika' : 'Saved to Paprika') : 'Saved');
  // Ours (synced from Paprika): already in our library, so no Save or Remove.
  // "2026-10-10" as "Oct 10", with the year when it isn't this one.
  const madeOn = (day) => {
    const d = new Date(day + 'T12:00:00');
    return formatDate(d, { month: 'short', day: 'numeric', ...(d.getFullYear() !== new Date().getFullYear() ? { year: 'numeric' } : {}) });
  };
  let isOurs = $derived(String(recipe.id || '').startsWith('pap:'));
  let image = $derived(isSavedView
    ? (recipe.hasImage ? mediaUrl('/api/recipes/' + recipe.id + '/image') : null)
    : recipe.image);

  // Tap an ingredient you already have to cross it off; the rest go to Groceries.
  let have = $state(new Set());
  function toggle(i) { const s = new Set(have); s.has(i) ? s.delete(i) : s.add(i); have = s; }
  let needed = $derived(recipe.ingredients.filter((_, i) => !have.has(i)));

  let busy = $state(false);
  let toast = $state(null);
  async function act(fn, done) {
    busy = true; toast = null;
    try { toast = done(await fn()); } catch (e) { toast = 'Something went wrong: ' + e.message; }
    busy = false;
  }
</script>

<header class="top">
  <button class="back" onclick={onback}><Icon name="chevronLeft" size={26} />Recipes</button>
  <div class="actions">
    {#if toast}<span class="toast">{toast}</span>{/if}
    {#if isOurs}
    {:else if isSavedView}
      <button class="btn" disabled={busy} onclick={() => { removeRecipe(recipe.id); onback(); }}><Icon name="trash" size={20} />Remove</button>
    {:else if already}
      <span class="saved" title="Already in your Paprika library"><Icon name="check" size={20} />In Paprika</span>
    {:else if savedCopy}
      <span class="saved"><Icon name="check" size={20} />Saved</span>
    {:else}
      <button class="btn tint" disabled={busy || recipe.loading} onclick={() => act(() => saveRecipe(recipe), savedText)}><Icon name="bookmark" size={20} />{toPaprika ? 'Save to Paprika' : 'Save'}</button>
    {/if}
    <button class="btn solid" disabled={busy || recipe.loading || !needed.length}
      onclick={() => act(() => addToGroceries(recipe, needed), (n) => 'Added ' + n + ' to Groceries')}>
      <Icon name="cart" size={20} />Add {recipe.loading ? '' : needed.length + ' '}to Groceries
    </button>
  </div>
</header>

<div class="page">
  <section class="sheet side">
    <!-- One retry: on a first load the photo can be asked for before the Worker's media cookie is set. -->
    {#if image}<img src={image} alt="" onerror={(e) => { const el = e.currentTarget; if (!el.dataset.retried) { el.dataset.retried = '1'; setTimeout(() => { el.src = image + (image.includes('?') ? '&' : '?') + 'retry=1'; }, 1500); } }} />{:else if recipe.loading}<span class="ghost photo"></span>{/if}
    {#if recipe.title}<h1>{recipeTitle(recipe.title)}</h1>{:else}<span class="ghost wide"></span>{/if}
    {#if recipe.rating}<p class="stars" title="Rated {recipe.rating} of 5">{stars(recipe.rating)[0]}<span class="dim">{stars(recipe.rating)[1]}</span></p>{/if}
    <p class="meta">
      {[recipe.category, recipe.area, recipe.time, recipe.servings && 'Serves ' + recipe.servings, recipe.yield && 'Makes ' + recipe.yield].filter(Boolean).join(' · ')}
    </p>
    <!-- The last day it was on the meal plan (Paprika's Last Prepared). -->
    {#if recipe.lastMade}<p class="meta">Last made {madeOn(recipe.lastMade)}</p>{/if}
    {#if recipe.from}<p class="meta">Saved by {recipe.from}</p>{/if}
    <!-- Our own notes and tweaks (Paprika's Notes), then the recipe's description and nutrition. -->
    {#if recipe.notes || recipe.description || recipe.nutrition}
      <div class="extra">
        {#if recipe.notes}<h3>Notes</h3><p class="notes">{recipe.notes}</p>{/if}
        {#if recipe.description}<p class="desc">{recipe.description}</p>{/if}
        {#if recipe.nutrition}
          <button class="nut" onclick={() => (showNutrition = !showNutrition)}>Nutrition {showNutrition ? '▾' : '▸'}</button>
          {#if showNutrition}<p class="nutrition">{recipe.nutrition}</p>{/if}
        {/if}
      </div>
    {/if}
  </section>

  <section class="sheet ingredients">
    <h2>Ingredients{#if !recipe.loading}<span class="num">{recipe.ingredients.length}</span>{/if}</h2>
    <p class="hint">Tap what you already have</p>
    <div class="scroll">
      {#if recipe.loading}{#each Array(7) as _, i (i)}<span class="ghost row"></span>{/each}{/if}
      {#if recipe.error}<p class="hint">Couldn’t load this recipe: {recipe.error}</p>{/if}
      {#each recipe.ingredients as ing, i (i)}
        <button class="ing" class:have={have.has(i)} onclick={() => toggle(i)}>
          <span class="box">{#if have.has(i)}<Icon name="check" size={16} />{/if}</span>
          <span class="name">{ing.name}</span>
          {#if ing.measure}<span class="measure">{ing.measure}</span>{/if}
        </button>
      {/each}
    </div>
  </section>

  <section class="sheet steps">
    <h2>Directions</h2>
    <ol class="scroll">
      {#if recipe.loading}{#each Array(4) as _, i (i)}<span class="ghost para"></span>{/each}{/if}
      {#each recipe.steps as step, i (i)}
        <!-- Times in a step ("bake 25 minutes") are buttons that start a timer named after the recipe. -->
        <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
        <li class:on={i === current} class:done={i < current} onclick={() => setStep(i)} onkeydown={(e) => e.key === 'Enter' && setStep(i)}>
          <span class="num">{#if i < current}<Icon name="check" size={18} />{:else}{i + 1}{/if}</span><p>{#each splitDurations(step) as part, j (j)}{#if typeof part === 'string'}{part}{:else}<button class="tm" onclick={(e) => { e.stopPropagation(); startTimer(recipeTitle(recipe.title), part.seconds); }}>⏱ {part.text}</button>{/if}{/each}</p>
        </li>
      {/each}
    </ol>
  </section>
</div>

<style>
  .top { flex: none; display: flex; align-items: center; justify-content: space-between; gap: 16px; min-height: 56px; }
  .back { display: flex; align-items: center; gap: 2px; height: 48px; padding: 0 14px 0 4px; font-size: 20px; font-weight: 600; color: var(--blue-text); }
  .actions { display: flex; align-items: center; gap: 10px; }
  .toast { font-size: 17px; color: var(--secondary); }
  .saved { display: inline-flex; align-items: center; gap: 6px; padding: 0 12px; font-size: 18px; font-weight: 600; color: var(--secondary); }
  .btn { display: inline-flex; align-items: center; gap: 8px; height: 48px; padding: 0 20px; border-radius: 24px; font-size: 18px; font-weight: 600; color: var(--blue-text); }
  .btn.tint { background: var(--track); }
  .btn.solid { background: var(--blue); color: #fff; }
  .btn:disabled { opacity: .45; }
  .btn:active { opacity: .7; }
  .page { flex: 1; min-height: 0; display: grid; grid-template-columns: 330px 1fr 1.35fr; gap: 16px; }
  .sheet { min-height: 0; border-radius: 22px; }
  .side { padding: 0 0 18px; overflow: hidden; display: flex; flex-direction: column; }
  .side img { width: 100%; height: 230px; object-fit: cover; }
  .stars { margin: 6px 20px 0; font-size: 22px; letter-spacing: 2px; color: var(--yellow); }
  .stars .dim { color: var(--track); }
  .side h1 { margin: 16px 20px 0; font-size: 24px; font-weight: 600; line-height: 1.2; }
  .meta { margin: 8px 20px 0; font-size: 17px; color: var(--secondary); }
  .extra { flex: 1; min-height: 0; overflow-y: auto; margin: 12px 0 0; padding: 10px 20px 0; border-top: 1px solid var(--sep); }
  .extra h3 { margin: 0 0 4px; font-size: 15px; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; color: var(--orange-text); }
  .notes, .desc, .nutrition { margin: 0 0 10px; font-size: 17px; line-height: 1.4; white-space: pre-line; }
  .desc, .nutrition { color: var(--secondary); font-size: 16px; }
  .nut { padding: 4px 0; font-size: 15px; font-weight: 600; color: var(--secondary); }
  .ingredients, .steps { display: flex; flex-direction: column; padding: 18px 22px 8px; }
  h2 { margin: 0; display: flex; align-items: baseline; gap: 8px; font-size: 21px; font-weight: 700; }
  h2 .num { font-size: 16px; color: var(--secondary); font-weight: 600; }
  .hint { margin: 2px 0 6px; font-size: 15px; color: var(--secondary); }
  .scroll { flex: 1; min-height: 0; overflow-y: auto; }
  .ing { width: 100%; display: flex; align-items: center; gap: 12px; padding: 9px 0; text-align: left; }
  .box { flex: none; width: 24px; height: 24px; border-radius: 7px; border: 2px solid var(--ring); display: grid; place-items: center; color: #fff; }
  .have .box { background: var(--green, #34c759); border-color: var(--green, #34c759); }
  .name { flex: 1; min-width: 0; font-size: 19px; }
  .have .name { color: var(--secondary); text-decoration: line-through; }
  .measure { font-size: 16px; color: var(--secondary); white-space: nowrap; }
  /* overflow-x: the highlighted step reaches into the card's padding (negative margins) without a sideways scroll. */
  ol { margin: 8px 0 0; padding: 0; list-style: none; overflow-x: hidden; }
  .steps ol { margin-left: -10px; margin-right: -10px; padding: 0 10px; }
  li { display: flex; gap: 14px; margin: 0 -10px; padding: 8px 10px 10px; border-radius: 14px; }
  li:active { background: var(--press); }
  /* The current step: highlighted like Paprika's tapped paragraph; earlier ones dim with a check. */
  li.on { background: var(--press); }
  li.on .num { background: var(--orange); color: #fff; }
  li.done p { color: var(--secondary); }
  li.done .num { color: var(--secondary); }
  li .num { flex: none; width: 32px; height: 32px; border-radius: 50%; display: grid; place-items: center; background: var(--track); font-size: 16px; font-weight: 700; }
  .ghost { display: block; border-radius: 8px; background: var(--track); }
  .ghost.photo { height: 230px; border-radius: 0; }
  .ghost.wide { height: 28px; margin: 18px 20px 0; width: 70%; }
  .ghost.row { height: 22px; margin: 12px 0 18px; width: 75%; }
  .ghost.para { height: 60px; margin: 10px 0 16px; }
  li p { margin: 3px 0 0; font-size: 20px; line-height: 1.4; }
  .tm { display: inline; padding: 1px 10px; margin: 0 2px; border-radius: 14px; background: var(--orange); color: #fff; font: inherit; font-weight: 700; }
  .tm:active { opacity: .7; }
</style>
