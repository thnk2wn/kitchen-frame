// Pictures from Home Assistant (camera snapshots, album art) on the https dashboard. Home Assistant is
// plain http on the home network, and WebView 138 blocks http images on an https page outright (106
// let the kiosk's "allow mixed content" through). A fetch() to it is still allowed, so the picture is
// fetched and shown from a blob URL. Needs the dashboard's origin in Home Assistant's CORS allowed
// origins (Settings → System → Network; docs/house.md). Anything https, or on an http page (the dev
// server), loads directly as before.
//
//   <img {@attach haImage(url)} onload={…} onerror={…} />
//
// load and error fire on the <img> as they would with src, so its handlers keep working.
export function haImage(url) {
  return (img) => {
    if (!url) { img.removeAttribute('src'); return; }
    if (!(location.protocol === 'https:' && url.startsWith('http:'))) { img.src = url; return; }
    const abort = new AbortController();
    let blobUrl = null;
    fetch(url, { signal: abort.signal })
      .then((res) => { if (!res.ok) throw new Error('HTTP ' + res.status); return res.blob(); })
      .then((blob) => { blobUrl = URL.createObjectURL(blob); img.src = blobUrl; })
      .catch((e) => { if (e.name !== 'AbortError') img.dispatchEvent(new Event('error')); });
    // A new url (or the <img> going away) stops this fetch and frees its picture.
    return () => { abort.abort(); if (blobUrl) URL.revokeObjectURL(blobUrl); };
  };
}
