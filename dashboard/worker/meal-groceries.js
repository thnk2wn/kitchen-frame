// Groceries for the week's meals: the ingredients of the Paprika meal plan's recipes (today and the
// next six days) as one shopping list, leaving out pantry staples and what's already on the Groceries
// list. The frame shows it to check over before anything is added.
//
//   GET /api/meals/groceries   { from, to, meals, unplanned, items: [{ name, amount, for }], model }
//
// An open-weight model on Workers AI reads each ingredient line ("1 1/2 cups coconut milk, shaken")
// into what you'd buy, how much and in what unit ({ name: "Coconut milk", qty: 1.5, unit: "cup" }).
// The merging and adding up happen here, not in the model: models asked to do the sums too repeat
// items and get the arithmetic wrong.
//
// Staples (oil, salt, pepper, dried spices…) are dropped twice: the model is told, and its answer is
// filtered here, so a slip can't put salt on the list. PANTRY_STAPLES adds more (comma-separated).
// A result is kept for a day per meal plan, recipe versions and list: opening the sheet again costs
// nothing, and any change to those asks again.
import { listMeals, loadSynced } from './paprika.js';

export const MODEL = '@cf/qwen/qwen3-30b-a3b-fp8';
const DAYS = 7;
const KEY = 'meal-groceries-2:'; // -2: lines read by the model, merged here
const CHUNK = 50; // ingredient lines per request

// Always in the cupboard. Fresh herbs, ginger and garlic are not: they're bought.
const STAPLES = [
  'salt', 'sea salt', 'kosher salt', 'table salt', 'pepper', 'black pepper', 'white pepper', 'salt and pepper', 'peppercorns',
  'oil', 'olive oil', 'extra virgin olive oil', 'vegetable oil', 'canola oil', 'sunflower oil', 'cooking oil', 'cooking spray', 'nonstick spray',
  'water', 'ice', 'sugar', 'granulated sugar', 'white sugar', 'flour', 'all purpose flour', 'plain flour',
  'baking soda', 'bicarbonate of soda', 'baking powder', 'cornstarch', 'cornflour',
  'paprika', 'smoked paprika', 'cumin', 'chili powder', 'chilli powder', 'cayenne', 'cayenne pepper',
  'garlic powder', 'onion powder', 'oregano', 'thyme', 'basil', 'dried basil', 'dried oregano', 'dried thyme',
  'cinnamon', 'nutmeg', 'ginger powder', 'turmeric', 'coriander', 'red pepper flakes', 'crushed red pepper flakes', 'flaky salt', 'ground pepper', 'chili flakes', 'chilli flakes', 'crushed red pepper',
  'bay leaf', 'bay leaves', 'italian seasoning', 'dried parsley', 'dried rosemary', 'dried sage', 'cloves', 'allspice',
  'curry powder', 'garam masala', 'mustard powder', 'dry mustard', 'vanilla', 'vanilla extract', 'cajun seasoning', 'taco seasoning',
];

const norm = (s) => String(s || '').toLowerCase().replace(/\([^)]*\)/g, ' ').replace(/[^a-z ]+/g, ' ').replace(/\s+/g, ' ').trim();
// One key for "Avocado" and "avocados", "Tomato" and "tomatoes".
const keyOf = (s) => norm(s).replace(/(oes|ies|s)$/, (m) => (m === 'ies' ? 'y' : m === 'oes' ? 'o' : ''));

export function staples(env = {}) {
  const extra = String(env.PANTRY_STAPLES || '').split(',').map(norm).filter(Boolean);
  return new Set([...STAPLES, ...extra]);
}

// A staple by name, as written or with a word like "ground" or "dried" in front.
export function isStaple(name, set) {
  const n = norm(name);
  const bare = n.replace(/^(fine|coarse|freshly ground|freshly cracked|ground|dried|light|some|a pinch of|pinch of)\s+/, '');
  return set.has(n) || set.has(bare) || set.has(bare.replace(/s$/, '')) || set.has(bare + 's');
}

