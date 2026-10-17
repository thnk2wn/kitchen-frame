<script>
  import { untrack } from 'svelte';
  import Icon from '../components/Icon.svelte';
  import SortButton from '../components/SortButton.svelte';
  import MediaSwitch from '../components/MediaSwitch.svelte';
  import { ha, haUrl, callService, send } from '../lib/ha.svelte.js';
  import { ui } from '../lib/state.svelte.js';
  import { api } from '../lib/api.js';
  import { shown, busy, expectFor } from '../lib/pending.svelte.js';
  import { nowList, playlistOf } from '../lib/playlist.svelte.js';
  import { coverColor } from '../lib/tint.js';
  import { fakeMedia as fake, demoMedia, nm } from '../lib/demo-media.svelte.js';

  // Demo mode without Home Assistant (a laptop, screenshots): an invented Spotify player on invented
  // speakers; taps change it locally only. With Home Assistant, demo mode is the real player with
  // public playlists and names fit to show (lib/demo-media.svelte.js).
  const DEMO_TRACKS = [['Golden Hour', 'The Lanterns', 'Porch Light Sessions', 214], ['Saturday Pancakes', 'Maple & Co.', 'Kitchen Radio', 188], ['Slow River', 'Juniper Lane', 'Evening Songs', 241]];
  let demoTrack = $state(0);
  const demo = $state({
    entity_id: 'media_player.spotify_demo', label: 'Spotify', state: 'playing', source: 'Kitchen',
    source_list: ['Kitchen', 'Living Room', 'Office', 'Kids’ room'], volume_level: 0.35, supported_features: 0xffff,
    media_position: 74, media_position_updated_at: new Date().toISOString(),
  });
  let demoPlayer = $derived({ ...demo, media_title: DEMO_TRACKS[demoTrack][0], media_artist: DEMO_TRACKS[demoTrack][1], media_album_name: DEMO_TRACKS[demoTrack][2], media_duration: DEMO_TRACKS[demoTrack][3] });
  const DEMO_LISTS = ['Dinner Jazz', 'Kids Dance Party', 'Sunday Morning', 'Road Trip', 'Focus', 'Throwbacks'].map((title) => ({ title, media_content_id: 'demo:' + title, media_content_type: 'playlist' }));
  function demoRun(service, data) {
    if (service === 'media_play_pause') demo.state = demo.state === 'playing' ? 'paused' : 'playing';
    if (service === 'media_play' || service === 'play_media') demo.state = 'playing';
    if (service === 'media_next_track' || service === 'media_previous_track') { demoTrack = (demoTrack + (service === 'media_next_track' ? 1 : DEMO_TRACKS.length - 1)) % DEMO_TRACKS.length; demo.media_position = 0; }
    if (service === 'select_source') demo.source = data.source;
    if (service === 'volume_set') demo.volume_level = data.volume_level;
    demo.media_position_updated_at = new Date().toISOString();
  }
  // Shown as asked for while HA catches up (lib/pending.svelte.js).
  const players = () => (fake() ? [demoPlayer] : ha.players.filter((p) => !p.tv).map(shown)); // TVs: the TV view

  // Two modes. With Home Assistant's Spotify integration, its player is what we control and its
  // Spotify Connect devices (Echos, Nest Hubs…) are the speakers: tapping one moves playback there.
  // Otherwise, Music Assistant (or any) speakers through Home Assistant, each its own player.
  let spotify = $derived(players().find((p) => p.entity_id.startsWith('media_player.spotify_')));
  let chosen = $state(localStorage.getItem('frame-music-player'));
  let player = $derived(spotify || players().find((p) => p.entity_id === chosen)
    || players().find((p) => p.state === 'playing') || ha.players[0]);

  // Spotify speakers: named devices only (Spotify also lists some by a bare id). The chosen one is
  // remembered; until then, the first with "Kitchen" in its name, else the first.
  let speaker = $state(localStorage.getItem('frame-music-speaker'));
  let devices = $derived(spotify ? (spotify.source_list || []).filter((d) => !/^[0-9a-f]{24,}$/i.test(d)) : []);
  let target = $derived(spotify && spotify.source && spotify.state === 'playing' ? spotify.source
    : devices.includes(speaker) ? speaker : devices.find((d) => /kitchen/i.test(d)) || devices[0]);
  function pickSpeaker(d) {
    speaker = d;
    localStorage.setItem('frame-music-speaker', d);
    // Already playing somewhere else: move it here.
    if (spotify.state === 'playing' && spotify.source !== d) run('media_player', 'select_source', { source: d });
  }
  // HA's Spotify player can't start playback from a stopped session (it only offers "choose a
  // speaker" then, and moving an idle session doesn't start it). If the chosen speaker is an Echo
  // (HA's Alexa Devices integration), ask it as if spoken: "play Spotify". Once Spotify is playing
  // there, the Spotify player's controls take over.
  const PLAY_MEDIA = 512;
  const active = () => spotify && (spotify.supported_features & PLAY_MEDIA);
  let deviceOf = null; // entity_id -> device_id, from the entity registry (readable by any user)
  async function echoFor(name) {
    const echo = players().find((p) => p !== spotify && (p.friendly_name === name || p.label === name));
    if (!echo) return null;
    if (!deviceOf) {
      const reg = await send({ type: 'config/entity_registry/list_for_display' });
      deviceOf = new Map((reg.entities || []).filter((e) => e.di).map((e) => [e.ei, e.di]));
    }
    return deviceOf.get(echo.entity_id) || null;
  }
  async function startOn(name, words) {
    if (fake()) { demo.source = name; return demoRun('media_play'); }
    error = null;
    try {
      const device_id = await echoFor(name);
      if (!device_id) { error = 'Start Spotify on ' + name + ' once from the Spotify app, then the frame can control it.'; return; }
      await callService('alexa_devices', 'send_text_command', { device_id, text_command: words });
      nudge();
    } catch (e) { error = e.message; }
  }
  // Home Assistant's Spotify player asks Spotify for news on a timer (every 30 s), so a change made
  // here, above all one started by asking an Echo, can take that long to show with its cover. After
  // a tap, ask it to check now, a few times while Spotify catches up.
  let nudges = [];
  function nudge() {
    if (fake() || !spotify) return;
    nudges.forEach(clearTimeout);
    nudges = [1500, 3500, 6000, 10000].map((ms) => setTimeout(() => {
      if (spotify) callService('homeassistant', 'update_entity', {}, { entity_id: spotify.entity_id }).catch(() => {});
    }, ms));
  }
  async function playPause() {
    if (spotify && !active()) { beginStart(null); return startOn(target, 'play Spotify'); }
    return run('media_player', 'media_play_pause');
  }
  // A playlist: straight to Spotify when a session is active (moving it to the chosen speaker
  // first), otherwise ask the Echo by name.
  // Playlist order: Spotify lists them in library order and has no "last played" for playlists, so
  // the frame keeps its own: a playlist counts as played when it's started here or when Spotify
  // reports it playing (from any app or speaker) while the frame is on. A–Z is the other choice.
  const PLAYED_KEY = 'frame-playlist-played';
  let played = $state((() => { try { return JSON.parse(localStorage.getItem(PLAYED_KEY) || '{}'); } catch { return {}; } })());
  let order = $state(localStorage.getItem('frame-playlist-order') === 'az' ? 'az' : 'recent');
  function setOrder(o) { order = o; try { localStorage.setItem('frame-playlist-order', o); } catch {} }
  function markPlayed(title) {
    if (!title || played[title] && Date.now() - played[title] < 60000) return;
    played = { ...played, [title]: Date.now() };
    try { localStorage.setItem(PLAYED_KEY, JSON.stringify(played)); } catch {}
  }
  $effect(() => { if (!ui.demo && spotify && spotify.state === 'playing' && spotify.media_playlist) markPlayed(spotify.media_playlist); });
  // With the Worker's Spotify connection, Spotify's own record of what was played (any device) counts
  // too; whichever is later wins.
  const lastPlayed = (pl) => Math.max(played[pl.title] || 0, spotifyPlayed[pl.media_content_id] || 0);
  let sorted = $derived(order === 'az'
    ? [...playlists].sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }))
    : playlists.map((pl, i) => ({ pl, i, at: lastPlayed(pl) })).sort((a, b) => b.at - a.at || a.i - b.i).map((x) => x.pl));

  // Scroll the playing playlist's card into view when it becomes the one playing.
  function reveal(node, on) {
    const show = (v) => { if (v) node.scrollIntoView({ block: 'nearest', inline: 'center' }); };
    show(on);
    return { update: show };
  }

  function sideways(e) {
    if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
    e.currentTarget.scrollLeft += e.deltaY;
    e.preventDefault();
  }

  // The playlist just tapped, until the speaker reports it playing (a few seconds through Alexa
  // and Spotify): its card shows a spinner so the tap is clearly taken. Gives up after 30 s.
  let starting = $state(null);
  let startTimer;
  $effect(() => {
    if (starting && fromList && (nowList.uri ? nowList.uri === starting.id : fromList === starting.title)) starting = null;
    // Play with no playlist ("play Spotify" on an Echo): done once something is playing.
    if (starting && !starting.id && player && player.state === 'playing' && player.media_title) starting = null;
  });
  function beginStart(item) {
    starting = item ? { id: item.media_content_id, title: item.title, thumbnail: item.thumbnail } : { id: null };
    clearTimeout(startTimer);
    startTimer = setTimeout(() => (starting = null), 30000);
  }
  async function playList(item) {
    beginStart(item);
    markPlayed(item.title);
    if (!active()) return startOn(target, 'play ' + item.title + ' playlist on Spotify');
    if (spotify.source !== target) await run('media_player', 'select_source', { source: target });
    run('media_player', 'play_media', { media_content_id: item.media_content_id, media_content_type: item.media_content_type });
  }

  // Our playlists, from the Spotify integration's media browser. It only browses while a session is
  // active, so the list is kept (titles, ids, cover URLs) and shown from the copy when idle.
  const BROWSE = 131072;
  let playlists = $state(fake() ? DEMO_LISTS : ui.demo ? demoMedia.playlists : JSON.parse(localStorage.getItem('frame-spotify-playlists') || '[]'));
  let spotifyPlayed = $state((() => { try { return JSON.parse(localStorage.getItem('frame-spotify-played') || '{}'); } catch { return {}; } })());
  // First choice: the Worker's own Spotify connection (SPOTIFY_* settings), which lists every playlist
  // even while nothing is playing. Without it, Home Assistant's browser (first 48 playlists, only
  // during a session).
  let direct = $state(localStorage.getItem('frame-spotify-direct') === 'on');
  $effect(() => {
    if (fake()) return;
    if (ui.demo) { playlists = demoMedia.playlists; return; } // public ones, never ours
    untrack(() => { if (playlists === demoMedia.playlists) playlists = JSON.parse(localStorage.getItem('frame-spotify-playlists') || '[]'); }); // back from demo
    if (!spotify) return;
    const load = () => api('/api/spotify/playlists').then((r) => {
      direct = !!r.configured && !r.error;
      try { localStorage.setItem('frame-spotify-direct', direct ? 'on' : 'off'); } catch {}
      if (!direct || !r.playlists || !r.playlists.length) return;
      playlists = r.playlists;
      spotifyPlayed = r.played || {};
      try {
        localStorage.setItem('frame-spotify-playlists', JSON.stringify(playlists));
        localStorage.setItem('frame-spotify-played', JSON.stringify(spotifyPlayed));
      } catch {}
    }).catch(() => {});
    load();
    const t = setInterval(load, 5 * 60 * 1000); // pick up this morning's listening while the tab is open
    return () => clearInterval(t);
  });
  // The playlist playing now (lib/playlist.svelte.js); it counts as just played for Recent.
  let fromList = $derived(fake() ? 'Sunday Morning' : playlistOf(spotify));
  // What the shown song plays from, said whatever it is: a playlist, an album, an artist, Liked Songs,
  // or nothing (a song started on its own, or autoplay after a playlist ends).
  let mine = $derived(!!spotify && player === spotify && nowList.entity === spotify.entity_id);
  let source = $derived.by(() => {
    if (fake()) return { lead: 'From', name: 'Sunday Morning' };
    const f = mine ? nowList.from : null;
    if (!f) return fromList ? { lead: 'From', name: fromList } : null;
    if (f.kind === 'playlist') return { lead: 'From', name: fromList || f.name || 'a playlist' };
    if (f.kind === 'album') return { lead: 'From the album', name: f.name };
    if (f.kind === 'artist') return { lead: 'From the artist', name: f.name };
    if (f.kind === 'liked') return { lead: 'From', name: 'Liked Songs' };
    return { lead: 'Not from a playlist', name: '' };
  });
  // Up next (Spotify's queue), as many rows as fit between the song and the controls.
  const DEMO_QUEUE = [['Porch Swing', 'The Lanterns'], ['Sunday Paper', 'Maple & Co.'], ['Long Way Home', 'Juniper Lane'], ['Lemonade', 'The Lanterns'], ['Fireflies', 'Juniper Lane'], ['Back Roads', 'Maple & Co.']]
    .map(([title, artist], i) => ({ title, artist, hue: 20 + i * 55 }));
  let upNext = $derived(fake() ? DEMO_QUEUE : mine && nowList.queue ? nowList.queue : []);
  let midH = $state(0);
  let rows = $derived(Math.max(0, Math.min(Math.ceil(upNext.length / 2), Math.floor((midH - 34) / 66))));
  // The card is tinted with the cover's main colour, like Spotify and Apple Music do.
  let tint = $state(null);
  $effect(() => {
    const url = fake() ? null : mine ? nowList.image : null;
    if (fake()) { tint = '217, 72, 107'; return; }
    let live = true;
    coverColor(url).then((c) => { if (live) tint = c ? c.join(', ') : null; });
    return () => { live = false; };
  });
  $effect(() => {
    const uri = nowList.uri;
    if (!ui.demo && uri && spotify && spotify.state === 'playing') untrack(() => { spotifyPlayed = { ...spotifyPlayed, [uri]: Date.now() }; });
  });
  let browsed = false;
  $effect(() => {
    if (ui.demo || direct || !spotify || browsed || ha.status !== 'connected' || !(spotify.supported_features & BROWSE)) return;
    browsed = true;
    // From the library root to its "Playlists" node, so we use whatever ids this HA version gives it.
    const browse = (more = {}) => send({ type: 'media_player/browse_media', entity_id: spotify.entity_id, ...more });
    browse()
      .then((root) => {
        const node = (root.children || []).find((c) => /playlists/i.test(c.media_content_type || '') || /playlists/i.test(c.title || ''));
        if (!node) throw new Error('no playlists');
        return browse({ media_content_type: node.media_content_type, media_content_id: node.media_content_id });
      })
      .then((r) => {
        playlists = (r.children || []).slice(0, 50).map(({ title, media_content_id, media_content_type, thumbnail }) => ({ title, media_content_id, media_content_type, thumbnail }));
        localStorage.setItem('frame-spotify-playlists', JSON.stringify(playlists));
      })
      .catch(() => { browsed = false; });
  });
  let playing = $derived(players().find((p) => p.state === 'playing' && p.entity_id !== player?.entity_id));
  let error = $state(null);

  function choose(p) {
    chosen = p.entity_id;
    localStorage.setItem('frame-music-player', p.entity_id);
  }
  async function run(domain, service, data = {}, on = player) {
    if (fake()) return demoRun(service, data);
    error = null;
    expectFor(on, service, data);
    try { await callService(domain, service, data, { entity_id: on.entity_id }); if (on === spotify && service !== 'volume_set') nudge(); }
    catch (e) { error = e.message; }
  }

  // Progress: HA reports a position and when it was taken; extrapolate once a second while visible.
  let now = $state(Date.now());
  $effect(() => {
    if (!player || player.state !== 'playing' || player.media_position == null) return; // nothing moving
    const t = setInterval(() => (now = Date.now()), 1000);
    return () => clearInterval(t);
  });
  let position = $derived(!player || player.media_position == null ? null
    : player.state === 'playing' ? player.media_position + (now - Date.parse(player.media_position_updated_at)) / 1000
    : player.media_position);
  let duration = $derived(player && player.media_duration ? player.media_duration : null);
  const mmss = (s) => Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0');

  // Volume: follow HA unless the slider is being dragged; send at most every 250 ms while dragging.
  // Spotify's player only takes a volume while a session is active; otherwise the slider sets the
  // chosen speaker's own player (an Echo through Alexa Devices) when Home Assistant has one.
  const VOLUME_SET = 4;
  let volPlayer = $derived(spotify && !(spotify.supported_features & VOLUME_SET)
    ? players().find((p) => p !== spotify && (p.friendly_name === target || p.label === target) && (p.supported_features & VOLUME_SET)) || null
    : player);
  let dragging = $state(false);
  let volume = $state(50);
  $effect(() => { if (!dragging && volPlayer && volPlayer.volume_level != null) volume = Math.round(volPlayer.volume_level * 100); });
  let lastSent = 0, timer;
  function onVolume() {
    clearTimeout(timer);
    const sendNow = () => { lastSent = Date.now(); if (volPlayer) run('media_player', 'volume_set', { volume_level: volume / 100 }, volPlayer); };
    if (Date.now() - lastSent > 250) sendNow(); else timer = setTimeout(sendNow, 250);
  }
