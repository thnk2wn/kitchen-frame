// Sample data for Demo mode (Settings), so the frame can be shown to people without real
// calendars, tasks or photos. Everything is invented and built relative to today.
import { addDays, dayKey } from './format.js';

export function demoCalendar(now) {
  const at = (days, h, m = 0) => { const d = addDays(now, days); d.setHours(h, m, 0, 0); return d.toISOString(); };
  const date = (days) => dayKey(addDays(now, days));
  const sat = (6 - now.getDay() + 7) % 7; // days to Saturday, for game days
  const ev = (uid, cal, title, start, end, extra = {}) => ({ uid: 'demo-' + uid, cal, title, start, end, allDay: false, ...extra });
  const allDay = (uid, cal, title, from, days) => ({ uid: 'demo-' + uid, cal, title, start: date(from), end: date(from + days), allDay: true });
  // Four calendars, as a family might subscribe: one person's, the shared family one, work, and a team.
  const [DAD, FAMILY, WORK, GAMES] = [0, 1, 2, 3];
  const events = [
    ev('checkin', WORK, 'Team check-in', at(0, 11), at(0, 11, 30), { location: 'Video call' }),
    ev('callmom', FAMILY, 'Call Mom', at(0, 12, 30), at(0, 13)),
    ev('swim', FAMILY, 'Swim lesson', at(0, 16), at(0, 16, 45), { location: 'Aquatic center' }),
    ev('trash', FAMILY, 'Take recycling ♻️ and trash 🗑️ out', at(0, 20, 30), at(0, 20, 45)),
    ev('allergy', DAD, 'Allergy shot', at(1, 8, 30), at(1, 9), { location: 'Allergy & Asthma Clinic' }),
    ev('dentist', FAMILY, 'Dentist', at(1, 14), at(1, 15)),
    ev('haircut', FAMILY, 'Haircut', at(1, 15, 45), at(1, 16, 30)),
    ev('date', FAMILY, 'Date night ❤️', at(2, 18, 30), at(2, 21, 30)),
    ev('review', WORK, 'Quarterly business review', at(2, 14), at(2, 15), { location: 'Video call' }),
    ev('yard', FAMILY, 'Yard waste to curb', at(3, 21), at(3, 21, 15)),
    allDay('grandparents', FAMILY, 'Grandparents visiting', 4, 3),
    ev('filter', DAD, 'Change fridge water filter', at(6, 9), at(6, 9, 15)),
    ev('fair', FAMILY, 'State fair!', at(8, 13), at(8, 18)),
    allDay('free', DAD, 'Free Friday, no work', 9, 1),
    ev('checkup', FAMILY, 'Doctor: annual checkup', at(10, 12), at(10, 13)),
    allDay('mortgage', FAMILY, 'Bill: mortgage due', 12, 1),
    allDay('hoa', FAMILY, 'Bill: HOA', 17, 1),
    ev('game1', GAMES, 'Tennessee vs Alabama', at(sat, 15, 30), at(sat, 19), { location: 'Neyland Stadium, Knoxville' }),
    ev('game2', GAMES, 'Tennessee at South Carolina', at(sat + 7, 19, 30), at(sat + 7, 23), { location: 'Williams-Brice Stadium, Columbia' }),
  ];
  events.sort((a, b) => (a.allDay ? Date.parse(a.start + 'T00:00') : Date.parse(a.start)) - (b.allDay ? Date.parse(b.start + 'T00:00') : Date.parse(b.start)));
  return { updated: now.toISOString(), calendars: 4, names: ['Dad', 'Family', 'Work', 'Tennessee Football'],
    colors: ['brown', 'yellow', 'blue', 'orange'], details: [true, true, false, true], errors: [], events, demo: true,
    // Notes for the calendars that open (not Work's), as the Worker sends them: by event uid.
    notes: {
      'demo-swim': 'Level 3, lesson 5 of 8.\nBring goggles, a towel and a snack for after.',
      'demo-dentist': 'Cleanings for both kids.\nArrive 10 minutes early to update insurance.',
      'demo-grandparents': 'Flight lands at 6:10 PM.\nGuest room: fresh sheets, clear the desk.',
      'demo-fair': 'Tickets are on the fridge. Parking at the east gate.\nRides close at 10.',
      'demo-game1': 'TV: CBS\nRadio: Vol Network',
      'demo-game2': 'TV: ESPN\nRadio: Vol Network',
      'demo-allergy': 'Wait 30 minutes after the shot.',
    } };
}

