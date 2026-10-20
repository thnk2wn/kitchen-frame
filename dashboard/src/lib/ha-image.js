// Pictures from Home Assistant (camera snapshots, album art) on the https dashboard. Home Assistant is
// plain http on the home network, and WebView 138 blocks http images on an https page outright (106
// let the kiosk's "allow mixed content" through). A fetch() to it is still allowed, so the picture is
// fetched and shown from a blob URL. Needs the dashboard's origin in Home Assistant's CORS allowed
// origins (Settings → System → Network; docs/house.md). Anything https, or on an http page (the dev
// server), loads directly as before.
//
//   <img {@attach haImage(url)} onload={…} onerror={…} />
//
// load and error fire on the <img> as they would with src, so its handlers keep working. Without the
// CORS origin the fetch fails and the <img> gets the address directly: fine on WebView 106, an error on
// 138.
export function haImage(url) {
  return (img) => {
    if (!url) { img.removeAttribute('src'); return; }
    if (!(location.protocol === 'https:' && url.startsWith('http:'))) { img.src = url; return; }
    const abort = new AbortController();
    let blobUrl = null;
    fetch(url, { signal: abort.signal })
      .then((res) => { if (!res.ok) throw Object.assign(new Error('HTTP ' + res.status), { http: true }); return res.blob(); })
      .then((blob) => { if (abort.signal.aborted) return; blobUrl = URL.createObjectURL(blob); img.src = blobUrl; })
      .catch((e) => {
        if (e.name === 'AbortError' || abort.signal.aborted) return;
        // Home Assistant answered with an error: that's the picture's error.
        if (e.http) { img.dispatchEvent(new Event('error')); return; }
        // The fetch itself failed (no CORS origin set in Home Assistant, or the network): load the
        // address directly as before, which works on WebView 106 and on 138 fires the <img>'s error.
        img.src = url;
      });
    // A new url (or the <img> going away) stops this fetch and frees its picture.
    return () => { abort.abort(); if (blobUrl) URL.revokeObjectURL(blobUrl); };
  };
}