</script>

<div class="wrap" class:compact={spotify && playlists.length} style="--art:calc(100vh - {spotify && playlists.length ? 374 : 224}px)">
  {#if !fake() && ha.status === 'off'}
    <div class="sheet empty">Music isn’t set up on this frame yet.</div>
  {:else if !fake() && ha.status === 'error'}
    <div class="sheet empty">{ha.error}</div>
  {:else if !player}
    <div class="sheet empty">{ha.status === 'connected' ? 'No speakers found in Home Assistant.' : 'Connecting to Home Assistant…'}</div>
  {:else}
    <div class="top">
      <div class="art sheet" class:starting>
        {#if starting && starting.thumbnail}
          <img src={starting.thumbnail} alt="" />
        {:else if starting}
          <span class="noart"><Icon name="music" size={96} /></span>
        {:else if player.entity_picture}
          <img src={haUrl(player.entity_picture)} alt="" />
        {:else}
          <span class="noart" class:demo={fake()}><Icon name="music" size={96} /></span>
        {/if}
      </div>

      <section class="sheet now" class:tinted={!!tint} style={tint ? '--tint:' + tint : ''}>
        <div class="where"><Icon name="speaker" size={20} />{spotify ? nm(target) || 'Spotify' : nm(player.label)}</div>
        {#if starting}
          <!-- While a tap starts music: what was asked for, until Spotify reports it playing. -->
          <h1 class="pending">{starting.title || 'Starting…'}</h1>
          <p class="artist starting-on"><span class="spin small" aria-hidden="true"></span>Starting on {nm(target) || 'the speaker'}…</p>
        {:else if player.media_title}
          <h1>{player.media_title}</h1>
          <p class="artist">{player.media_artist || ''}</p>
          {#if source}<p class="from">{source.lead}{#if source.name}{' '}<b>{source.name}</b>{/if}</p>{/if}
          {#if player.media_album_name && source?.lead !== 'From the album'}<p class="album">{player.media_album_name}</p>{/if}
        {:else}
          <h1 class="idle">{player.state === 'off' ? 'Off' : 'Nothing playing'}</h1>
          {#if playing}<p class="artist">Playing on {nm(playing.label)}</p>{/if}
        {/if}

        <div class="mid" bind:clientHeight={midH}>
          {#if rows > 0 && !starting}
            <div class="next-h">Up next</div>
            <div class="next" style="--rows:{rows}">
              <!-- Only the rows that fit: songs in hidden rows would still draw over the visible ones. -->
              {#each upNext.slice(0, rows * 2) as t, i (i)}
                <div class="q">
                  {#if t.image}<img src={t.image} alt="" />{:else}<span class="qart" style="--h:{t.hue || 200}"><Icon name="music" size={20} /></span>{/if}
                  <div class="qt"><b>{t.title}</b><span>{t.artist}</span></div>
                </div>
              {/each}
            </div>
          {:else if mine && nowList.queueAuth && midH >= 40}
            <p class="hint">For Up next, run <code>scripts/spotify-auth.mjs</code> again (it adds Spotify's playback permission).</p>
          {/if}
        </div>

        {#if duration && !starting}
          <div class="progress">
            <div class="bar"><span style="transform:scaleX({Math.min(1, (position || 0) / duration)})"></span></div>
            <div class="times num"><span>{mmss(position || 0)}</span><span>-{mmss(Math.max(0, duration - (position || 0)))}</span></div>
          </div>
        {/if}

        <div class="controls">
          <button class="ctl" class:busy={busy(player, 'title')} onclick={() => run('media_player', 'media_previous_track')} aria-label="Previous"><Icon name="skipBack" size={34} /></button>
          <button class="ctl main" class:busy={busy(player, 'state')} onclick={playPause} aria-label={player.state === 'playing' ? 'Pause' : 'Play'}>
            <Icon name={player.state === 'playing' ? 'pause' : 'play'} size={40} />
          </button>
          <button class="ctl" class:busy={busy(player, 'title')} onclick={() => run('media_player', 'media_next_track')} aria-label="Next"><Icon name="skipForward" size={34} /></button>
        </div>

        <div class="vol" class:none={!volPlayer && !fake()}>
          <Icon name="volume" size={24} />
          <input type="range" min="0" max="100" step="1" bind:value={volume}
            onpointerdown={() => (dragging = true)} onpointerup={() => (dragging = false)} onpointercancel={() => (dragging = false)}
            oninput={onVolume} disabled={!volPlayer && !fake()} aria-label="Volume" style="--pct:{volume}%" />
          <span class="num">{volume}</span>
        </div>
        {#if error}<p class="err">{error}</p>{/if}
      </section>
    </div>

    {#if spotify && playlists.length}
      <!-- Swiped on the frame; a mouse wheel (testing on a computer) scrolls it sideways too. -->
      <section class="lists" onwheel={sideways}>
        <div class="order"><SortButton az={order === 'az'} timeLabel="By last played" onchange={(az) => setOrder(az ? 'az' : 'recent')} size={22} /></div>
        {#each sorted as pl, i (pl.media_content_id)}
          {@const on = !!fromList && (nowList.uri ? pl.media_content_id === nowList.uri : pl.title === fromList)}
          <button class="pl sheet" class:on class:starting={starting && starting.id === pl.media_content_id} onclick={() => playList(pl)} use:reveal={on}>
            {#if starting && starting.id === pl.media_content_id}<span class="spin" aria-label="Starting"></span>{/if}
            {#if pl.thumbnail}<img src={pl.thumbnail} alt="" loading="lazy" decoding="async" />{:else}<span class="noart" class:demo={fake()} style={fake() ? '--h:' + (i * 47 + 10) % 360 : ''}><Icon name="music" size={26} /></span>{/if}
            <span>{pl.title}</span>
          </button>
        {/each}
      </section>
    {/if}

    <section class="sheet speakers">
      <MediaSwitch />
      {#if spotify}
        {#each devices as d (d)}
          <button class="spk" class:on={d === target} onclick={() => pickSpeaker(d)}>
            <span class="dot" class:live={spotify.state === 'playing' && spotify.source === d}></span>{nm(d)}
          </button>
        {:else}
          <span class="hint">Spotify sees no speakers yet. Play something once on an Echo or Nest Hub from the Spotify app.</span>
        {/each}
      {:else}
      {#each players() as p (p.entity_id)}
        <button class="spk" class:on={p.entity_id === player.entity_id} onclick={() => choose(p)}>
          <span class="dot" class:live={p.state === 'playing'}></span>{nm(p.label)}
        </button>
      {/each}
      {#if playing && player.state !== 'playing' && player.ma && playing.ma}
        <button class="here" onclick={() => run('music_assistant', 'transfer_queue', { source_player: playing.entity_id })}>Play here</button>
      {/if}
      {/if}
    </section>
  {/if}
</div>

<style>
  .wrap { height: 100%; padding: 10px 28px 28px; display: flex; flex-direction: column; gap: 20px; }
  .empty { margin: auto; padding: 40px 48px; font-size: 22px; color: var(--secondary); }
  /* The art is a square as tall as the space between the tab bar and the speaker row. Sized
     explicitly (not with aspect-ratio) so the first frame after switching tabs is already laid out:
     100vh minus tab bar 86, padding 38, gap 20 and speaker row 80. */
  .top { flex: 1; min-height: 0; display: grid; grid-template-columns: var(--art) 1fr; gap: 20px; }
  .art { width: 100%; height: var(--art); padding: 0; display: grid; place-items: center; background: var(--sheet); }
  .art img { width: 100%; height: 100%; object-fit: cover; }
  .noart { color: var(--tertiary); }
  /* Demo mode: stand-in playlist covers, a different colour each. */
  .pl .noart.demo { background: linear-gradient(150deg, hsl(var(--h), 75%, 62%), hsl(calc(var(--h) + 40), 70%, 45%)); color: rgba(255, 255, 255, .8); }
  /* Demo mode: a stand-in cover instead of real album art. */
  /* With the playlists row there's less height: one-line title, tighter spacing, smaller controls. */
  .compact .now { padding: 20px 28px; }
  .compact h1 { margin-top: 8px; font-size: 30px; -webkit-line-clamp: 1; }
  .compact .artist { margin-top: 4px; font-size: 20px; }
  .compact .album { display: none; }
  .compact .progress { padding-top: 10px; }
  .compact .controls { margin-top: 8px; gap: 28px; }
  .compact .ctl { width: 56px; height: 56px; }
  .compact .ctl.main { width: 68px; height: 68px; }
  .compact .vol { margin-top: 8px; }
  .noart.demo { width: 100%; height: 100%; display: grid; place-items: center; background: linear-gradient(150deg, #f6a04d, #d9486b 55%, #6a3fa0); color: rgba(255, 255, 255, .75); }
  .now { min-width: 0; display: flex; flex-direction: column; padding: 28px 32px; }
  .where { display: flex; align-items: center; gap: 8px; font-size: 17px; font-weight: 600; color: var(--secondary); }
  h1 { margin: 14px 0 0; font-size: 36px; font-weight: 700; letter-spacing: -.02em; line-height: 1.1;
    display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
  h1.idle { color: var(--secondary); }
  .artist { margin: 8px 0 0; font-size: 24px; color: var(--secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .album { margin: 4px 0 0; font-size: 18px; color: var(--secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .progress { padding-top: 16px; }
  /* The cover's colour washed across the card, strongest at the top left. */
  .now.tinted { background-image: linear-gradient(135deg, rgba(var(--tint), .34), rgba(var(--tint), .14) 55%, rgba(var(--tint), .05)); }
  /* Up next: two columns, as many rows as the space allows (rows past that are left out, not cut). */
  .mid { flex: 1 1 0; min-height: 0; overflow: hidden; display: flex; flex-direction: column; justify-content: center; padding-top: 12px; }
  .next-h { font-size: 15px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; color: var(--secondary); margin-bottom: 10px; }
  .next { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); grid-template-rows: repeat(var(--rows), 56px); grid-auto-rows: 0; column-gap: 24px; row-gap: 10px; height: calc(var(--rows) * 56px + (var(--rows) - 1) * 10px); overflow: hidden; }
  .q { display: flex; align-items: center; gap: 12px; min-width: 0; }
  .q img, .qart { flex: none; width: 56px; height: 56px; border-radius: 8px; object-fit: cover; }
  .qart { display: grid; place-items: center; background: linear-gradient(150deg, hsl(var(--h), 70%, 62%), hsl(calc(var(--h) + 40), 65%, 45%)); color: rgba(255, 255, 255, .8); }
  .qt { min-width: 0; display: flex; flex-direction: column; gap: 2px; }
  .qt b, .qt span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .qt b { font-size: 18px; font-weight: 600; }
  .qt span { font-size: 15px; color: var(--secondary); }
  .hint { margin: 0; font-size: 15px; color: var(--secondary); }
  .hint code { font-size: 14px; }
  .bar { height: 6px; border-radius: 3px; background: var(--tertiary); overflow: hidden; }
  .bar span { display: block; height: 100%; background: var(--label); transform-origin: 0 50%; }
  .times { display: flex; justify-content: space-between; margin-top: 6px; font-size: 15px; color: var(--secondary); }
  .controls { display: flex; align-items: center; justify-content: center; gap: 36px; margin-top: 14px; }
  .ctl { width: 64px; height: 64px; border-radius: 50%; display: grid; place-items: center; color: var(--label); }
  .ctl.main { width: 84px; height: 84px; background: var(--label); color: var(--sheet); }
  .ctl:active { opacity: .6; }
  /* Sent, waiting for the speaker to catch up. */
  .ctl.busy :global(svg) { animation: waiting 1s ease-in-out infinite; }
  @keyframes waiting { 50% { opacity: .35; } }
  .vol { display: flex; align-items: center; gap: 14px; margin-top: 14px; color: var(--secondary); }
  .vol span { width: 36px; text-align: right; font-size: 17px; }
  input[type='range'] { flex: 1; -webkit-appearance: none; appearance: none; height: 6px; border-radius: 3px; outline: none;
    background: linear-gradient(90deg, var(--label) var(--pct), var(--tertiary) var(--pct)); }
  input[type='range']::-webkit-slider-thumb { -webkit-appearance: none; width: 30px; height: 30px; border-radius: 50%; background: #fff; border: 1px solid var(--sep); }
  .err { margin: 10px 0 0; font-size: 16px; color: var(--red-text); }
  .speakers { flex: none; display: flex; align-items: center; gap: 10px; padding: 14px 18px; overflow-x: auto; }
  .spk { flex: none; display: flex; align-items: center; gap: 10px; height: 52px; padding: 0 20px; border-radius: 26px; background: var(--track); font-size: 18px; font-weight: 600; }
  .spk.on { background: var(--label); color: var(--sheet); }
  .spk:active { opacity: .7; }
  .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--tertiary); }
  .dot.live { background: var(--green, #34c759); }
  .hint { font-size: 16px; color: var(--secondary); }
  /* Playlists: one row of small cards, scrolled sideways. */
  .lists { flex: none; display: flex; gap: 12px; overflow-x: auto; scrollbar-width: none; }
  .lists::-webkit-scrollbar { display: none; }
  /* Order switch: a tile the same height and shape as the playlist cards, two equal halves. */
  .order { flex: none; align-self: stretch; width: 64px; display: grid; place-items: center; border-radius: 16px; background: var(--sheet); }
  .order :global(.sort) { width: 46px; height: 46px; }
  .pl { flex: none; width: 128px; padding: 0 0 8px; border-radius: 16px; overflow: hidden; text-align: left; }
  .pl img, .pl .noart { display: grid; place-items: center; width: 128px; height: 96px; object-fit: cover; background: var(--track); }
  .pl span { display: block; padding: 6px 10px 0; font-size: 14px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .pl:active { opacity: .7; }
  /* Tapped, waiting for the speaker: a dimmed cover with a turning ring (transform only). */
  .pl { position: relative; }
  .pl.starting img, .pl.starting .noart { opacity: .45; }
  .spin { position: absolute; left: 50%; top: 48px; width: 40px; height: 40px; margin: -20px 0 0 -20px; border-radius: 50%; border: 4px solid rgba(255, 255, 255, .35); border-top-color: #fff; animation: spin .8s linear infinite; z-index: 1; }
  @keyframes spin { to { transform: rotate(360deg); } }
  /* The playlist playing now. */
  .pl.on { box-shadow: inset 0 0 0 3px var(--pal-green); }
  .pl.on span { color: var(--pal-green); }
  .from { margin: 6px 0 0; font-size: 17px; color: var(--secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .from b { font-weight: 600; color: var(--label); }
  .here { flex: none; margin-left: auto; height: 52px; padding: 0 22px; border-radius: 26px; font-size: 18px; font-weight: 600; color: var(--blue-text); }
  /* No speaker to set a volume on (Spotify idle on a speaker Home Assistant doesn't have). */
  .vol.none { opacity: .4; }
  /* Starting: the tapped playlist's cover and name, dimmed, until Spotify reports it playing. */
  .art.starting img, .art.starting .noart { opacity: .5; }
  h1.pending { opacity: .55; }
  .starting-on { display: flex; align-items: center; gap: 10px; }
  .spin.small { position: static; flex: none; width: 20px; height: 20px; margin: 0; border-width: 3px; border-color: var(--track); border-top-color: var(--label); }
</style>