export function demoList(name, now) {
  const due = (days) => dayKey(addDays(now, days));
  if (name === 'todo') {
    // Shaped like a shared Apple Reminders list through the Mac: priorities and due times, no
    // sections or assignees (EventKit doesn't share them). Dated first, as the bridge sends them.
    return [
      { id: 'd1', content: 'Replace HVAC filters', due: due(-2), priority: 2 },
      { id: 'd3', content: 'Sign field trip form', due: due(1), time: '08:00', priority: 3 },
      { id: 'd4', content: 'Clean gutters', due: due(5) },
      { id: 'd5', content: 'Order birthday present', priority: 1 },
      { id: 'd6', content: 'Renew car registration' },
      { id: 'd7', content: 'Book fall photos' },
    ];
  }
  // Shaped by the demo meal plan below, as a real list fills from the week's recipes. Aisles as the
  // Reminders grocery template sorts them (with REMINDERS_EXTRAS); a couple left in "Others".
  const aisle = { Bananas: 'Produce', Limes: 'Produce', Avocados: 'Produce', Lemons: 'Produce', Milk: 'Dairy, Eggs & Cheese', Eggs: 'Dairy, Eggs & Cheese', Parmesan: 'Dairy, Eggs & Cheese', Shrimp: 'Meat & Seafood', Flounder: 'Meat & Seafood', Rice: 'Pasta, Rice & Beans', Tortellini: 'Pasta, Rice & Beans', 'Coffee beans': 'Coffee & Tea' };
  const forRecipe = { Shrimp: 'For: Blackened shrimp bowls', Avocados: 'For: Blackened shrimp bowls', Flounder: 'For: Garlic parmesan baked flounder', Parmesan: 'For: Garlic parmesan baked flounder', Tortellini: 'For: One-pot taco tortellini' };
  return ['Milk', 'Eggs', 'Bananas', 'Coffee beans', 'Shrimp', 'Avocados', 'Limes', 'Rice', 'Flounder', 'Parmesan', 'Lemons', 'Tortellini', 'Taco shells']
    .map((content, i) => ({ id: 'g' + i, content, ...(aisle[content] ? { section: aisle[content] } : {}), ...(forRecipe[content] ? { note: forRecipe[content] } : {}) }));
}

// Demo lists come from Apple Reminders: aisles for Groceries, in the template's order; no sections
// or people for Tasks.
export function demoMeta(name) {
  if (name === 'todo') return { project: 'Household', sections: [], people: {} };
  const aisles = ['Produce', 'Dairy, Eggs & Cheese', 'Meat & Seafood', 'Pasta, Rice & Beans', 'Coffee & Tea'];
  return { project: 'Groceries', sections: aisles.map((a) => ({ id: a, name: a })), people: {} };
}

// Demo House tab: an invented home, shaped like a mirrored HA dashboard. Taps change it locally.
export function demoHouse() {
  const s = (state, attributes = {}) => ({ state, attributes });
  return {
    title: 'Home',
    header: '## ☀️ Sunny 72°F · 🏠 70.5°F\n\n## 🔒 Locked · 🚪 All closed\n\n## 📍 Dad: Home · Mom: Away',
    groups: [
      { title: 'Key Devices', items: [
        { kind: 'climate', entity: 'climate.downstairs' }, { kind: 'climate', entity: 'climate.upstairs' },
        { kind: 'toggle', entity: 'light.kitchen' }, { kind: 'toggle', entity: 'light.porch' },
        { kind: 'toggle', entity: 'fan.bedroom' }, { kind: 'lock', entity: 'lock.front_door' },
        { kind: 'cover', entity: 'cover.garage_door' }, { kind: 'value', entity: 'sensor.garage_freezer_temperature' },
      ] },
      { title: 'Cameras', items: [{ kind: 'camera', entity: 'camera.front_door' }, { kind: 'camera', entity: 'camera.driveway' }] },
      { title: 'Laundry', items: [{ kind: 'text', key: 'laundry' }] },
    ],
    text: { laundry: '## 🧺 Dryer running\nAbout **18 min** left · started 7:42 PM' },
    states: {
      'climate.downstairs': s('heat_cool', { friendly_name: 'Downstairs', current_temperature: 71, target_temp_low: 68, target_temp_high: 74, hvac_action: 'heating' }),
      'climate.upstairs': s('heat_cool', { friendly_name: 'Upstairs', current_temperature: 72, target_temp_low: 70, target_temp_high: 75, hvac_action: 'idle' }),
      'light.kitchen': s('on', { friendly_name: 'Kitchen lights', brightness: 204 }),
      'light.porch': s('off', { friendly_name: 'Porch light' }),
      'fan.bedroom': s('off', { friendly_name: 'Bedroom fan' }),
      'lock.front_door': s('locked', { friendly_name: 'Front door' }),
      'cover.garage_door': s('closed', { friendly_name: 'Garage door', device_class: 'garage' }),
      'sensor.garage_freezer_temperature': s('18.2', { friendly_name: 'Garage freezer', unit_of_measurement: '°F', device_class: 'temperature' }),
      'camera.front_door': s('idle', { friendly_name: 'Front Door' }),
      'camera.driveway': s('idle', { friendly_name: 'Driveway' }),
    },
  };
}