// Already on the list: the same thing, ignoring amounts ("Milk (1 gal)" covers "milk").
export function onList(name, list) {
  const k = keyOf(name);
  return !!k && list.some((l) => keyOf(l) === k);
}

// ---- Amounts

// Units, each as [family, size in the family's base]: volume in teaspoons, weight in ounces or grams.
const UNITS = {
  tsp: ['vol', 1], teaspoon: ['vol', 1], tbsp: ['vol', 3], tablespoon: ['vol', 3], cup: ['vol', 48], c: ['vol', 48],
  'fl oz': ['vol', 6], pint: ['vol', 96], quart: ['vol', 192], ml: ['ml', 1], l: ['ml', 1000], litre: ['ml', 1000], liter: ['ml', 1000],
  oz: ['oz', 1], ounce: ['oz', 1], lb: ['oz', 16], pound: ['oz', 16], g: ['g', 1], gram: ['g', 1], kg: ['g', 1000],
};
const COUNTS = /^(counts?|whole|pieces?|each|items?|units?|small|medium|large|ripe|x)$/;
export function unitOf(u) {
  let s = String(u || '').toLowerCase().replace(/\./g, '').trim();
  let part = 1; // "quarter cup", "half teaspoon"
  const word = /^(quarter|half|third) (.+)$/.exec(s);
  if (word) { part = { quarter: 0.25, half: 0.5, third: 1 / 3 }[word[1]]; s = word[2]; }
  s = { lbs: 'lb', tbs: 'tbsp', t: 'tsp', pt: 'pint', pkg: 'package' }[s] || s;
  if (!s || COUNTS.test(s)) return ['count', part, ''];
  const k = UNITS[s] ? s : UNITS[s.replace(/e?s$/, '')] ? s.replace(/e?s$/, '') : null;
  if (k) return [UNITS[k][0], UNITS[k][1] * part, k];
  // Anything else that isn't a measure ("red", "chopped") counts whole things.
  if (!/^(cloves?|cans?|bunch(es)?|heads?|packages?|bags?|jars?|containers?|blocks?|stalks?|ears?|slices?|sprigs?|handfuls?|pinch(es)?|pints?|leaf|leaves|pods?|crowns?|wedges?|sticks?)$/.test(s)) return ['count', part, ''];
  const one = /^leaves$/.test(s) ? 'leaf' : /(ch|sh)es$/.test(s) ? s.slice(0, -2) : s.replace(/s$/, '');
  return ['other:' + one, part, s];
}

const FRACTIONS = [[0, ''], [0.25, '1/4'], [1 / 3, '1/3'], [0.5, '1/2'], [2 / 3, '2/3'], [0.75, '3/4'], [1, '']];
export function nice(n) {
  const whole = Math.floor(n + 1e-9), part = n - whole;
  const [f, s] = FRACTIONS.reduce((a, b) => (Math.abs(b[0] - part) < Math.abs(a[0] - part) ? b : a));
  const w = f === 1 ? whole + 1 : whole;
  return [w || (s ? '' : '0'), s].filter(Boolean).join(' ');
}
const plural = (n, word) => (n <= 1 || /s$/.test(word) ? word : word === 'leaf' ? 'leaves' : /(ch|sh)$/.test(word) ? word + 'es' : word + 's');

// One family's total, in the unit a shopper would use.
function show(family, total, other) {
  if (family === 'count') return String(Math.ceil(total - 1e-9)); // half a lemon is still a lemon to buy
  if (family === 'vol') return total >= 12 ? nice(total / 48) + ' ' + plural(total / 48, 'cup') : total >= 3 ? nice(total / 3) + ' tbsp' : nice(total) + ' tsp';
  if (family === 'oz') return total >= 16 ? nice(total / 16) + ' lb' : nice(total) + ' oz';
  if (family === 'g') return total >= 1000 ? +(total / 1000).toFixed(2) + ' kg' : Math.round(total) + ' g';
  if (family === 'ml') return total >= 1000 ? +(total / 1000).toFixed(2) + ' l' : Math.round(total) + ' ml';
  return nice(total) + ' ' + plural(total, other);
}

