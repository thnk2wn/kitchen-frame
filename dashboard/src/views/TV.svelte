<script>
  // The Media tab's TV view: what a TV is playing (any app: Disney+, Netflix, YouTube…), its
  // controls, its apps and an on-screen remote. TVs are found in Home Assistant by their integration
  // (lib/ha.svelte.js); nothing here is specific to one household.
  import Icon from '../components/Icon.svelte';
  import MediaSwitch from '../components/MediaSwitch.svelte';
  import { ha, haUrl, callService, tvAudio } from '../lib/ha.svelte.js';
  import { haImage } from '../lib/ha-image.js';
  import { ui } from '../lib/state.svelte.js';
  import { fakeMedia as fake, nm } from '../lib/demo-media.svelte.js';

  // Remote buttons by integration: the command names each one's remote.send_command takes. A TV whose
  // integration isn't here (or has no remote entity) shows no remote.
  const KEYS = {
    apple_tv: { up: 'up', down: 'down', left: 'left', right: 'right', ok: 'select', back: 'menu', home: 'home', fwd: 'skip_forward', rew: 'skip_backward' },
    androidtv_remote: { up: 'DPAD_UP', down: 'DPAD_DOWN', left: 'DPAD_LEFT', right: 'DPAD_RIGHT', ok: 'DPAD_CENTER', back: 'BACK', home: 'HOME', fwd: 'MEDIA_FAST_FORWARD', rew: 'MEDIA_REWIND' },
    roku: { up: 'up', down: 'down', left: 'left', right: 'right', ok: 'select', back: 'back', home: 'home', fwd: 'forward', rew: 'reverse' },
  };

  // Demo mode without Home Assistant: an invented TV and show; taps change it locally only. With it,
  // demo mode is the real TVs under names fit to show (lib/demo-media.svelte.js).
  const demo = $state({
    entity_id: 'media_player.demo_tv', friendly_name: 'Living Room', label: 'Living Room', tv: true, platform: 'apple_tv', remote: 'remote.demo_tv',
    state: 'playing', app_name: 'Nature Channel', supported_features: 1024 | 8, is_volume_muted: false, media_title: 'Coastlines', media_artist: 'S1:E3 Tide Pools',
    media_duration: 2640, media_position: 812, media_position_updated_at: new Date().toISOString(),
    source_list: ['Nature Channel', 'Kids Shows', 'Movies', 'Music', 'Photos', 'Settings'],
  });
  let tvs = $derived(fake() ? [demo] : ha.players.filter((p) => p.tv));
  let chosen = $state(localStorage.getItem('frame-tv'));
  let tv = $derived(tvs.find((t) => t.entity_id === chosen) || tvs.find((t) => t.state === 'playing') || tvs[0]);
  function pick(t) { chosen = t.entity_id; try { localStorage.setItem('frame-tv', t.entity_id); } catch {} }

  let keys = $derived(tv && tv.remote ? KEYS[tv.platform] : null);
  let off = $derived(!tv || tv.state === 'off' || tv.state === 'standby' || tv.state === 'unavailable');
  let app = $derived(tv ? tv.app_name || tv.source || '' : '');
  let art = $derived(tv && tv.entity_picture && !fake() ? haUrl(tv.entity_picture) : null);

  // Apps in the order they were last watched on this TV (as the frame saw them playing), then A–Z,
  // so the ones the household uses come first without a list to keep.
  let seen = $state((() => { try { return JSON.parse(localStorage.getItem('frame-tv-apps') || '{}'); } catch { return {}; } })());
  $effect(() => {
    if (!tv || fake() || tv.state !== 'playing' || !app) return;
    const mine = seen[tv.entity_id] || {};
    if (Date.now() - (mine[app] || 0) < 60000) return;
    seen = { ...seen, [tv.entity_id]: { ...mine, [app]: Date.now() } };
    try { localStorage.setItem('frame-tv-apps', JSON.stringify(seen)); } catch {}
  });
  let apps = $derived.by(() => {
    const mine = (tv && seen[tv.entity_id]) || {};
    return [...((tv && tv.source_list) || [])].sort((a, b) => (mine[b] || 0) - (mine[a] || 0) || a.localeCompare(b));
  });

  let error = $state(null);
  async function run(domain, service, data = {}, target = { entity_id: tv.entity_id }) {
    if (fake()) {
      if (service === 'media_play_pause') demo.state = demo.state === 'playing' ? 'paused' : 'playing';
      if (service === 'turn_off') demo.state = 'off';
      if (service === 'turn_on') demo.state = 'idle';
      if (service === 'select_source') { demo.app_name = data.source; demo.state = 'idle'; }
      const d = target.entity_id === demoBar.entity_id ? demoBar : demo;
      if (service === 'volume_mute') d.is_volume_muted = data.is_volume_muted;
      if (d === demoBar && service === 'volume_up') demoBar.volume_level = Math.min(1, demoBar.volume_level + 0.05);
      if (d === demoBar && service === 'volume_down') demoBar.volume_level = Math.max(0, demoBar.volume_level - 0.05);
      return;
    }
    try { await callService(domain, service, data, target); }
    catch (e) { error = e.message || String(e); setTimeout(() => (error = null), 5000); }
  }
  const key = (k) => keys && !off && run('remote', 'send_command', { command: keys[k] }, { entity_id: tv.remote });
  // Volume in steps and mute, on the TV's soundbar when TV_AUDIO names one (lib/ha.svelte.js),
  // otherwise on the TV where its integration offers them. The soundbar shows its level.
  const FEAT = { VOLUME_MUTE: 8, VOLUME_STEP: 1024 };
  // Sound: Soundbar | TV, beside the volume when TV_AUDIO names a speaker, for nights the soundbar
  // isn't working and the TV's own speakers are on. Remembered per TV.
  let ownSpeakers = $state((() => { try { return JSON.parse(localStorage.getItem('frame-tv-own-speakers') || '[]'); } catch { return []; } })());
  function useOwn(on) {
    ownSpeakers = on ? [...new Set([...ownSpeakers, tv.entity_id])] : ownSpeakers.filter((id) => id !== tv.entity_id);
    try { localStorage.setItem('frame-tv-own-speakers', JSON.stringify(ownSpeakers)); } catch {}
  }
  const demoBar = $state({ entity_id: 'media_player.demo_soundbar', friendly_name: 'Soundbar', supported_features: 1024 | 8, volume_level: 0.2, is_volume_muted: false });
  let speaker = $derived(fake() ? demoBar : tv && tvAudio[tv.entity_id] ? ha.players.find((p) => p.entity_id === tvAudio[tv.entity_id]) : null);
  let audio = $derived((speaker && !ownSpeakers.includes(tv.entity_id) && speaker) || tv);
  let canStep = $derived(!!audio && ((audio.supported_features || 0) & FEAT.VOLUME_STEP) !== 0);
  let canMute = $derived(!!audio && ((audio.supported_features || 0) & FEAT.VOLUME_MUTE) !== 0);
  let level = $derived(audio && audio !== tv && audio.volume_level != null ? Math.round(audio.volume_level * 100) : null);
  const vol = (service, data = {}) => run('media_player', service, data, { entity_id: audio.entity_id });
  // An app tapped while the TV is off turns it on first, then opens the app.
  async function openApp(a) {
    if (off && !fake()) { await run('media_player', 'turn_on'); await new Promise((r) => setTimeout(r, 4000)); }
    run('media_player', 'select_source', { source: a });
  }
  // Back and forward 10 s: the remote's skip buttons when there are some, otherwise a seek.
  function skip(sec) {
    if (keys && keys[sec > 0 ? 'fwd' : 'rew']) return key(sec > 0 ? 'fwd' : 'rew');
    if (position != null) run('media_player', 'media_seek', { seek_position: Math.max(0, position + sec) });
  }

  // Progress, moving between Home Assistant's updates while playing (once a second, only on this view).
  let now = $state(Date.now());
  $effect(() => {
    if (!tv || tv.state !== 'playing') return;
    const t = setInterval(() => (now = Date.now()), 1000);
    return () => clearInterval(t);
  });
  let position = $derived(!tv || tv.media_position == null ? null
    : tv.state === 'playing' ? tv.media_position + (now - Date.parse(tv.media_position_updated_at)) / 1000 : tv.media_position);
  let duration = $derived(tv && tv.media_duration ? tv.media_duration : null);
  const hm = (s) => { s = Math.max(0, Math.round(s)); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60; return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(x).padStart(2, '0'); };
