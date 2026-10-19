<script>
  // Media → Podcasts: the shows followed in Apple Podcasts (through the Mac bridge; lib/podcasts.svelte.js),
  // most listened to first, then a row for each group in PODCASTS_EXTRA (someone else's shows). Continue: episodes half played here or on the phone. Tap a show for its
  // episodes with their descriptions; tap an episode to play it on the frame from where it was left.
  import { onMount } from 'svelte';
  import MediaSwitch from '../components/MediaSwitch.svelte';
  import Icon from '../components/Icon.svelte';
  import { podcasts, loadPodcasts, inProgress, positions, startAt, pod, playEpisode, toggle, skip, seekTo, setVolume, stopPodcast, echo, loadEchos, setTarget, playOnEcho, echoCommand } from '../lib/podcasts.svelte.js';
  import { ha } from '../lib/ha.svelte.js';
  import { nm } from '../lib/demo-media.svelte.js';

  onMount(() => { loadPodcasts(); });
  // The Echos it can play on (Home Assistant's Alexa Devices), once Home Assistant is connected.
  $effect(() => { if (ha.status === 'connected' && ha.players.length) loadEchos(); });
  let onEcho = $derived(echo.target !== 'frame');
  let echoName = $derived((echo.list.find((e) => e.id === echo.target) || {}).name || 'the Echo');
  let picking = $state(false);
  // A tap on an episode: on the frame, or on the chosen Echo.
  const play = (s, e) => (onEcho ? playOnEcho(s, e) : playEpisode(s, e));
  let echoState = $derived(echo.now && pod.ep && echo.now.episode && echo.now.episode.id === pod.ep.id ? echo.now.state : null);
  let chosen = $state(localStorage.getItem('frame-podcast-show'));
  let show = $derived(podcasts.shows.find((s) => s.id === chosen) || podcasts.shows[0]);
  function pick(s) { chosen = s.id; try { localStorage.setItem('frame-podcast-show', s.id); } catch {} }
  let going = $derived(inProgress(podcasts.shows, positions));
  // The library's shows first, then a row per PODCASTS_EXTRA group, under its name ("Sam").
  let rows = $derived.by(() => {
    const out = [{ name: '', shows: podcasts.shows.filter((s) => !s.group) }];
    for (const s of podcasts.shows) if (s.group) {
      let r = out.find((x) => x.name === s.group);
      if (!r) out.push((r = { name: s.group, shows: [] }));
      r.shows.push(s);
    }
    return out.filter((r) => r.shows.length);
  });

  // "1 h 12 min", "38 min"; "Oct 14" (or "Mon" within the week).
  const length = (s) => { const m = Math.round(s / 60); return m >= 60 ? Math.floor(m / 60) + ' h ' + (m % 60) + ' min' : m + ' min'; };
  const day = (iso) => {
    const d = new Date(iso);
    if (isNaN(d)) return '';
    return Date.now() - d < 6 * 86400000 ? d.toLocaleDateString([], { weekday: 'short' }) : d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  };
  const left = (e) => { const at = pod.ep && pod.ep.id === e.id ? pod.position : startAt(e); return e.seconds && at > 30 ? length(Math.max(60, e.seconds - at)) + ' left' : ''; };
  const pct = (e) => { const at = pod.ep && pod.ep.id === e.id ? pod.position : startAt(e); return e.seconds && at > 30 ? Math.min(100, (100 * at) / e.seconds) : 0; };
  const mmss = (s) => { s = Math.max(0, Math.floor(s || 0)); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60); return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(s % 60).padStart(2, '0'); };
  let open = $state(null); // the episode whose full description shows
  // A picture that won't load gives way to the podcast icon.
  let broken = $state({});
  const ok = (s) => s.art && !broken[s.id];
  const failed = (s) => () => (broken = { ...broken, [s.id]: true });
  function bar(e) { const r = e.currentTarget.getBoundingClientRect(); seekTo((e.clientX - r.left) / r.width); }
</script>