// Names the model doesn't always make one: the same thing to buy.
const SAME = { prawn: 'Shrimp', 'king prawn': 'Shrimp', scallion: 'Green onion', 'spring onion': 'Green onion', 'coriander leaf': 'Cilantro', 'fresh coriander': 'Cilantro' };
// Citrus juice or zest by volume -> whole fruit (teaspoons of juice per fruit).
const JUICE = { lime: 6, lemon: 9, orange: 16 };
export function tidy(l) {
  const same = SAME[keyOf(l.name)];
  if (same) return { ...l, name: same };
  const citrus = /^(lime|lemon|orange)s?(?: (juice|zest))?$/.exec(norm(l.name));
  if (!citrus) return l;
  if (!citrus[2] && unitOf(l.unit)[0] !== 'vol') return l; // whole lemons
  if (!citrus[2]) citrus[2] = 'juice';                      // "Lemon, 1/4 cup": its juice
  const fruit = citrus[1][0].toUpperCase() + citrus[1].slice(1);
  const [family, size] = unitOf(l.unit);
  const qty = family === 'vol' && citrus[2] === 'juice' ? (Number(l.qty) || 0) * size / JUICE[citrus[1]] : family === 'count' ? Number(l.qty) || 1 : 1;
  return { ...l, name: fruit, qty, unit: '' };
}

const HEADING = /^(for (the )?(serving|garnish|topping|sauce|dressing)|to serve|everything else|optional|garnish|toppings?)$/i;

// Lines read by the model -> the list: same thing summed, different units joined ("1 lb + 200 g").
export function merge(lines, set, list = []) {
  const items = new Map();
  for (const raw of lines) {
    const l = raw.name ? tidy(raw) : raw;
    if (!l.name || HEADING.test(l.name) || isStaple(l.name, set) || onList(l.name, list)) continue;
    const k = keyOf(l.name);
    if (!items.has(k)) items.set(k, { name: l.name, totals: new Map(), unknown: false, for: [] });
    const it = items.get(k);
    if (l.recipe && !it.for.includes(l.recipe)) it.for.push(l.recipe);
    const q = Number(l.qty);
    if (!(q > 0)) { it.unknown = true; continue; }
    const [family, size, label] = unitOf(l.unit);
    const t = it.totals.get(family) || { sum: 0, label };
    t.sum += q * size * (l.times || 1);
    it.totals.set(family, t);
  }
  return [...items.values()].map((it) => ({
    name: it.name,
    amount: [...it.totals].map(([f, t]) => show(f, t.sum, f.startsWith('other:') ? f.slice(6) : '')).join(' + '),
    for: it.for,
  }));
}

// ---- The model

// Its answer: JSON, sometimes in a code fence or after its thinking.
// Not always valid JSON: a bare fraction ("qty": 1/2) or a cut-off end. Fractions are made numbers,
// and when the whole still won't parse, each entry is read on its own.
export function parseLines(text) {
  const s = String(text || '').replace(/<think>[\s\S]*?<\/think>/g, '')
    .replace(/("qty"\s*:\s*)(\d+)\s+(\d+)\s*\/\s*(\d+)/g, (_, k, w, a, b) => k + (+w + a / b))
    .replace(/("qty"\s*:\s*)(\d+)\s*\/\s*(\d+)/g, (_, k, a, b) => k + a / b);
  let rows = null;
  const start = s.indexOf('{'), end = s.lastIndexOf('}');
  try { const d = JSON.parse(s.slice(start, end + 1)); rows = Array.isArray(d.lines) ? d.lines : null; } catch {}
  if (!rows) rows = [...s.matchAll(/\{[^{}]*"n"[^{}]*\}/g)].map((m) => { try { return JSON.parse(m[0]); } catch { return null; } }).filter(Boolean);
  return rows.map((x) => ({
    n: Number(x.n), src: String(x.src || ''), name: String(x.name || '').trim().slice(0, 60), qty: Number(x.qty) || 0, unit: String(x.unit || '').trim().slice(0, 20),
  })).filter((x) => x.n > 0);
}

