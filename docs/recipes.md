# Recipes

**Needs:** nothing for **Explore** and **Saved** (TheMealDB is free, and saved recipes live in the
Worker). A [Paprika](https://www.paprikaapp.com) account (`PAPRIKA_EMAIL`, `PAPRIKA_PASSWORD`) is
optional; it adds the **Meals** and **Paprika** views and saving into your Paprika library.

The Recipes tab has four views:

- **Meals:** the Paprika meal plan for the week (see the README's Paprika section). The Worker checks
  Paprika every 15 minutes and tells the frame the moment the plan changed, so a meal moved in the
  Paprika app shows within 15 minutes of Paprika syncing it (open Paprika, or tap its Sync button).
  **Groceries for the week** turns the week's planned recipes into one shopping list (below).
- **Paprika:** your Paprika library, synced read-only, with its categories (A–Z, and Uncategorized
  when a recipe has none), search and an A–Z strip.
- **Explore:** recipes from [TheMealDB](https://www.themealdb.com) (free, a few hundred curated
  recipes with photos; the free API key is for personal use). Browse by category or tap
  **Surprise me** for a random recipe. Vegetarian and Vegan recipes are left out (`HIDDEN` in
  `worker/recipes.js`), as is Goat, which has only 2 recipes.
- **Saved:** with a Paprika account configured, **Save to Paprika** on an Explore recipe (and a
  recipe an agent sends) goes straight into your Paprika library, photo included, filed under your
  category of the same name when you have one (Explore's Seafood into Seafood, Chicken into
  Poultry, Starter into Appetizers), otherwise under a **Kitchen Frame** category if you've made
  one in the Paprika app, otherwise uncategorized (Paprika's sync API has no call to create a
  category). It shows up in the Paprika apps within a minute and in the frame's Paprika view a few
  seconds later. A recipe already in the library, by source link or by
  title, shows **In Paprika** instead of Save, and the Worker refuses a duplicate at save time too.
  Without Paprika, Save keeps the recipe on the Worker and it appears under **Saved**; remove one
  with the trash button on its page. A Saved recipe from before Paprika saving can be moved into
  Paprika with `POST /api/recipes/<id>/paprika` (the frame's key); Saved hides itself once empty.

On a recipe page, tap the ingredients you already have to cross them off. **Add N to Groceries**
then adds the rest to Groceries (Todoist's grocery project, or the Reminders list when Groceries
comes from Reminders; see [lists.md](lists.md)), one item each, such as "Chicken thighs (2 lb)". Each
item's note reads "For: <recipe title>", which the frame shows in small grey text under it (the
first line of any note is shown the same way, on Groceries and Tasks). In demo mode nothing leaves
the frame.

## Saving a recipe from an agent

```sh
curl -X POST https://photo-frame-dashboard.<your-subdomain>.workers.dev/api/recipes \
  -H "Authorization: Bearer $AGENT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title": "Sheet-pan lemon chicken", "from": "Claude", "time": "40 min", "servings": 4,
       "image": "https://example.com/photo.jpg", "source": "https://example.com/recipe",
       "ingredients": [{"name": "Chicken thighs", "measure": "2 lb"}, "3 lemons"],
       "steps": ["Heat the oven to 425°F.", "Roast 35 minutes."]}'
```

- **Token:** the same `AGENT_TOKEN` as [messages](messages.md). With it an agent can add recipes
  and post messages, nothing else: it can't list or remove recipes.
- **Fields:**
  - `title` (≤120 characters) is required.
  - `ingredients` and/or `steps` are required: ingredients ≤60, as strings or `{name, measure}`;
    steps ≤60, plain strings with no numbering.
  - Optional: `image` (https JPEG/PNG/WebP ≤3 MB, copied into KV at save time so it keeps working
    and the frame never fetches other sites), `servings`, `time`, `source` (http URL), `from`
    (shown as "Saved by …"), `category`, `tags` (≤8).
- **Response:** `201 {"id": "..."}`. `400` for a missing title or no ingredients and no steps,
  `401` for a wrong token, `429` when 300 recipes are saved.
- **Where it goes:** into Paprika when `PAPRIKA_EMAIL`/`PAPRIKA_PASSWORD` are set (the response is
  `{ paprika: true, uid }`, or `existing: true` when the library already had it); otherwise into
  the Worker's Saved list (`{ id }`). Send `"local": true` to keep it on the Worker regardless.
- **Timing:** the frame loads Saved whenever the Recipes tab or Saved is opened.
- **Skill:** `~/.agents/skills/kitchen-frame-recipe` (linked from `~/.claude/skills`). It extracts
  schema.org Recipe data from a link, previews it, and posts with `$KITCHEN_FRAME_URL` /
  `$KITCHEN_FRAME_TOKEN`.

## Speed and cost

- **Photos:** the grid loads TheMealDB's `/medium` size (350px, ~35 KB), which matches a card on
  the frame's 1.5x screen. Recipe pages use `/large` (500px). Both come straight from TheMealDB,
  so they cost no Worker requests, and they load lazily as you scroll.
- **Saved photos** are resized once, when saved, to 640px JPEG with the Cloudflare Images binding
  (`IMAGES`). One transformation per saved recipe, well within the free 5,000 a month. A
  1.1 MB source photo becomes ~75 KB. Photos under 150 KB are stored as they are.
- **Category lists and recipes** are sent with `Cache-Control: private, max-age=86400`, so the
  frame's own cache answers repeat visits for a day without contacting the Worker. The last
  category viewed is also kept in localStorage, so the grid draws instantly when the tab opens.
- **Categories** are a fixed list in `src/views/Recipes.svelte` (in a deliberate order; Goat,
  with 2 recipes, is left out), so no request is needed.
- **Opening a recipe** shows its title and photo at once from the card, then fills in the
  ingredients and steps. The grid stays underneath (hidden), so Back keeps the scroll position.
- **Explore and Saved** each stay built once shown; switching between them only hides one, so
  no cards are rebuilt and no photos are decoded again. An unchanged Saved list doesn't redraw.
- **Saved** is fetched only when the Recipes tab or Saved is opened. There's no background polling.

## Endpoints

| Method | Path | Who | |
| --- | --- | --- | --- |
| GET | `/api/recipes/explore?c=Chicken` | frame | cards in a category |
| GET | `/api/recipes/explore?id=mdb:52772` | frame | one full recipe |
| GET | `/api/recipes/explore?random=1` | frame | a random full recipe (never cached) |
| GET | `/api/recipes` | frame | saved recipes |
| POST | `/api/recipes` | frame or agent | save one (deduplicated by `ref`, e.g. a TheMealDB id) |
| DELETE | `/api/recipes/:id` | frame | remove one and its photo |
| GET | `/api/recipes/:id/image` | frame (its auth cookie) | a saved recipe's photo |
| POST | `/api/lists/groceries` | frame | `{"items": [{"content", "description"}]}` adds several at once |

Saved recipes are one KV value (`recipes`). Photos are stored as `recipe-image:<id>`.

## The Paprika library

Optional. With `PAPRIKA_EMAIL` and `PAPRIKA_PASSWORD` set (a Paprika Cloud Sync account), the
Recipes tab gets the **Paprika** view: your library with its categories, favourites and Surprise
me, and "Add to Groceries" as for any recipe. Search by name, or tap a letter on the A–Z strip down
the right edge to jump through a long library. A recipe shows your Paprika notes beside it, plus its
description and nutrition (tap to expand) when it has them.

A cron reads the library every 15 minutes, fetching only new or changed recipes, a batch at a time,
and stores them with resized photos. Paprika has no official API, so this uses the undocumented one
its apps sync with (`dashboard/worker/paprika.js`); if that changes, the last copy keeps showing.
The same sync reads Paprika's meal plan (2 days back to 3 weeks ahead): today's meals appear at the
top of Home's Today list, and Recipes gets the **Meals** view of the next seven days.

The Worker writes to Paprika only to save a recipe you asked it to (Save to Paprika, above). The
other write is a script run by hand: photos come from a recipe's full-size photo in Paprika when it
has one, otherwise Paprika's 280px thumbnail, and many web imports only ever gave Paprika a
thumbnail, which looks soft on the frame (and in Paprika). `dashboard/scripts/paprika-photos.mjs`,
run on a Mac, fixes that in Paprika itself: it finds the full photo on each recipe's source page,
writes a before-and-after page to look over, then uploads the ones you keep the way the Paprika app
does, saving each recipe first so `undo` can put it back. For sites that block scripts, find the
photo in a browser and give it to `use`. A recipe that came with another dish's photo (TheMealDB
has a few) takes `replace <uid> <image url>`, whatever its size. Run it with no arguments for its
commands.

## Groceries for the week

Meals → **Groceries for the week** makes one shopping list from the ingredients of every recipe
planned from today through the next six days. Meals typed in without a recipe are named so you know
they weren't counted. It leaves out pantry staples (oil, salt, pepper, flour, sugar and the common
dried spices; fresh herbs, ginger and garlic are bought, so they stay) and anything already on
Groceries. Nothing is added until you've looked: tap a row to leave it off, then **Add**. **Undo**
takes back exactly the items it just added.

The reading is done by an open-weight model on [Cloudflare Workers AI](https://developers.cloudflare.com/workers-ai/)
(Qwen3 30B, the `AI` binding in `wrangler.jsonc`), which turns each ingredient line into the thing to
buy, a quantity and a unit ("1 ½ cups halved grape tomatoes" → Grape tomato, 1.5, cup). Adding up is
done by the Worker, not the model (models asked to do the sums too repeat items and get the arithmetic
wrong): the same thing across recipes becomes one row, with like units added (½ cup + 4 tbsp → ¾ cup;
½ lemon + 1 lemon → 2 lemons, since you buy whole ones), citrus juice counted as fruit, and unlike
units listed together ("1 lb + 200 g"). Each answer echoes the start of its ingredient line and is
matched by that, so a model that loses count over a long list can't put a reading on the wrong line.
A week of recipes uses well under 1% of Workers AI's free daily allowance and takes about 10 seconds;
the result is kept for a day, so opening it again is instant until the plan, a recipe or the list
changes. Add your own staples with `PANTRY_STAPLES` (comma-separated, for example
`fish sauce, soy sauce`). The code is `dashboard/worker/meal-groceries.js`.
