// YouTube's IFrame player script, loaded once: when Media → Videos opens, so a tap on a video starts
// it without waiting for the script (it took ~3.5 s on the frame).
import { mediaUrl } from './api.js';

let ready = null;
export function loadYouTube() {
  if (window.YT && window.YT.Player) return Promise.resolve(window.YT);
  if (ready) return ready;
  ready = new Promise((done, fail) => {
    window.onYouTubeIframeAPIReady = () => done(window.YT);
    const s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api';
    s.onerror = () => { ready = null; fail(new Error('YouTube player script')); };
    document.head.append(s);
  });
  return ready;
}

export const thumb = (id) => mediaUrl('/api/youtube/thumb/' + id);
