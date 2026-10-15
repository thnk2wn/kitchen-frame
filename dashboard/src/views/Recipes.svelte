<script module>
  // TheMealDB categories in a deliberate order: weeknight proteins, then meal types, dessert last.
  // Left out: Vegetarian and Vegan (not wanted here) and Goat (2 recipes). Miscellaneous reads as Other.
  const CATS = [
    ['Chicken'], ['Beef'], ['Pork'], ['Seafood'], ['Pasta'], ['Lamb'], ['Breakfast'], ['Starter'], ['Side'], ['Dessert'], ['Miscellaneous', 'Other'],
  ];
  // Category lists already fetched this session (the HTTP cache also keeps them for a day).
  const lists = new Map();

  // Fade a photo in once it has loaded, including one that was already cached.
  function fade(img) {
    const show = () => img.classList.add('in');
    if (img.complete && img.naturalWidth) show();
    else img.addEventListener('load', show, { once: true });
  }
</script>

<script>
  import { tick } from 'svelte';
  import Icon from '../components/Icon.svelte';
  import RecipePage from './RecipePage.svelte';
  import { api, cached, remember, mediaUrl } from '../lib/api.js';
  import { recipeTitle } from '../lib/format.js';
  import { recipes, loadRecipes, paprika, loadPaprika, mealItems, loadMeals, ui } from '../lib/state.svelte.js';
  import { dayKey, addDays } from '../lib/format.js';

  // Paprika (our library, synced by the Worker when it has an account), Explore (TheMealDB) and Saved
  // (agents or Save on the frame). Tapping a card opens its page over the grid, so going back
  // keeps the scroll position and doesn't rebuild the cards.
  const stored = localStorage.getItem('frame-recipes-mode');
  // The Paprika view appears when the Worker has a Paprika account.
  const oursOn = () => paprika.configured !== false;
  const startMode = stored === 'saved' || stored === 'explore' || (stored === 'meals' && oursOn()) ? stored : oursOn() ? 'ours' : 'explore';
  let mode = $state(startMode);
  // Each pane is built the first time it's shown and then kept; switching only hides one (no
  // rebuilding cards or re-decoding photos).
  let oursSeen = $state(startMode === 'ours');
  let mealsSeen = $state(startMode === 'meals');
  let savedSeen = $state(startMode === 'saved');
  let exploreSeen = $state(startMode === 'explore');
  function setMode(m) {
    mode = m;
    localStorage.setItem('frame-recipes-mode', m);
    if (m === 'ours') { oursSeen = true; loadPaprika(); }
    if (m === 'meals') { mealsSeen = true; loadMeals(); }
    if (m === 'saved') { savedSeen = true; loadRecipes(); }
    if (m === 'explore' && !exploreSeen) { exploreSeen = true; loadCat(cat); }
  }
  // No Paprika account on the Worker: fall back to Explore.
  $effect(() => { if (!oursOn() && (mode === 'ours' || mode === 'meals')) setMode('explore'); });

  // Meals: the Paprika meal plan, today and the next six days.
  let week = $derived.by(() => {
    const today = new Date();
    return Array.from({ length: 7 }, (_, i) => {
      const d = addDays(today, i), key = dayKey(d);
      const label = i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
      return { key, label, items: mealItems().filter((m) => m.date === key) };
    });
  });

  // A meal tapped on Home opens its recipe here.
  $effect(() => {
    const want = ui.openRecipe;
    if (!want) return;
    ui.openRecipe = null;
    openOurs({ id: want.id, title: want.title, hasImage: true });
  });

  // Paprika: filter chips are All, Favorites (if any), every Paprika category A–Z, then Uncategorized
  // (if any recipe has none). The row scrolls sideways when they don't fit.
  const NONE = 'Uncategorized';
  let ourCat = $state('All');
  let ourCats = $derived.by(() => {
    const rs = paprika.recipes || [];
    const names = [...new Set(rs.flatMap((r) => r.categories))].sort((a, b) => a.localeCompare(b));
    return ['All', ...(rs.some((r) => r.favorite) ? ['Favorites'] : []), ...names, ...(rs.some((r) => !r.categories.length) ? [NONE] : [])];
  });
  // Search (by name) and an A–Z index strip to jump through a long library without typing.
  let searching = $state(false);
  let query = $state('');
  let ourGrid = $state();
  const fold = (t) => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const letterOf = (t) => { const c = fold(t).replace(/^[^a-z0-9]+/, '').charAt(0).toUpperCase(); return /[A-Z]/.test(c) ? c : '#'; };
  let ours = $derived((paprika.recipes || []).filter((r) =>
    (ourCat === 'All' || (ourCat === 'Favorites' ? r.favorite : ourCat === NONE ? !r.categories.length : r.categories.includes(ourCat)))
    && (!query.trim() || fold(r.title).includes(fold(query.trim())))));
  let letters = $derived([...new Set(ours.map((r) => letterOf(r.title)))]);
  // Cards are built as you scroll to them: a screenful when the tab opens, then a batch whenever the
  // end comes within a couple of rows. Building all 190 at once froze the frame for about 3 s.
  const BATCH = 20;
  let shownN = $state(BATCH);
  let oursShown = $derived(ours.slice(0, shownN));
  $effect(() => { ours; shownN = BATCH; }); // a new filter or search starts again from one screenful
  // The marker after the last card: when it nears the visible area, build the next batch.
  function more(marker) {
    const io = new IntersectionObserver((es) => {
      if (es.some((e) => e.isIntersecting) && shownN < ours.length) shownN = Math.min(ours.length, shownN + BATCH);
    }, { root: marker.parentElement, rootMargin: '0px 0px 500px 0px' });
    io.observe(marker);
    return { destroy: () => io.disconnect() };
  }

  async function jump(letter) {
    const i = ours.findIndex((r) => letterOf(r.title) === letter);
    if (i >= shownN) { shownN = Math.min(ours.length, i + BATCH); await tick(); }
    const el = ourGrid && ourGrid.children[i];
    if (!el) return;
    // Cards not yet rendered (content-visibility) are laid out at a placeholder size, so the target
    // moves as the cards before it render: correct over a few frames until it sits at the top.
    let tries = 6;
    const settle = () => {
      const off = el.getBoundingClientRect().top - ourGrid.getBoundingClientRect().top;
      if (Math.abs(off) < 2 || !tries--) return;
      ourGrid.scrollTop += off;
      requestAnimationFrame(settle);
    };
    settle();
  }
  function toggleSearch() { searching = !searching; if (!searching) query = ''; }
  // v: the photo's version, so a photo replaced in Paprika isn't shown from the browser's cache.
  // w: 320 for the grid's cards (about 240 px wide), the full 640 for a recipe's page.
  const ourThumb = (r, w = 0) => (r.hasImage ? mediaUrl('/api/recipes/paprika/' + r.id.slice(4) + '/image?' + new URLSearchParams({ ...(r.img ? { v: r.img } : {}), ...(w ? { w } : {}) })) : null);
  async function openOurs(card) {
    open = { id: card.id, title: card.title, image: ourThumb(card), ingredients: [], steps: [], loading: true };
    const want = open;
    try {
      const full = (await api('/api/recipes/paprika/' + encodeURIComponent(card.id.slice(4)))).recipe;
      if (open === want) open = { ...full, image: ourThumb(card) };
    } catch (e) { if (open === want) open = { ...want, loading: false, error: e.message }; }
  }
  function surprise() {
    if (mode === 'ours') { if (ours.length) openOurs(ours[Math.floor(Math.random() * ours.length)]); }
    else openRecipe(null, 'random=1');
  }

  const last = cached('recipes-cards'); // { cat, cards }: the last category shows instantly on boot
  const first = CATS.some(([id]) => id === last?.cat) ? last.cat : 'Chicken';
  let cat = $state(first);
  let cards = $state(lists.get(first) || last?.cards || null);
  let error = $state(null);
  let open = $state(null);
  // While a recipe is up, the frame stays off the clock screen (state.svelte.js idleCheck).
  $effect(() => { ui.recipeOpen = !!open; return () => { ui.recipeOpen = false; }; });
  let grid = $state();

  async function loadCat(c) {
    const same = c === cat;
    if (!same && grid) grid.scrollTop = 0;
    cat = c; error = null;
    cards = lists.get(c) || (same ? cards : null);
    if (lists.has(c)) return;
    try {
      const list = (await api('/api/recipes/explore?c=' + encodeURIComponent(c))).recipes;
      lists.set(c, list);
      remember('recipes-cards', { cat: c, cards: list });
      if (cat === c) cards = list;
    } catch (e) { if (cat === c) error = e.message; }
  }

  // Open straight away with what the card knows (its photo is already loaded), then fill in.
  async function openRecipe(card, path) {
    open = { id: card?.id, title: card?.title || '', image: card?.thumb || null, ingredients: [], steps: [], loading: true };
    const want = open;
    try {
      const full = (await api('/api/recipes/explore?' + path)).recipe;
      if (open === want) open = full;
    } catch (e) { if (open === want) open = { ...want, loading: false, error: e.message }; }
  }

  if (startMode === 'explore') loadCat(first);
  loadMeals();
  loadRecipes();
  loadPaprika();

  const savedThumb = (r) => (r.hasImage ? mediaUrl('/api/recipes/' + r.id + '/image') : null);