// Each reading to its line by the words it echoes ("src"), not only its number: models lose count
// over a long list and every reading after a skipped line lands on the wrong ingredient.
// Word by word, on their first four letters: the echo tidies as it copies ("2 teaspoon garlic" for
// "2 teaspoons garlic powder", "2 large chicken" for "3 large chicken"). With three words or more,
// one may differ.
const words = (s) => String(s || '').toLowerCase().split(/[^\p{L}]+/u).filter(Boolean).map((w) => w.slice(0, 4));
export function echoes(src, text) {
  const a = words(src).slice(0, 4), b = words(text);
  if (!a.length) return false;
  const same = a.filter((w, i) => b[i] === w).length;
  return same >= (a.length >= 3 ? a.length - 1 : a.length);
}
export function align(lines, got) {
  const byN = new Map(lines.map((l) => [l.n, l]));
  const out = new Map();
  for (const x of got) {
    const fits = (l) => l && !out.has(l.n) && (words(x.src).length ? echoes(x.src, l.text) : !x.name);
    // Lines that start alike ("1 tablespoon minced ginger", "1 tablespoon minced garlic"): the one
    // that names it, else the nearest.
    const named = (l) => words(x.name).some((w) => w.length > 2 && words(l.text).includes(w));
    const near = [0, ...Array.from({ length: 12 }, (_, i) => [-(i + 1), i + 1]).flat()].map((d) => byN.get(x.n + d)).filter(fits);
    const l = near.find(named) || near[0];
    if (l) out.set(l.n, { ...x, n: l.n });
  }
  return out;
}

export function prompt(lines, set) {
  return [
    { role: 'system', content: 'You read recipe ingredient lines for a grocery list. Answer with JSON only, no explanation: {"lines":[{"n":1,"src":"first three words","name":"...","qty":1.5,"unit":"cup"}]}, one entry for every line, in order. /no_think' },
    { role: 'user', content: [
      'For each numbered ingredient line, give:',
      '- n: its number, and src: its first three words exactly as written.',
      '- name: the thing to buy, in sentence case, singular, no prep words, sizes or brands. Use the same name for the same thing every time: "2 large avocados, diced" and "1 ripe avocado" are both "Avocado"; shrimp and prawns are both "Shrimp"; "fish such as cod or halibut" is "White fish". Fresh herbs keep "fresh" off: "Cilantro".',
      '- Juice or zest of a citrus fruit: name the fruit and give the number of fruit (1 lime gives about 2 tbsp juice; 1 lemon about 3 tbsp).',
      '- qty: a number (1/2 is 0.5; for a range like "4 to 5" use the larger). 0 when the line gives no amount.',
      '- unit: tsp, tbsp, cup, oz, lb, g, kg, ml, l, clove, can, bunch, head or package, or "" for a count of whole things.',
      '- Things to serve with it count ("cooked rice, for serving" is "Rice"); optional ones too.',
      '- name "" for headings that name a part of the recipe rather than a thing to buy ("Avocado slaw", "BBQ jackfruit", "For serving", "Dressing:").',
      '- name "" for water, staples we always have (' + [...set].join(', ') + '), and lines that are not a thing to buy (headings, "for the sauce:").',
      '',
      ...lines.map((l) => l.n + '. ' + l.text),
    ].join('\n') },
  ];
}

async function hash(s) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(b)].slice(0, 12).map((x) => x.toString(16).padStart(2, '0')).join('');
}

