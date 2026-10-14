// Grocery and to-do lists from Todoist (API v1), proxied so the token never reaches the frame.
// Secret: TODOIST_TOKEN (Todoist → Settings → Integrations → Developer → API token).
// Vars: TODOIST_GROCERY_PROJECT, TODOIST_TODO_PROJECT (project names, default "Groceries" / "To-do").
const API = 'https://api.todoist.com/api/v1';
export const LISTS = { groceries: 'TODOIST_GROCERY_PROJECT', todo: 'TODOIST_TODO_PROJECT' };
const DEFAULT_NAMES = { groceries: 'Groceries', todo: 'To-do' };

let projectIds = null;   // name (lowercase) -> id, cached per isolate
let listing = null;      // the /projects request in flight, shared by concurrent callers
const META_MS = 10 * 60 * 1000;
const metaCache = new Map(); // project id -> { at, sections, people }: they change rarely, tasks often

async function call(env, path, init = {}) {
  const res = await fetch(API + path, {
    ...init,
    headers: { Authorization: 'Bearer ' + env.TODOIST_TOKEN, 'Content-Type': 'application/json', ...init.headers },
  });
  if (!res.ok) throw new Error('Todoist HTTP ' + res.status);
  return res.status === 204 ? null : res.json();
}

async function paged(env, path) {
  const out = [];
  let cursor = null;
  do {
    const sep = path.includes('?') ? '&' : '?';
    const page = await call(env, path + sep + 'limit=200' + (cursor ? '&cursor=' + encodeURIComponent(cursor) : ''));
    out.push(...page.results);
    cursor = page.next_cursor;
  } while (cursor && out.length < 1000);
  return out;
}

async function projectId(env, list) {
  const name = (env[LISTS[list]] || DEFAULT_NAMES[list]).toLowerCase();
  if (!projectIds || !projectIds.has(name)) {
    listing ||= paged(env, '/projects')
      .then((ps) => { projectIds = new Map(ps.map((p) => [p.name.toLowerCase(), p.id])); })
      .finally(() => { listing = null; });
    await listing;
  }
  const id = projectIds.get(name);
  if (!id) throw new Error('No Todoist project named "' + (env[LISTS[list]] || DEFAULT_NAMES[list]) + '"');
  return id;
}

// Tasks plus the project's sections (in Todoist order) and, for shared projects, who's on it, so
// the frame can draw a board and show assignees.
export async function getList(env, list) {
  const pid = encodeURIComponent(await projectId(env, list));
  const [tasks, meta] = await Promise.all([paged(env, '/tasks?project_id=' + pid), projectMeta(env, pid)]);
  return {
    project: env[LISTS[list]] || DEFAULT_NAMES[list],
    items: sortTasks(tasks, list),
    ...meta,
    updated: new Date().toISOString(),
  };
}

// Sections and collaborators, cached per isolate for META_MS (the frame polls tasks every minute).
async function projectMeta(env, pid) {
  const hit = metaCache.get(pid);
  if (hit && Date.now() - hit.at < META_MS) return hit.meta;
  const [sections, people] = await Promise.all([
    paged(env, '/sections?project_id=' + pid).catch(() => []),
    paged(env, '/projects/' + pid + '/collaborators').catch(() => []), // only shared projects have any
  ]);
  const meta = {
    sections: sections.sort((a, b) => (a.section_order ?? 0) - (b.section_order ?? 0)).map((x) => ({ id: x.id, name: x.name })),
    people: Object.fromEntries(people.map((c) => [String(c.id), c.name || c.email || 'Someone'])),
  };
  metaCache.set(pid, { at: Date.now(), meta });
  return meta;
}


// Groceries keep Todoist's own order. To-dos put dated items first (overdue at the top), and
// within a day untimed ones, then by time.
export function sortTasks(tasks, list) {
  const when = (t) => (t.due?.date ? t.due.date.slice(0, 10) + (dueTime(t) || '') : '9999');
  return tasks
    .filter((t) => !t.parent_id && !t.checked)
    .sort((a, b) => {
      if (list === 'todo') {
        const da = when(a), db = when(b);
        if (da !== db) return da < db ? -1 : 1;
      }
      return (a.child_order ?? 0) - (b.child_order ?? 0);
    })
    .map((t) => ({
      id: t.id,
      content: t.content,
      ...(t.due?.date ? { due: t.due.date.slice(0, 10) } : {}),
      ...(dueTime(t) ? { time: dueTime(t) } : {}),
      // Todoist's API counts up (4 is p1, the highest; 1 is none); the frame uses 3 high, 2, 1 low.
      ...(t.priority > 1 ? { priority: Math.min(3, t.priority - 1) } : {}),
      ...(t.section_id ? { section: t.section_id } : {}),
      ...(t.responsible_uid ? { assignee: String(t.responsible_uid) } : {}),
      ...(note(t.description) ? { note: note(t.description) } : {}),
    }));
}

// A timed task's time: "16:30" for a floating time (Todoist's default), or the full UTC time when
// the task has a fixed time zone, which the frame shows in its own.
function dueTime(t) {
  const dt = t.due?.datetime;
  if (!dt || dt.length < 16) return '';
  return /Z|[+-]\d\d:?\d\d$/.test(dt.slice(19)) ? dt : dt.slice(11, 16);
}

// The description's first line, kept short, as a small note under the item (e.g. "For: Beef Mandi").
function note(description) {
  const line = String(description || '').split('\n').map((l) => l.trim()).find(Boolean) || '';
  return line.length > 120 ? line.slice(0, 119) + '…' : line;
}

// description is Todoist's note under the task (e.g. "For: Chicken Fried Rice"); priority is the
// frame's 1 (low) to 3 (high).
export async function addItem(env, list, content, description, priority = 0) {
  const t = await call(env, '/tasks', {
    method: 'POST',
    body: JSON.stringify({ content, project_id: await projectId(env, list), ...(description ? { description } : {}), ...(priority ? { priority: priority + 1 } : {}) }),
  });
  return { id: t.id, content: t.content, ...(priority ? { priority } : {}) };
}

// changes: { content?, priority? } (priority 0 clears it).
export async function updateItem(env, id, changes) {
  const body = {};
  if (changes.content) body.content = changes.content;
  if (changes.priority !== undefined) body.priority = changes.priority + 1;
  await call(env, '/tasks/' + encodeURIComponent(id), { method: 'POST', body: JSON.stringify(body) });
  return { ok: true };
}

export async function completeItem(env, id) {
  await call(env, '/tasks/' + encodeURIComponent(id) + '/close', { method: 'POST' });
  return { ok: true };
}
