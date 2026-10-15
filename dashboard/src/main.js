import { mount } from 'svelte';
import App from './App.svelte';
import { startDiag } from './diag.js';
import { startCheckIn } from './lib/checkin.js';

const target = document.getElementById('app');
target.textContent = ''; // drop the 'Starting…' placeholder
mount(App, { target });
startDiag();
startCheckIn(); // the kiosk reports its version and backs up its settings (lib/checkin.js)
window.__booted = true;
