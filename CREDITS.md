# Credits

## Inspiration

This project would not exist without **Wes Bos**, who showed that a cheap Android photo frame can
be turned into a family dashboard:

- Video: [Taking over Android photo frames](https://youtu.be/ZLycoUMltNI)
- Repository: [wesbos/photo-frame-dashboard](https://github.com/wesbos/photo-frame-dashboard),
  including its device guides (ADB, rooting, WebView upgrades) for many frame models

The approach here (a full-screen kiosk WebView, a small web app served from Cloudflare, idle photo
slideshow) follows his. The code in this repository is an independent implementation: none of it
is copied from his repository, which has no license. Go watch the video and star his repo.

## Forked from

This repository is a fork of **Hunter Yeagley**'s
[huntsyea/kitchen-frame](https://github.com/huntsyea/kitchen-frame) (MIT), which built the
dashboard, Worker, kiosk app and frame notes this fork extends. "This project" above is his
description of that work.

## Data and services

- Weather data by [Open-Meteo](https://open-meteo.com) (CC BY 4.0).
- Forecast text and alerts from the US [National Weather Service](https://www.weather.gov) (public domain).
- Recipes from [TheMealDB](https://www.themealdb.com) (free API key for personal use).
- Demo mode's slideshow photos from [Lorem Picsum](https://picsum.photos), photos from [Unsplash](https://unsplash.com) under the Unsplash License.
- Demo mode's camera pictures: public-domain photos on Flickr, found through
  [Openverse](https://openverse.org): "Front Entry" by Paul Pakozdi, "Spring Lake" by satguru,
  "Home Garage with Epoxy Coatings" by Nolan V. and "The beginnings of a Garden for the Buddha" by Wonderlane.
- Demo mode's Music row: public Spotify playlists, by their makers and Spotify.
- Maps with `GOOGLE_MAPS_KEY`: event maps, place lookups and drive times from
  [Google Maps Platform](https://cloud.google.com/maps-platform/terms) (Static Maps, Geocoding,
  Routes, Map Tiles: the full-screen map and the radar's street map), fetched by the Worker; the map
  pictures carry Google's own credit, and its tiles show "Google Maps" and its map data credit.
- Maps otherwise: tiles and place lookups from [OpenStreetMap](https://www.openstreetmap.org/copyright)
  (© OpenStreetMap contributors, ODbL) through its tile servers and
  [Nominatim](https://operations.osmfoundation.org/policies/nominatim/), within their usage
  policies (an identifying User-Agent, light use, results cached by the Worker).
- Rain radar: in the US, NWS NEXRAD radar and NOAA's HRRR forecast tiles from the
  [Iowa Environmental Mesonet](https://mesonet.agron.iastate.edu) (Iowa State University); elsewhere
  [RainViewer](https://www.rainviewer.com/api.html) (free tier, non-commercial, attribution shown).
- Calendars, Todoist, iCloud Shared Albums, Paprika, Spotify and Home Assistant / Music Assistant
  are each the household's own accounts, accessed through their APIs. Paprika and iCloud's shared
  album feed are undocumented APIs, read-only here.

## Open-source software

Installed through npm (see `dashboard/package.json`), each under its own license:
[Svelte](https://svelte.dev) (MIT), [Vite](https://vite.dev) (MIT),
[Wrangler and the Cloudflare Vite plugin](https://github.com/cloudflare/workers-sdk) (MIT/Apache-2.0),
[ical.js](https://github.com/kewisch/ical.js) (MPL-2.0).

Emoji the frame's older font can't draw are shown as [Twemoji](https://github.com/jdecked/twemoji)
graphics (Copyright Twitter, Inc. and other contributors; graphics licensed under
[CC-BY 4.0](https://creativecommons.org/licenses/by/4.0/)), loaded from jsDelivr by
`dashboard/src/lib/emoji.js`. The upload method in `dashboard/scripts/paprika-photos.mjs` follows
[mcp-paprika](https://github.com/bojanrajkovic/mcp-paprika) (MIT).

`dashboard/src/lib/icons.js` contains icon artwork generated from
[Lucide](https://lucide.dev) by `dashboard/scripts/icons.mjs`. Its license follows.

---

ISC License

Copyright (c) 2026 Lucide Icons and Contributors

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.

---

The following Lucide icons are derived from the Feather project:

airplay, alert-circle, alert-octagon, alert-triangle, aperture, arrow-down-circle, arrow-down-left, arrow-down-right, arrow-down, arrow-left-circle, arrow-left, arrow-right-circle, arrow-right, arrow-up-circle, arrow-up-left, arrow-up-right, arrow-up, at-sign, calendar, cast, check, chevron-down, chevron-left, chevron-right, chevron-up, chevrons-down, chevrons-left, chevrons-right, chevrons-up, circle, clipboard, clock, code, columns, command, compass, corner-down-left, corner-down-right, corner-left-down, corner-left-up, corner-right-down, corner-right-up, corner-up-left, corner-up-right, crosshair, database, divide-circle, divide-square, dollar-sign, download, external-link, feather, frown, hash, headphones, help-circle, info, italic, key, layout, life-buoy, link-2, link, loader, lock, log-in, log-out, maximize, meh, minimize, minimize-2, minus-circle, minus-square, minus, monitor, moon, more-horizontal, more-vertical, move, music, navigation-2, navigation, octagon, pause-circle, percent, plus-circle, plus-square, plus, power, radio, rss, search, server, share, shopping-bag, sidebar, smartphone, smile, square, table-2, tablet, target, terminal, trash-2, trash, triangle, tv, type, upload, x-circle, x-octagon, x-square, x, zoom-in, zoom-out

The MIT License (MIT) (for the icons listed above)

Copyright (c) 2013-present Cole Bemis

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