</script>

<div class="wrap">
  {#if !tv}
    <div class="sheet empty">{ha.status === 'connected' ? 'No TVs found in Home Assistant.' : 'Connecting to Home Assistant…'}</div>
  {:else}
    <div class="top" class:noremote={!keys}>
      <section class="sheet now">
        <div class="head">
          <div class="art">{#if art}<img {@attach haImage(art)} alt="" />{:else}<span class="noart" class:demo={fake()}><Icon name="tv" size={48} /></span>{/if}</div>
          <div class="txt">
            {#if app}<div class="app">{app}</div>{/if}
            {#if off}<h1 class="idle">Off</h1>
            {:else if tv.media_title}<h1>{tv.media_title}</h1>{#if tv.media_artist}<p class="sub">{tv.media_artist}</p>{/if}
            {:else}<h1 class="idle">{tv.state === 'playing' ? 'Playing' : 'Nothing playing'}</h1>{/if}
          </div>
        </div>
        {#if duration && !off}
          <div class="progress">
            <div class="bar"><span style="transform:scaleX({Math.min(1, (position || 0) / duration)})"></span></div>
            <div class="times num"><span>{hm(position || 0)}</span><span>-{hm(duration - (position || 0))}</span></div>
          </div>
        {/if}
        <div class="controls">
          <button class="ctl" disabled={off} onclick={() => skip(-10)} aria-label="Back 10 seconds"><Icon name="rewind" size={32} /></button>
          <button class="ctl main" disabled={off} onclick={() => run('media_player', 'media_play_pause')} aria-label={tv.state === 'playing' ? 'Pause' : 'Play'}><Icon name={tv.state === 'playing' ? 'pause' : 'play'} size={40} /></button>
          <button class="ctl" disabled={off} onclick={() => skip(10)} aria-label="Forward 10 seconds"><Icon name="fastForward" size={32} /></button>
          {#if canStep || canMute}
            <span class="vol" role="group" aria-label="Volume">
              {#if canStep}<button class="vbtn" disabled={off} onclick={() => vol('volume_down')} aria-label="Volume down"><Icon name="minus" size={22} /></button>{/if}
              {#if canMute}<button class="vbtn" class:on={audio.is_volume_muted} disabled={off} onclick={() => vol('volume_mute', { is_volume_muted: !audio.is_volume_muted })} aria-label={audio.is_volume_muted ? 'Unmute' : 'Mute'}><Icon name={audio.is_volume_muted ? 'volumeOff' : 'volume'} size={22} /></button>
              {:else}<span class="vlbl"><Icon name="volume" size={22} /></span>{/if}
              {#if canStep}<button class="vbtn" disabled={off} onclick={() => vol('volume_up')} aria-label="Volume up"><Icon name="plus" size={22} /></button>{/if}
              {#if level != null}<span class="lvl num">{level}%</span>{/if}
            </span>
          {/if}
        </div>
        {#if speaker}
          <div class="sound" role="radiogroup" aria-label="Sound from">
            <button role="radio" aria-checked={audio === speaker} class:on={audio === speaker} onclick={() => useOwn(false)}>{nm(speaker.friendly_name) || 'Soundbar'}</button>
            <button role="radio" aria-checked={audio !== speaker} class:on={audio !== speaker} onclick={() => useOwn(true)}>TV speakers</button>
          </div>
        {/if}
        {#if error}<p class="err">{error}</p>{/if}
      </section>

      {#if keys}
        <!-- The TV's own remote, for menus: arrows, OK, back and home. -->
        <section class="sheet remote" class:dim={off} aria-label="Remote">
          <div class="pad">
            <button class="k up" onclick={() => key('up')} aria-label="Up"><Icon name="chevronUp" size={30} /></button>
            <button class="k left" onclick={() => key('left')} aria-label="Left"><Icon name="chevronLeft" size={30} /></button>
            <button class="k ok" onclick={() => key('ok')}>OK</button>
            <button class="k right" onclick={() => key('right')} aria-label="Right"><Icon name="chevronRight" size={30} /></button>
            <button class="k down" onclick={() => key('down')} aria-label="Down"><Icon name="chevronDown" size={30} /></button>
          </div>
          <div class="row">
            <button class="pill" onclick={() => key('back')}><Icon name="chevronLeft" size={20} />Back</button>
            <button class="pill" onclick={() => key('home')}><Icon name="home" size={20} />Home</button>
          </div>
        </section>
      {/if}
    </div>

    {#if apps.length}
      <!-- The TV's apps, recently watched first: one tap opens one. -->
      <section class="apps">
        {#each apps as a (a)}
          <button class="sheet appbtn" class:on={a === app && !off} onclick={() => openApp(a)}>{a}</button>
        {/each}
      </section>
    {/if}
  {/if}

  <section class="sheet tvbar">
    <MediaSwitch />
    {#each tvs as t (t.entity_id)}
      {#if tvs.length > 1}
        <button class="chip" class:on={t === tv} onclick={() => pick(t)}><span class="dot" class:live={t.state === 'playing'}></span>{nm(t.label)}</button>
      {/if}
    {/each}
    {#if tv}
      <button class="power" class:offnow={off} onclick={() => run('media_player', off ? 'turn_on' : 'turn_off')}><Icon name="power" size={22} />{off ? 'Turn on' : 'Turn off'}</button>
    {/if}
  </section>
</div>

<style>
  .wrap { height: 100%; padding: 10px 28px 28px; display: flex; flex-direction: column; gap: 16px; }
  .empty { margin: auto; padding: 40px 48px; font-size: 22px; color: var(--secondary); }
  .top { flex: 1; min-height: 0; display: grid; grid-template-columns: 1fr 340px; gap: 20px; }
  .top.noremote { grid-template-columns: 1fr; }
  .now { min-width: 0; display: flex; flex-direction: column; padding: 24px 28px; }
  .head { display: flex; gap: 22px; min-height: 0; }
  .art { flex: none; width: 300px; aspect-ratio: 16 / 9; border-radius: 14px; overflow: hidden; background: var(--fill); display: grid; place-items: center; }
  .art img { width: 100%; height: 100%; object-fit: cover; }
  .noart { color: var(--tertiary); }
  .noart.demo { width: 100%; height: 100%; display: grid; place-items: center; background: linear-gradient(150deg, #2a9d8f, #264653); color: rgba(255, 255, 255, .8); }
  .txt { min-width: 0; display: flex; flex-direction: column; justify-content: center; }
  .app { font-size: 16px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; color: var(--secondary); }
  h1 { margin: 6px 0 0; font-size: 32px; font-weight: 700; letter-spacing: -.02em; line-height: 1.1; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
  h1.idle { color: var(--secondary); }
  .sub { margin: 6px 0 0; font-size: 20px; color: var(--secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .progress { margin-top: auto; padding-top: 14px; }
  .bar { height: 6px; border-radius: 3px; background: var(--tertiary); overflow: hidden; }
  .bar span { display: block; height: 100%; background: var(--label); transform-origin: 0 50%; }
  .times { display: flex; justify-content: space-between; margin-top: 6px; font-size: 15px; color: var(--secondary); }
  .controls { display: flex; align-items: center; justify-content: center; gap: 36px; margin-top: 10px; }
  .ctl { width: 60px; height: 60px; border-radius: 50%; display: grid; place-items: center; color: var(--label); }
  .ctl.main { width: 76px; height: 76px; background: var(--label); color: var(--sheet); }
  .ctl:disabled { opacity: .35; }
  .ctl:active { opacity: .6; }
  /* Volume, beside the playback controls. */
  .vol { display: flex; align-items: center; gap: 4px; margin-left: 12px; padding: 4px; border-radius: 30px; background: var(--fill); }
  .vbtn, .vlbl { width: 48px; height: 48px; border-radius: 50%; display: grid; place-items: center; color: var(--label); }
  .vlbl { color: var(--secondary); }
  .sound { display: flex; align-self: center; gap: 2px; margin-top: 10px; padding: 3px; border-radius: 12px; background: var(--fill); }
  .sound button { height: 34px; padding: 0 14px; border-radius: 9px; font-size: 15px; font-weight: 500; color: var(--secondary); }
  .sound button.on { background: var(--thumb); color: var(--label); font-weight: 600; }
  .lvl { min-width: 48px; padding-right: 10px; font-size: 17px; font-weight: 600; color: var(--secondary); text-align: center; }
  .vbtn.on { background: var(--thumb); }
  .vbtn:disabled { opacity: .35; }
  .vbtn:active { opacity: .6; }
  /* The TV off: the remote can't do anything. */
  .remote.dim { opacity: .4; pointer-events: none; }
  .err { margin: 8px 0 0; font-size: 15px; color: var(--red-text); text-align: center; }

  .remote { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 18px; padding: 18px; }
  .pad { position: relative; width: 210px; height: 210px; border-radius: 50%; background: var(--fill); }
  .k { position: absolute; display: grid; place-items: center; width: 64px; height: 64px; border-radius: 50%; color: var(--label); }
  .k:active { background: var(--thumb); }
  .up { top: 4px; left: 73px; } .down { bottom: 4px; left: 73px; } .left { left: 4px; top: 73px; } .right { right: 4px; top: 73px; }
  .ok { left: 60px; top: 60px; width: 90px; height: 90px; background: var(--thumb); font-size: 20px; font-weight: 700; }
  .row { display: flex; gap: 12px; }
  .pill { display: inline-flex; align-items: center; gap: 6px; height: 46px; padding: 0 18px; border-radius: 23px; background: var(--fill); font-size: 17px; font-weight: 600; }
  .pill:active { opacity: .6; }

  .apps { flex: none; display: flex; gap: 10px; overflow-x: auto; padding-bottom: 2px; }
  .appbtn { flex: none; height: 54px; padding: 0 22px; border-radius: 16px; font-size: 18px; font-weight: 600; white-space: nowrap; }
  .appbtn.on { box-shadow: inset 0 0 0 2px var(--pal-green); color: var(--label); }
  .appbtn:active { opacity: .7; }

  .tvbar { flex: none; display: flex; align-items: center; gap: 10px; padding: 14px 18px; overflow-x: auto; }
  .chip { display: inline-flex; align-items: center; gap: 8px; height: 50px; padding: 0 20px; border-radius: 25px; background: var(--fill); font-size: 19px; font-weight: 600; white-space: nowrap; }
  .chip.on { background: var(--label); color: var(--sheet); }
  .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--tertiary); }
  .dot.live { background: var(--pal-green); }
  .power { margin-left: auto; display: inline-flex; align-items: center; gap: 8px; height: 50px; padding: 0 20px; border-radius: 25px; background: var(--fill); font-size: 18px; font-weight: 600; white-space: nowrap; }
  .power.offnow { color: var(--label); }
  .power:active { opacity: .6; }
</style>
