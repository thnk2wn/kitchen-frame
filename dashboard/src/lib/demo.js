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
    return [
      { id: 'd1', content: 'Replace HVAC filters', due: due(-2), section: 'ds2', assignee: 'p1' },
      { id: 'd3', content: 'Sign field trip form', due: due(1), section: 'ds1', assignee: 'p2' },
      { id: 'd4', content: 'Clean gutters', due: due(5), section: 'ds2', assignee: 'p1' },
      { id: 'd5', content: 'Order birthday present', section: 'ds3', assignee: 'p2' },
      { id: 'd6', content: 'Renew car registration', section: 'ds3', assignee: 'p1' },
      { id: 'd7', content: 'Book fall photos' },
    ];
  }
  // Shaped by the demo meal plan below, as a real list fills from the week's recipes.
  const aisle = { Bananas: 'gs1', Limes: 'gs1', Avocados: 'gs1', Lemons: 'gs1', Milk: 'gs2', Eggs: 'gs2', Parmesan: 'gs2', Shrimp: 'gs4', Flounder: 'gs4', 'Coffee beans': 'gs3', Tortellini: 'gs3', 'Taco shells': 'gs3', Rice: 'gs3' };
  const forRecipe = { Shrimp: 'For: Blackened shrimp bowls', Avocados: 'For: Blackened shrimp bowls', Flounder: 'For: Garlic parmesan baked flounder', Parmesan: 'For: Garlic parmesan baked flounder', Tortellini: 'For: One-pot taco tortellini' };
  return ['Milk', 'Eggs', 'Bananas', 'Coffee beans', 'Shrimp', 'Avocados', 'Limes', 'Rice', 'Flounder', 'Parmesan', 'Lemons', 'Tortellini', 'Taco shells']
    .map((content, i) => ({ id: 'g' + i, content, ...(aisle[content] ? { section: aisle[content] } : {}), ...(forRecipe[content] ? { note: forRecipe[content] } : {}) }));
}

// Sections and people for the demo Tasks board.
export function demoMeta(name) {
  if (name !== 'todo') {
    return { project: 'Groceries', sections: [{ id: 'gs1', name: 'Produce' }, { id: 'gs4', name: 'Seafood' }, { id: 'gs2', name: 'Dairy & eggs' }, { id: 'gs3', name: 'Pantry' }], people: {} };
  }
  return {
    project: 'Household',
    sections: [{ id: 'ds1', name: 'This week' }, { id: 'ds2', name: 'Around the house' }, { id: 'ds3', name: 'Errands' }],
    people: { p1: 'Dad', p2: 'Mom' },
  };
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
export function demoMeals(now) {
  const day = (n) => dayKey(addDays(now, n));
  return [
    { date: day(0), type: 'Dinner', title: 'Blackened shrimp bowls' },
    { date: day(1), type: 'Dinner', title: 'One-pot taco tortellini' },
    { date: day(2), type: 'Dinner', title: 'Garlic parmesan baked flounder' },
    { date: day(3), type: 'Dinner', title: 'Leftovers' },
    { date: day(4), type: 'Breakfast', title: 'Blueberry pancakes' },
    { date: day(4), type: 'Dinner', title: 'Tacos' },
    { date: day(5), type: 'Dinner', title: 'Pizza and a movie' },
  ];
}
