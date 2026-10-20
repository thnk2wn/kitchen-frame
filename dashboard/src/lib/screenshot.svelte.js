// The phone app's Screenshot (worker/screenshot.js): the Worker sends the "screenshot" command and the
// kiosk app (1.7+) captures the screen as root and uploads it to the Worker itself; the page only
// hands it the dashboard key. A browser showing the dashboard ignores the command (it isn't the
// frame). Afterwards the frame says so for a few seconds (ShotNote.svelte), so whoever is in the
// kitchen knows; it appears after the capture, so it's never in the picture.
import { api } from './api.js';
import { log } from './log.svelte.js';

export const shot = $state({ note: '' });
let noteTimer;
function note(text) {
  shot.note = text;
  clearTimeout(noteTimer);
  noteTimer = setTimeout(() => (shot.note = ''), 4000);
}

const report = (error) => api('/api/frame/screenshot/error', { method: 'POST', body: JSON.stringify({ error }) }).catch(() => {});

if (typeof window !== 'undefined') {
  window.frameShotDone = (ok, why) => {
    log('screenshot', ok ? {} : { error: why }, ok ? 'info' : 'error');
    if (ok) note('Screenshot sent to a phone');
    else report(why || 'The frame couldn’t take it');
  };
  window.addEventListener('frame-command', (e) => {
    if (e.detail !== 'screenshot') return;
    const k = window.FrameKiosk;
    if (!k) return;
    if (!k.captureTo) return report('The frame’s kiosk app is too old for screenshots (it needs 1.7)');
    // A moment for a tab asked for with it ("show") to draw.
    setTimeout(() => k.captureTo('Bearer ' + (localStorage.getItem('frame-key') || '')), 1000);
  });
}
