<script>
  import { onMount } from 'svelte';
  import Icon from './components/Icon.svelte';
  import Home from './views/Home.svelte';
  import Week from './views/Week.svelte';
  import List from './views/List.svelte';
  import Ambient from './views/Ambient.svelte';
  import Settings from './components/Settings.svelte';
  import Music from './views/Music.svelte';
  import TV from './views/TV.svelte';
  import Videos from './views/Videos.svelte';
  import YouTubePlayer from './components/YouTubePlayer.svelte';
  // YouTube's player script, loaded early once videos are set up, so a video shared from a phone starts fast.
  import { loadYouTube } from './lib/youtube.js';
  import Recipes from './views/Recipes.svelte';
  import Message from './components/Message.svelte';
  import Timers from './components/Timers.svelte';
  import TimerAlert from './components/TimerAlert.svelte';
  import WeatherSheet from './components/WeatherSheet.svelte';
  import EventSheet from './components/EventSheet.svelte';
  import TaskSheet from './components/TaskSheet.svelte';
  import UndoToast from './components/UndoToast.svelte';
  import DoorbellAlert from './components/DoorbellAlert.svelte';
  import NoticeSheet from './components/NoticeSheet.svelte';
  import SharedMedia from './components/SharedMedia.svelte';
  import NowPlaying from './components/NowPlaying.svelte';
  import PinPad from './components/PinPad.svelte';
  import { shown } from './lib/pending.svelte.js';
  import { unread } from './lib/notices.svelte.js';
  let fresh = $derived(unread()); // new notices since the sheet was last opened (the bell's badge)
  import { timers } from './lib/timers.svelte.js';
  import { connectHA, haConfigured, haDashboard, nowPlaying } from './lib/ha.svelte.js';
  import House from './views/House.svelte';
  import { ui, clock, weather, photos, messages, start, startSlideshow, loadList, photosVisible, videos, loadVideos, nowVideo } from './lib/state.svelte.js';
  import { noteAlbum, prepare } from './lib/slides.js';
  import { fakeMedia, loadDemoMedia } from './lib/demo-media.svelte.js';
  import { podcasts, loadPodcasts } from './lib/podcasts.svelte.js';
  import Podcasts from './views/Podcasts.svelte';
  import './lib/alexa-heard.svelte.js'; // what each Echo heard, for the status page's Alexa log
  import { time, clockTime, weatherInfo } from './lib/format.js';

  // Reactive: Media also appears when YouTube videos are set up (Media → Videos needs no Home Assistant).
  let TABS = $derived([
    { id: 'home', label: 'Home' },
    { id: 'calendar', label: 'Calendar' },
    // Groceries and Tasks share one tab with a switch inside; it reopens the list used last.
    { id: 'lists', label: 'Lists', views: ['groceries', 'todo'] },
    { id: 'recipes', label: 'Recipes' },
    // Media (music, and TVs when Home Assistant has any) appears once the frame has a Home Assistant
    // token (see docs/frame.md). Its id stays 'music' so older links and settings keep working.
    ...(haConfigured() || ui.demo || videos.groups.length || podcasts.shows.length ? [{ id: 'music', label: 'Media' }] : []), // demo: an invented player
    // House mirrors a Home Assistant dashboard, once the frame has its URL path (frame-ha-dashboard).
    ...((haConfigured() && haDashboard()) || ui.demo ? [{ id: 'house', label: 'House' }] : []), // demo: an invented house
  ]);
  let wx = $derived(weather.data);
  let info = $derived(wx ? weatherInfo(wx.code, wx.day) : null);

  // Speculative photo downloads wait until the first screen's data has had the slow Wi-Fi to itself.
  let warm = $state(false);
  onMount(() => { start(); loadPodcasts(); setInterval(loadPodcasts, 15 * 60 * 1000); loadVideos().then(() => { if (videos.groups.length) setTimeout(() => loadYouTube().catch(() => {}), 20000); }); connectHA(); setTimeout(() => (warm = true), 15000); });

  // Keep the next slideshow slide downloaded in the background, so play/idle shows photos at once.
  $effect(() => {
    noteAlbum(photos.items);
    if (warm && photosVisible()) prepare();
  });

  // The Lists tab reopens whichever list was shown last.
  const lastList = () => (localStorage.getItem('frame-list') === 'todo' ? 'todo' : 'groceries');
  $effect(() => { if (ui.tab === 'groceries' || ui.tab === 'todo') localStorage.setItem('frame-list', ui.tab); });

  // A list tab shows fresh items when opened (Groceries isn't polled while it's closed).
  $effect(() => { if (ui.tab === 'groceries' || ui.tab === 'todo') loadList(ui.tab); else if (ui.tab === 'home') loadList('groceries'); });
  // Demo mode shows the Music tab's invented song (no cover art: a music note).
  // Demo mode without Home Assistant: an invented song (with it, the real one: lib/demo-media.svelte.js).
  $effect(() => { if (ui.demo) loadDemoMedia(); });
  const DEMO_NP = { entity_id: 'media_player.spotify_demo', state: 'playing', media_title: 'Golden Hour', media_artist: 'The Lanterns', media_playlist: 'Sunday Morning' };
  let playing = $derived(fakeMedia() ? DEMO_NP : shown(nowPlaying({ hold: true, now: clock.now.getTime() })));
  let mini = $derived(!!playing && ui.tab !== 'home' && ui.tab !== 'music');