// recipes: [{ title, times, ingredients: [line] }] -> merged items. Exported for trying models.
export async function readRecipes(env, model, recipes, set, list) {
  const lines = recipes.flatMap((r) => r.ingredients.map((text) => ({ text, recipe: r.title, times: r.times || 1 }))).slice(0, 200).map((l, i) => ({ ...l, n: i + 1 }));
  // In chunks, read at once: quicker, and one bad answer (asked again once) costs only its chunk.
  // Each chunk numbered from 1 (models restart the count anyway), then lined up with its own lines.
  const ask = async (chunk) => {
    const local = chunk.map((l, i) => ({ ...l, n: i + 1 }));
    for (let tries = 0; tries < 2; tries++) {
      const res = await env.AI.run(model, { messages: prompt(local, set), max_tokens: 4000, temperature: 0.1 });
      const text = typeof res === 'string' ? res : res?.response ?? res?.choices?.[0]?.message?.content ?? '';
      const got = [...align(local, parseLines(typeof text === 'string' ? text : JSON.stringify(text))).values()];
      if (got.length) return { got: got.map((x) => ({ ...x, n: chunk[x.n - 1].n })), neurons: res?.usage?.neurons || 0 };
    }
    return { got: [], neurons: 0 };
  };
  const chunks = [];
  for (let i = 0; i < lines.length; i += CHUNK) chunks.push(lines.slice(i, i + CHUNK));
  const answers = await Promise.all(chunks.map(ask));
  const read = new Map(answers.flatMap((a) => a.got).map((x) => [x.n, x]));
  const res = { usage: { neurons: answers.reduce((n, a) => n + a.neurons, 0) } };
  const merged = merge(lines.map((l) => ({ ...read.get(l.n), recipe: l.recipe, times: l.times })).filter((l) => l.name), set, list);
  return { items: merged, read: read.size, of: lines.length, usage: res?.usage, lines: lines.map((l) => ({ text: l.text, ...read.get(l.n) })) };
}

// listNames: what's on the Groceries list now (contents).
export async function mealGroceries(env, listNames, { today, model = MODEL } = {}) {
  if (!env.AI) return { error: 'Workers AI is not set up (the AI binding)' };
  const day = (n) => { const d = new Date(today + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const from = today, to = day(DAYS - 1);
  const [{ meals }, data] = await Promise.all([listMeals(env), loadSynced(env)]);
  const week = (meals || []).filter((m) => m.date >= from && m.date <= to);
  const byUid = new Map((data.recipes || []).filter((r) => !r.trashed).map((r) => [r.uid, r]));
  const recipes = new Map(), unplanned = [];
  for (const m of week) {
    const r = m.id && byUid.get(String(m.id).replace(/^pap:/, ''));
    if (!r || !(r.ingredients || []).length) { unplanned.push(m.title); continue; }
    const had = recipes.get(r.uid);
    if (had) had.times++;
    else recipes.set(r.uid, { title: r.title, hash: r.hash || '', times: 1, ingredients: r.ingredients.map((i) => i.name).filter(Boolean).slice(0, 60) });
  }
  const list = [...new Set(listNames.map((s) => String(s || '').trim()).filter(Boolean))].slice(0, 300);
  const set = staples(env);
  const base = { from, to, meals: [...recipes.values()].map((r) => r.title), unplanned: [...new Set(unplanned)], model };
  if (!recipes.size) return { ...base, items: [] };

  const key = KEY + await hash(JSON.stringify([model, [...recipes.values()].map((r) => [r.title, r.hash, r.times]), list, [...set]]));
  const kept = await env.CALENDAR.get(key, 'json');
  if (kept) return { ...base, items: kept.items, cached: true };

  const { items, read, of } = await readRecipes(env, model, [...recipes.values()], set, list);
  if (!read) return { ...base, items: [], error: 'The model gave no answer; try again' };
  if (read < of) console.warn({ source: 'worker', message: 'meal groceries: read ' + read + ' of ' + of + ' lines' });
  await env.CALENDAR.put(key, JSON.stringify({ items }), { expirationTtl: 86400 });
  return { ...base, items };
}