// Demo meal plan: an invented week (text-only entries, so no recipe pages or photos).
// Demo mode's meal plan: real recipes from the Paprika library (its Paprika tab shows them in demo
// mode too), picked by date, so a day keeps its dish and the frame and Alexa (worker/alexa.js) agree.
// Breakfasts and dinners by Paprika category (or name). Without a library: TheMealDB dishes, which
// open in Explore.
const hash = (s) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
const isBreakfast = (r) => /breakfast|brunch/i.test((r.categories || []).join(' ')) || /pancake|waffle|french toast|muffin|omelet|frittata|granola|oatmeal|scone/i.test(r.title);
const isDinner = (r) => /dinner|main|entr[eé]e|supper/i.test((r.categories || []).join(' '))
  || !/dessert|cookie|cake|brownie|bar|frosting|sauce|dressing|drink|smoothie|cocktail|bread|side|snack|dip/i.test((r.categories || []).join(' ') + ' ' + r.title);
export function demoMeals(now, recipes) {
  const day = (n) => dayKey(addDays(now, n));
  const pool = (recipes || []).filter((r) => r && r.id && r.hasImage).sort((a, b) => (a.id < b.id ? -1 : 1));
  const breakfasts = pool.filter(isBreakfast);
  const dinners = pool.filter((r) => !isBreakfast(r) && isDinner(r));
  if (dinners.length >= 6) {
    const pick = (list, key) => { const r = list[hash(key) % list.length]; return { title: r.title, id: r.id, hasImage: true }; };
    const out = [];
    for (let n = 0; n < 7; n++) {
      const d = day(n);
      if (n === 3) { out.push({ date: d, type: 'Dinner', title: 'Leftovers' }); continue; }
      if (n === 4 && breakfasts.length) out.push({ date: d, type: 'Breakfast', ...pick(breakfasts, d + 'b') });
      out.push({ date: d, type: 'Dinner', ...pick(dinners, d) });
    }
    return out;
  }
  const mdb = (id, file) => ({ id: 'mdb:' + id, thumb: 'https://www.themealdb.com/images/media/meals/' + file + '/small' });
  return [
    { date: day(0), type: 'Dinner', title: 'Cajun spiced fish tacos', ...mdb(52819, 'uvuyxu1503067369.jpg') },
    { date: day(1), type: 'Dinner', title: 'Shrimp chow fun', ...mdb(52953, '1529445434.jpg') },
    { date: day(2), type: 'Dinner', title: 'Fish pie', ...mdb(52802, 'ysxwuq1487323065.jpg') },
    { date: day(3), type: 'Dinner', title: 'Leftovers' },
    { date: day(4), type: 'Breakfast', title: 'Pancakes', ...mdb(52854, 'rwuyqx1511383174.jpg') },
    { date: day(4), type: 'Dinner', title: 'Crock pot chicken baked tacos', ...mdb(52830, 'ypxvwv1505333929.jpg') },
    { date: day(5), type: 'Dinner', title: 'Margherita pizza', ...mdb(53014, 'x0lk931587671540.jpg') },
  ];
}