<div class="wrap">
  <div class="body">
    {#if !podcasts.shows.length}
      <div class="sheet empty">{podcasts.configured === false ? 'Podcasts aren’t set up (PODCASTS=bridge and the Mac bridge; see docs/music.md).' : 'Waiting for the Podcasts library from the Mac…'}</div>
    {:else}
      {#if going.length}
        <h2>Continue</h2>
        <div class="row">
          {#each going as g (g.ep.id)}
            <button class="cont sheet" class:on={pod.ep && pod.ep.id === g.ep.id} onclick={() => play(g.show, g.ep)}>
              {#if ok(g.show)}<img src={g.show.art} alt="" loading="lazy" decoding="async" onerror={failed(g.show)} />{:else}<span class="noart"><Icon name="podcast" size={26} /></span>{/if}
              <span class="ct"><span class="t">{g.ep.title}</span><span class="sub">{g.show.title}{left(g.ep) ? ' · ' + left(g.ep) : ''}</span><span class="prog"><span style="transform:scaleX({pct(g.ep) / 100})"></span></span></span>
            </button>
          {/each}
        </div>
      {/if}
      {#each rows as r (r.name)}
        <!-- nm(): demo mode shows the group under its demo name, like Videos does. -->
        {#if r.name}<h2 class="rowname">{nm(r.name)}</h2>{/if}
        <div class="row shows">
          {#each r.shows as s (s.id)}
            <button class="show" class:on={show && s.id === show.id} onclick={() => pick(s)} aria-label={s.title}>
              {#if ok(s)}<img src={s.art} alt="" loading="lazy" decoding="async" onerror={failed(s)} />{:else}<span class="noart big"><Icon name="podcast" size={40} /></span>{/if}
            </button>
          {/each}
        </div>
      {/each}
      {#if show}
        <div class="eps sheet">
          <div class="shead"><h2>{show.title}</h2>{#if show.author}<span class="sub">{show.author}</span>{/if}</div>
          {#each show.episodes as e (e.id)}
            <div class="ep" class:played={e.played && !pct(e)}>
              <button class="pp" class:on={pod.ep && pod.ep.id === e.id} onclick={() => play(show, e)} aria-label={pod.ep && pod.ep.id === e.id && pod.playing ? 'Pause' : 'Play'}>
                <Icon name={pod.ep && pod.ep.id === e.id && pod.playing ? 'pause' : 'play'} size={22} />
              </button>
              <button class="etext" onclick={() => (open = open === e.id ? null : e.id)}>
                <span class="t">{e.title}</span>
                <span class="sub">{[day(e.date), left(e) || (e.seconds ? length(e.seconds) : ''), e.played && !pct(e) ? 'Played' : ''].filter(Boolean).join(' · ')}</span>
                {#if e.description}<span class="desc" class:full={open === e.id}>{e.description}</span>{/if}
              </button>
            </div>
          {/each}
        </div>
      {/if}
    {/if}
  </div>
  <section class="sheet bar">
    <MediaSwitch />
    <div class="where">
      <button class="spk" onclick={() => (picking = !picking)} aria-label="Play on"><Icon name="speaker" size={20} />{onEcho ? echoName : 'Frame'}<Icon name="chevronUp" size={16} /></button>
      {#if picking}
        <div class="menu sheet">
          <button class:on={!onEcho} onclick={() => { setTarget('frame'); picking = false; }}>Frame</button>
          {#each echo.list as e (e.id)}<button class:on={echo.target === e.id} onclick={() => { setTarget(e.id); picking = false; }}>{e.name}</button>{/each}
        </div>
      {/if}
    </div>
    {#if echo.error}<span class="sub bad">{echo.error}</span>{/if}
    {#if pod.ep && onEcho}
      <div class="np">
        {#if pod.show && ok(pod.show)}<img src={pod.show.art} alt="" onerror={failed(pod.show)} />{/if}
        <div class="npt">
          <span class="t">{pod.ep.title}</span>
          <span class="sub">{echoState === 'starting' || echo.starting ? 'Starting on ' + echoName + '…' : echoState === 'playing' ? 'Playing on ' + echoName : echoState === 'paused' ? 'Paused on ' + echoName + (echo.now.position ? ' at ' + mmss(echo.now.position) : '') : echoState === 'finished' ? 'Finished' : echoState === 'failed' ? 'It wouldn’t play on ' + echoName : ''}</span>
        </div>
      </div>
      {@const waiting = echo.starting || echo.busy || echoState === 'starting'}
      <button class="ctl main" class:busy={waiting} disabled={waiting || !echoState || echoState === 'finished'} onclick={() => echoCommand(echoState === 'playing' ? 'pause' : 'resume')} aria-label={echoState === 'playing' ? 'Pause' : 'Play'}><Icon name={echoState === 'playing' ? 'pause' : 'play'} size={30} /></button>
      <button class="ctl" disabled={waiting} onclick={() => echoCommand('stop')} aria-label="Stop"><Icon name="close" size={22} /></button>
    {:else if pod.ep}
      <div class="np">
        {#if pod.show && ok(pod.show)}<img src={pod.show.art} alt="" onerror={failed(pod.show)} />{/if}
        <div class="npt">
          <span class="t">{pod.ep.title}</span>
          {#if pod.error}<span class="sub bad">{pod.error}</span>
          {:else}<button class="track" onclick={bar} aria-label="Seek"><span style="transform:scaleX({pod.duration ? pod.position / pod.duration : 0})"></span></button><span class="sub num">{mmss(pod.position)} / {mmss(pod.duration)}</span>{/if}
        </div>
      </div>
      <button class="ctl" onclick={() => skip(-15)} aria-label="Back 15 seconds"><Icon name="rewind" size={26} /></button>
      <button class="ctl main" class:busy={pod.loading} onclick={toggle} aria-label={pod.playing ? 'Pause' : 'Play'}><Icon name={pod.playing ? 'pause' : 'play'} size={30} /></button>
      <button class="ctl" onclick={() => skip(30)} aria-label="Forward 30 seconds"><Icon name="fastForward" size={26} /></button>
      <button class="ctl" onclick={() => setVolume(pod.volume - 10)} disabled={pod.volume <= 0} aria-label="Quieter"><Icon name="minus" size={22} /></button>
      <span class="lvl"><span style="transform:scaleX({pod.volume / 100})"></span></span>
      <button class="ctl" onclick={() => setVolume(pod.volume + 10)} disabled={pod.volume >= 100} aria-label="Louder"><Icon name="plus" size={22} /></button>
      <button class="ctl" onclick={stopPodcast} aria-label="Stop"><Icon name="close" size={22} /></button>
    {/if}
  </section>
</div>

<style>
  .wrap { height: 100%; padding: 10px 28px 28px; display: flex; flex-direction: column; gap: 14px; }
  .body { flex: 1; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 12px; }
  h2 { margin: 0; font-size: 22px; font-weight: 800; }
  .sub { font-size: 15px; color: var(--secondary); }
  .row { flex: none; display: flex; gap: 12px; overflow-x: auto; scrollbar-width: none; padding-bottom: 2px; }
  .cont { flex: 0 0 360px; display: flex; gap: 12px; align-items: center; padding: 10px; border-radius: 16px; text-align: left; }
  .cont.on { outline: 3px solid var(--blue); }
  .cont img, .noart { flex: none; width: 72px; height: 72px; border-radius: 12px; object-fit: cover; background: var(--fill); display: grid; place-items: center; color: var(--secondary); }
  .ct { min-width: 0; flex: 1; display: flex; flex-direction: column; gap: 3px; }
  .t { font-size: 17px; font-weight: 700; line-height: 1.25; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .ct .sub { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .prog, .track, .lvl { display: block; height: 6px; border-radius: 3px; background: var(--track); overflow: hidden; }
  .prog span, .track span, .lvl span { display: block; height: 100%; background: var(--blue); transform-origin: left; }
  .rowname { margin-top: 4px; font-size: 18px; color: var(--secondary); }
  .shows .show { flex: none; padding: 0; border-radius: 16px; }
  .shows img, .noart.big { width: 120px; height: 120px; border-radius: 16px; object-fit: cover; display: block; }
  .shows .show.on img, .shows .show.on .noart { outline: 4px solid var(--blue); outline-offset: -4px; }
  .shows .show:not(.on) { opacity: .8; }
  .eps { padding: 14px 18px; border-radius: 18px; display: flex; flex-direction: column; }
  .shead { display: flex; align-items: baseline; gap: 12px; margin-bottom: 6px; }
  .ep { display: flex; gap: 14px; align-items: flex-start; padding: 10px 0; }
  .ep + .ep { border-top: 1px solid var(--sep); }
  .ep.played { opacity: .6; }
  .pp { flex: none; width: 48px; height: 48px; border-radius: 50%; display: grid; place-items: center; background: var(--fill); }
  .pp.on { background: var(--blue); color: #fff; }
  .etext { min-width: 0; flex: 1; text-align: left; display: flex; flex-direction: column; gap: 3px; }
  .etext .t { white-space: normal; }
  .desc { font-size: 15px; line-height: 1.35; color: var(--secondary); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
  .desc.full { display: block; }
  .empty { margin: auto; padding: 40px 48px; font-size: 22px; color: var(--secondary); text-align: center; }
  /* Visible overflow and its own layer, so the speaker list opening upward shows over the episodes. */
  .bar { flex: none; display: flex; align-items: center; gap: 10px; padding: 14px 18px; position: relative; z-index: 10; overflow: visible; }
  .np { flex: 1; min-width: 0; display: flex; align-items: center; gap: 12px; margin-left: 8px; }
  .np img { flex: none; width: 52px; height: 52px; border-radius: 10px; object-fit: cover; }
  .npt { min-width: 0; flex: 1; display: flex; flex-direction: column; gap: 4px; }
  .track { width: 100%; height: 8px; padding: 0; }
  .bad { color: var(--red); }
  .ctl { flex: none; width: 52px; height: 52px; border-radius: 50%; display: grid; place-items: center; }
  .ctl.main { width: 60px; height: 60px; background: var(--label); color: var(--sheet); }
  .ctl.busy { opacity: .6; }
  .ctl:disabled { opacity: .35; }
  .lvl { width: 80px; }
  .where { position: relative; flex: none; }
  .spk { display: flex; align-items: center; gap: 8px; height: 48px; padding: 0 14px; border-radius: 12px; background: var(--fill); font-size: 17px; font-weight: 600; }
  .menu { position: absolute; bottom: 58px; left: 0; z-index: 5; min-width: 220px; padding: 6px; border-radius: 14px; display: flex; flex-direction: column; box-shadow: 0 4px 16px rgba(0, 0, 0, .18); }
  .menu button { text-align: left; padding: 12px 14px; border-radius: 10px; font-size: 18px; }
  .menu button.on { background: var(--fill); font-weight: 700; }
  button:active { opacity: .7; }
</style>