</script>

<div class="wrap">
  <div class="list" class:hidden={open}>
    <header class="bar">
      <div class="seg" role="tablist" aria-label="Recipes">
        {#if oursOn()}
          <button role="tab" aria-selected={mode === 'meals'} class:on={mode === 'meals'} onclick={() => setMode('meals')}>Meals</button>
          <button role="tab" aria-selected={mode === 'ours'} class:on={mode === 'ours'} onclick={() => setMode('ours')}>Paprika{#if paprika.recipes?.length}<span class="n num">{paprika.recipes.length}</span>{/if}</button>
        {/if}
        <button role="tab" aria-selected={mode === 'explore'} class:on={mode === 'explore'} onclick={() => setMode('explore')}>Explore</button>
        <button role="tab" aria-selected={mode === 'saved'} class:on={mode === 'saved'} onclick={() => setMode('saved')}>Saved{#if recipes.saved?.length}<span class="n num">{recipes.saved.length}</span>{/if}</button>
      </div>
      <div class="actions">
        {#if mode === 'ours'}
          <button class="btn tint" class:on={searching} onclick={toggleSearch} aria-label="Search recipes"><Icon name="search" size={20} />Search</button>
        {/if}
        {#if mode === 'explore' || mode === 'ours'}
          <button class="btn tint" onclick={surprise}><Icon name="shuffle" size={20} />Surprise me</button>
        {/if}
      </div>
    </header>

    <div class="panes">
      {#if mealsSeen}
        <div class="pane" class:off={mode !== 'meals'}>
          <div class="week">
            {#each week as d (d.key)}
              <section class="day" class:today={d.label === 'Today'}>
                <h3>{d.label}</h3>
                <div class="dmeals">
                  {#each d.items as m (m.type + m.title)}
                    <button class="mcard sheet" class:bare={!m.id} disabled={!m.id} onclick={() => openOurs({ id: m.id, title: m.title, hasImage: m.hasImage })}>
                      {#if m.id && m.hasImage}<img src={ourThumb({ id: m.id, hasImage: true })} alt="" loading="lazy" decoding="async" use:fade />{:else}<span class="mnoimg"><Icon name="utensils" size={22} /></span>{/if}
                      <span class="mlabel"><span class="mtype">{m.type}</span><span class="mtitle">{recipeTitle(m.title)}</span></span>
                    </button>
                  {:else}
                    <span class="nothing">Nothing planned</span>
                  {/each}
                </div>
              </section>
            {/each}
          </div>
        </div>
      {/if}

      {#if oursSeen}
        <div class="pane" class:off={mode !== 'ours'}>
          {#if paprika.recipes && !paprika.recipes.length}
            <div class="sheet empty">
              <span class="empty-icon"><Icon name="utensils" size={30} /></span>
              <h2>Bringing in your recipes</h2>
              <p>The first sync from Paprika runs a batch every 15 minutes. They’ll show up here as they arrive.</p>
            </div>
          {:else}
            {#if searching}
              <!-- svelte-ignore a11y_autofocus -->
              <input class="search" bind:value={query} placeholder="Search {paprika.recipes?.length || ''} recipes by name" autofocus autocomplete="off" enterkeyhint="search" />
            {:else}
              <div class="chips scrollx">
                {#each ourCats as c (c)}
                  <button class="chip" class:on={c === ourCat} onclick={() => (ourCat = c)}>{c}</button>
                {/each}
              </div>
            {/if}
            <div class="withindex">
            <div class="grid" bind:this={ourGrid}>
              {#if !paprika.recipes}
                {#each Array(10) as _, i (i)}<div class="card sheet ghost"></div>{/each}
              {/if}
              {#each oursShown as r (r.id)}
                <button class="card sheet" class:bare={!ourThumb(r)} onclick={() => openOurs(r)}>
                  <span class="ph">
                    {#if ourThumb(r)}<img src={ourThumb(r, 320)} alt="" loading="lazy" decoding="async" use:fade />{:else}<span class="noimg"><Icon name="utensils" size={36} /></span>{/if}
                  </span>
                  <span class="label">
                    <span class="title">{recipeTitle(r.title)}</span>
                    {#if r.categories.length}<span class="sub">{r.categories.join(' · ')}</span>{/if}
                  </span>
                </button>
              {:else}
                {#if paprika.recipes}<p class="note">No recipes match.</p>{/if}
              {/each}
              {#if shownN < ours.length}<span class="more" use:more></span>{/if}
            </div>
            {#if letters.length > 6}
              <div class="index" aria-label="Jump to letter">
                {#each letters as l (l)}<button onclick={() => jump(l)}>{l}</button>{/each}
              </div>
            {/if}
            </div>
          {/if}
        </div>
      {/if}

      {#if exploreSeen}
      <div class="pane" class:off={mode !== 'explore'}>
        <div class="chips">
          {#each CATS as [id, label] (id)}
            <button class="chip" class:on={id === cat} onclick={() => loadCat(id)}>{label || id}</button>
          {/each}
        </div>
        <div class="grid" bind:this={grid}>
          {#if error}
            <p class="note">Couldn’t load recipes. <button class="retry" onclick={() => loadCat(cat)}>Try again</button></p>
          {:else if !cards}
            {#each Array(10) as _, i (i)}<div class="card sheet ghost"></div>{/each}
          {:else}
            {#each cards as r (r.id)}
              <button class="card sheet" onclick={() => openRecipe(r, 'id=' + encodeURIComponent(r.id))}>
                <span class="ph"><img src={r.thumb} alt="" loading="lazy" decoding="async" use:fade /></span>
                <span class="label"><span class="title">{recipeTitle(r.title)}</span></span>
              </button>
            {/each}
          {/if}
        </div>
      </div>
      {/if}

      {#if savedSeen}
        <div class="pane" class:off={mode !== 'saved'}>
          {#if recipes.saved && !recipes.saved.length}
            <div class="sheet empty">
              <span class="empty-icon"><Icon name="bookmark" size={30} /></span>
              <h2>No saved recipes yet</h2>
              <p>Tap Save on a recipe in Explore, or ask an agent to save one from a link.</p>
              <button class="btn tint" onclick={() => setMode('explore')}>Explore recipes</button>
            </div>
          {:else}
            <div class="grid">
              {#each recipes.saved || [] as r (r.id)}
                <button class="card sheet" class:bare={!savedThumb(r)} onclick={() => (open = r)}>
                  <span class="ph">
                    {#if savedThumb(r)}<img src={savedThumb(r)} alt="" loading="lazy" decoding="async" use:fade />{:else}<span class="noimg"><Icon name="utensils" size={36} /></span>{/if}
                  </span>
                  <span class="label">
                    <span class="title">{recipeTitle(r.title)}</span>
                    {#if r.from || r.category}<span class="sub">{[r.category, r.from && 'from ' + r.from].filter(Boolean).join(' · ')}</span>{/if}
                  </span>
                </button>
              {/each}
            </div>
          {/if}
        </div>
      {/if}
    </div>
  </div>

  {#if open}
    <div class="detail"><RecipePage recipe={open} onback={() => (open = null)} /></div>
  {/if}
</div>

<style>
  .wrap { position: relative; height: 100%; }
  .list, .detail { position: absolute; inset: 0; padding: 6px 28px 28px; display: flex; flex-direction: column; gap: 14px; }
  /* Hidden, not removed, while a recipe is open: keeps its layout and scroll position. */
  .list.hidden, .pane.off { visibility: hidden; }
  .panes { position: relative; flex: 1; min-height: 0; }
  .pane { position: absolute; inset: 0; display: flex; flex-direction: column; gap: 14px; }
  .bar { flex: none; display: flex; align-items: center; justify-content: space-between; min-height: 56px; padding: 0 6px; }
  .seg { display: flex; padding: 3px; border-radius: 14px; background: var(--track); }
  .seg button { display: flex; align-items: center; gap: 8px; min-width: 130px; justify-content: center; height: 44px; padding: 0 18px; border-radius: 11px; font-size: 18px; font-weight: 500; }
  .seg button.on { background: var(--thumb); font-weight: 600; }
  .seg .n { font-size: 15px; color: var(--secondary); }
  .btn { display: inline-flex; align-items: center; gap: 8px; height: 48px; padding: 0 20px; border-radius: 24px; font-size: 18px; font-weight: 600; color: var(--blue-text); }
  .btn.tint { background: var(--track); }
  .btn:active { opacity: .7; }
  /* All categories on one row, stretched to the grid's width. */
  .chips { flex: none; display: flex; gap: 6px; }
  .chip { flex: 1 0 auto; height: 40px; padding: 0 10px; border-radius: 20px; background: var(--track); font-size: 16px; font-weight: 600; white-space: nowrap; text-align: center; }
  .chip.on { background: var(--label); color: var(--sheet); }
  /* Ours: as many chips as we have categories, so the row scrolls sideways instead of stretching. */
  /* Meals: one row per day, its meals as wide cards. */
  .week { flex: 1; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 10px; }
  .day { display: grid; grid-template-columns: 190px 1fr; align-items: center; gap: 14px; }
  .day h3 { margin: 0 6px; font-size: 19px; font-weight: 700; color: var(--secondary); }
  .day.today h3 { color: var(--orange-text); }
  .dmeals { display: flex; gap: 10px; min-width: 0; overflow-x: auto; scrollbar-width: none; }
  .mcard { flex: 0 0 340px; display: flex; align-items: center; gap: 12px; padding: 8px; border-radius: 16px; text-align: left; }
  .mcard:not(:disabled):active { opacity: .7; }
  .mcard:disabled { opacity: 1; }
  .mcard img, .mnoimg { flex: none; width: 64px; height: 64px; border-radius: 12px; object-fit: cover; background: var(--track); }
  .mnoimg { display: grid; place-items: center; color: var(--secondary); }
  .mlabel { min-width: 0; display: flex; flex-direction: column; gap: 2px; }
  .mtype { font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; color: var(--orange-text); }
  .mtitle { font-size: 17px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .nothing { padding: 20px 6px; font-size: 17px; color: var(--tertiary); }
  .actions { display: flex; gap: 10px; }
  .btn.tint.on { background: var(--label); color: var(--sheet); }
  .search { flex: none; height: 46px; padding: 0 18px; border: 0; border-radius: 23px; background: var(--sheet); font: inherit; font-size: 19px; color: var(--label); outline: none; }
  .search::placeholder { color: var(--secondary); }
  /* Paprika grid with an A–Z strip down its right edge (tap a letter to jump). */
  .withindex { flex: 1; min-height: 0; display: flex; gap: 8px; }
  .withindex .grid { flex: 1; }
  .index { flex: none; width: 30px; display: flex; flex-direction: column; justify-content: space-between; padding: 4px 0; border-radius: 15px; background: var(--track); }
  .index button { flex: 1; max-height: 34px; font-size: 13px; font-weight: 700; color: var(--blue-text); text-align: center; }
  .index button:active { background: var(--thumb); border-radius: 8px; }
  .chips.scrollx { overflow-x: auto; scrollbar-width: none; }
  .chips.scrollx::-webkit-scrollbar { display: none; }
  .chips.scrollx .chip { flex: none; padding: 0 16px; }
  .chip:not(.on):active { opacity: .6; }
  .note { grid-column: 1 / -1; margin: 0 6px; font-size: 18px; color: var(--secondary); }
  .retry { font-size: 18px; font-weight: 600; color: var(--blue-text); }
  /* Five across: each photo is ~350 device px wide on the frame, TheMealDB's /medium size. */
  .grid { flex: 1; min-height: 0; overflow-y: auto; display: grid; grid-template-columns: repeat(5, 1fr); grid-auto-rows: max-content; gap: 14px; align-content: start; }
  /* Square cards: the photo fills the card and the title sits on a dark fade at the bottom. */
  .card { position: relative; display: block; aspect-ratio: 1; padding: 0; border-radius: 18px; overflow: hidden; text-align: left; background: var(--track); content-visibility: auto; contain-intrinsic-size: auto 234px; }
  .card:active { opacity: .8; }
  .more { grid-column: 1 / -1; height: 1px; }
  .ph { position: absolute; inset: 0; }
  .ph img { display: block; width: 100%; height: 100%; object-fit: cover; opacity: 0; transition: opacity .25s; }
  .ph :global(img.in) { opacity: 1; }
  .noimg { height: 100%; display: grid; place-items: center; padding-bottom: 40px; color: var(--tertiary); }
  .label { position: absolute; left: 0; right: 0; bottom: 0; display: flex; flex-direction: column; gap: 2px; padding: 44px 14px 12px; color: #fff; background: linear-gradient(rgba(0, 0, 0, 0), rgba(0, 0, 0, .62)); }
  .title { font-size: 16px; font-weight: 500; line-height: 1.25; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
  .sub { font-size: 13px; opacity: .8; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  /* No photo: plain text on the grey card. */
  .bare .label { color: var(--label); background: none; }
  .bare .sub { color: var(--secondary); opacity: 1; }
  .empty { margin: auto; display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 36px 56px; text-align: center; border-radius: 26px; max-width: 560px; }
  .empty-icon { width: 64px; height: 64px; border-radius: 50%; display: grid; place-items: center; background: var(--track); color: var(--blue-text); }
  .empty h2 { margin: 8px 0 0; font-size: 26px; font-weight: 700; }
  .empty p { margin: 0 0 10px; font-size: 18px; color: var(--secondary); }
</style>
