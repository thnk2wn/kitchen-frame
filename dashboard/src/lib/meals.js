// A day's planned meals as Home shows them: one row per meal type (Dinner, Lunch…), in the plan's
// order. The row's dish is the first one that's a recipe in the library (so it opens), else the
// first; the rest join it on the line when they're plain typed items that fit ("Tacos + side
// salad"), or are counted ("+1 more", which opens Meals). The plan doesn't say which dish is the
// main one; the first recipe is the usual case, and a side planned as a recipe of its own still
// shows as "+1 more".
export const JOIN_MAX = 48; // characters the joined line may run to

export function mealRows(meals) {
  const byType = new Map();
  for (const m of meals) {
    if (!byType.has(m.type)) byType.set(m.type, []);
    byType.get(m.type).push(m);
  }
  return [...byType.entries()].map(([type, all]) => {
    const main = all.find((m) => m.id) || all[0];
    const rest = all.filter((m) => m !== main);
    // "And a side salad" reads as "+ a side salad" once it's joined.
    const joined = [main.title, ...rest.map((m) => m.title.replace(/^(and|&|with|w\/?)\s+/i, ''))].join(' + ');
    if (rest.length && rest.every((m) => !m.id) && joined.length <= JOIN_MAX) return { type, main, title: joined, more: 0 };
    return { type, main, title: main.title, more: rest.length };
  });
}
