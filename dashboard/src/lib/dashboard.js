// Pure helpers for the House tab (no Svelte state), so they run under `node --test` too.

// Collect the cards we can show from a dashboard config into groups. Exported for tests.
export function parseDashboard(config) {
  const view = (config && config.views && config.views[0]) || {};
  const groups = [];
  const templates = {};
  let n = 0;
  const add = (title) => { const g = { title: title || '', items: [] }; groups.push(g); return g; };
  const take = (cards, group) => {
    for (const c of cards || []) {
      if (!c || typeof c !== 'object') continue;
      const entity = typeof c.entity === 'string' ? c.entity : null;
      const name = typeof c.name === 'string' ? c.name : undefined;
      if (c.type === 'heading') { group = add(c.heading); continue; }
      if (c.type === 'thermostat' && entity) group.items.push({ kind: 'climate', entity, name });
      else if (['tile', 'entity', 'button'].includes(c.type) && entity) group.items.push({ kind: kindOf(entity), entity, name });
      else if (c.type === 'entities') for (const e of c.entities || []) { const id = typeof e === 'string' ? e : e && e.entity; if (id) group.items.push({ kind: kindOf(id), entity: id }); }
      else if ((c.type === 'picture-entity' || c.type === 'picture-glance') && (c.camera_image || entity || '').startsWith('camera.')) group.items.push({ kind: 'camera', entity: c.camera_image || entity });
      else if (c.type === 'markdown' && typeof c.content === 'string') { const key = 't' + n++; templates[key] = c.content; group.items.push({ kind: 'text', key }); }
      else if (c.cards) take(c.cards, group); // stacks and grids: their cards, in order
    }
    return group;
  };
  for (const section of view.sections || []) take(section.cards, add(''));
  if (view.cards) take(view.cards, add(''));
  let header = null;
  const hc = view.header && view.header.card;
  if (hc && hc.type === 'markdown' && typeof hc.content === 'string') { header = 'header'; templates.header = hc.content; }
  return { title: view.title || '', header, groups: groups.filter((g) => g.items.length), templates };
}

export function kindOf(entity) {
  const d = entity.split('.')[0];
  if (d === 'climate') return 'climate';
  if (d === 'camera') return 'camera';
  if (d === 'lock') return 'lock';
  if (d === 'cover') return 'cover';
  if (['light', 'switch', 'fan', 'input_boolean', 'automation'].includes(d)) return 'toggle';
  if (d === 'scene' || d === 'script') return 'run';
  return 'value';
}

// Just enough Markdown for dashboard text: headings, **bold**, line breaks. HTML is escaped first.
export function miniMarkdown(md) {
  const esc = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const inline = (t) => esc(t.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/(^|\s)_(.+?)_(?=\s|$)/g, '$1<i>$2</i>');
  // A line that is only a link (e.g. "[Open Laundry →](/dashboard-laundry)") leads nowhere on a frame.
  const linkOnly = /^\[[^\]]*\]\([^)]*\)$/;
  return String(md || '').split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !linkOnly.test(l)).map((l) => {
    const h = /^(#{1,6})\s+(.*)$/.exec(l);
    if (h) return '<p class="h">' + inline(h[2]) + '</p>';
    return '<p>' + inline(l.replace(/^[-*]\s+/, '• ')) + '</p>';
  }).join('');
}
