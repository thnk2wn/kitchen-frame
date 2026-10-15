import { mount } from 'svelte';
import App from './App.svelte';
import { startDiag } from './diag.js';
import { startCheckIn } from './lib/checkin.js';
import { startReminders } from './lib/reminders.svelte.js';
import { startAlerts } from './lib/alerts.svelte.js';
import { startObserving } from './lib/observe.svelte.js';

const target = document.getElementById('app');
target.textContent = ''; // drop the 'Starting…' placeholder
mount(App, { target });
startDiag();
startCheckIn(); // the kiosk reports its version and backs up its settings (lib/checkin.js)
startReminders(); // event reminders said out loud (Settings → Announcements)
startAlerts(); // red (and optionally orange) Home Assistant alerts said out loud
startObserving(); // connection, night and clock-screen changes to the event log (lib/log.svelte.js)
window.__booted = true;