</script>

<div class="stage">
  <header class="top">
    <nav class="seg" role="tablist" aria-label="Sections">
      {#each TABS as t (t.id)}
        {@const on = t.views ? t.views.includes(ui.tab) : ui.tab === t.id}
        <button role="tab" aria-selected={on} class:on onclick={() => (ui.tab = t.views ? (on ? ui.tab : lastList()) : t.id)}>{t.label}</button>
      {/each}
    </nav>
    <!-- Now playing, mini, between the tabs and the controls; Home has its own card and Music the
         player (clock.now re-checks the 30-minute hold after pausing every minute). -->
    {#if mini}<div class="np-slot"><NowPlaying player={playing} /></div>{/if}
    <div class="edge right">
      <Timers />
      <!-- The bell, on every tab: a badge counts what's new since the notices were last opened, in
           the most urgent one's colour. -->
      <button class="gear bell" onclick={() => (ui.noticesOpen = true)} aria-label={fresh.length ? fresh.length + ' new notices' : 'Notices'}>
        <Icon name="bell" size={26} />{#if fresh.length}<b class="badge {fresh[0].tone}">{fresh.length}</b>{/if}
      </button>
      <!-- The time gives way when a timer and the music both need the room, and drops AM/PM beside the music. -->
      {#if ui.tab !== 'home' && !(timers.list.some((t) => !t.done) && mini)}<span class="num now">{mini ? clockTime(clock.now) : time(clock.now)}</span>{/if}
      <!-- While a timer runs its chip takes this space; Home still shows the weather. -->
      {#if wx && !timers.list.some((t) => !t.done)}<button class="wxbtn" onclick={() => (ui.weatherDay = 0)} aria-label="Weather details"><span class="wx {info.tint}"><Icon name={info.icon} size={26} /></span><span class="num">{wx.temp}°</span></button>{/if}
      <!-- The slideshow button gives way to a running timer or the music (otherwise there'd be no room). -->
      {#if !timers.list.some((t) => !t.done) && !mini}<button class="gear play" onclick={startSlideshow} aria-label="Start slideshow"><Icon name="play" size={24} /></button>{/if}
      <button class="gear" onclick={() => (ui.settingsOpen = !ui.settingsOpen)} aria-label="Settings"><Icon name="gear" size={26} /></button>
    </div>
  </header>

  <!-- Only the active view exists in the DOM, and none behind the clock screen: less to style, lay
       out, update every minute and keep in memory. -->
  <main class="view">
    {#if !ui.idle}
    {#if ui.tab === 'home'}<Home {playing} />
    {:else if ui.tab === 'calendar'}<Week />
    {:else if ui.tab === 'music'}{#if ui.media === 'tv'}<TV />{:else if ui.media === 'podcasts'}<Podcasts />{:else if ui.media === 'videos' || !haConfigured()}<Videos />{:else}<Music />{/if}
    {:else if ui.tab === 'house'}<House />
    {:else if ui.tab === 'recipes'}<Recipes />
    {:else if ui.tab === 'groceries'}<List name="groceries" title="Groceries" accent="var(--orange)" accentText="var(--orange-text)" />
    {:else}<List name="todo" title="Tasks" accent="var(--blue)" accentText="var(--blue-text)" board />{/if}
    {/if}
  </main>

  {#if ui.settingsOpen && !ui.idle}<Settings />{/if}
  {#if ui.idle}<Ambient />{/if}
  <!-- Agent messages cover everything, the slideshow included; held back in demo mode. -->
  {#if messages.items.length && !ui.demo}<Message />{/if}
  <!-- Timer alerts cover everything, messages and the slideshow included. -->
  <WeatherSheet />
  <EventSheet />
  <TaskSheet />
  <UndoToast />
  <NoticeSheet />
  <TimerAlert />
  <PinPad />
  <DoorbellAlert />
  <!-- A YouTube video, over every screen: from Media → Videos, or shared from a phone. -->
  <SharedMedia />
  {#if nowVideo.list}{#key nowVideo.list}<YouTubePlayer list={nowVideo.list} index={nowVideo.index} startMuted={nowVideo.shared} onclose={() => (nowVideo.list = null)} />{/key}{/if}
</div>

<style>
  /* Fills the viewport: 1280×720 on the 1920×1080 FRAME156 (shown at 1.5×), 1280×800 on 10" frames. */
  .stage { position: relative; width: 100vw; height: 100vh; display: flex; flex-direction: column; overflow: hidden; }
  /* Tabs from the left edge; time, weather and buttons on the right. */
  .top { flex: none; display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 18px 28px 14px; }
  .np-slot { flex: none; display: flex; justify-content: center; }
  .edge { font-size: 22px; font-weight: 600; display: flex; align-items: center; gap: 8px; }
  .right { justify-content: flex-end; }
  .now { margin-right: 14px; white-space: nowrap; }
  .wx { color: var(--secondary); }
  /* Not the gear's tuck to the right: with a badge it would touch the time beside it. */
  .gear.bell { position: relative; margin-right: 8px; }
  .badge { position: absolute; top: 2px; right: 0; min-width: 22px; height: 22px; padding: 0 6px; border-radius: 11px; display: grid; place-items: center; background: var(--orange); color: #fff; font-size: 14px; font-weight: 800; line-height: 1; }
  .badge.alert { background: var(--red); }
  .badge.info { background: var(--blue); }
  .wxbtn { display: flex; align-items: center; gap: inherit; font: inherit; color: inherit; }
  .wxbtn:active { opacity: .6; }
  .wx.sun { color: var(--yellow); }
  .wx.rain { color: var(--blue); }
  .gear { width: 48px; height: 48px; margin: 0 -10px 0 0; border-radius: 50%; display: grid; place-items: center; color: var(--secondary); }
  .gear:active { background: var(--track); }
  .play { margin-left: 6px; margin-right: -4px; }

  /* Segmented control: a grey track with the selected segment as a raised sheet. */
  .seg { display: flex; padding: 3px; border-radius: 15px; background: var(--track); }
  .seg button { min-width: 124px; height: 48px; padding: 0 18px; border-radius: 12px; font-size: 18px; font-weight: 500; text-align: center; color: var(--label); }
  .seg button.on { background: var(--thumb); font-weight: 600; }
  .seg button:not(.on):active { opacity: .5; }
  .view { flex: 1; min-height: 0; }
</style>
