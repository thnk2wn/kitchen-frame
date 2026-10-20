<script>
  import { compareText } from '../lib/format.js';
  // Media → Videos: the YouTube videos and playlists chosen in the Worker's YOUTUBE_VIDEOS setting,
  // a row of big thumbnails per group, for kids to pick from. A tap plays it full screen
  // (YouTubePlayer, shown by App over every screen); the tap is also what lets it play with sound.
  import { onMount } from 'svelte';
  import MediaSwitch from '../components/MediaSwitch.svelte';
  import SortButton from '../components/SortButton.svelte';
  import Icon from '../components/Icon.svelte';
  import { nm } from '../lib/demo-media.svelte.js';
  import { videos, loadVideos, nowVideo, videoPlays, videoSort, setVideoSort } from '../lib/state.svelte.js';
  import { loadYouTube, thumb } from '../lib/youtube.js';

  // "4:05", "1:02:30": as YouTube shows a video's length.
  const length = (s) => { const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60; return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(x).padStart(2, '0'); };
  onMount(() => { loadVideos(); loadYouTube().catch(() => {}); });

  // Each group in its order: most recently played on this frame first (the rest in playlist order),
  // or A–Z; narrowed by the filter. A group with nothing matching hides while filtering.
  let filter = $state('');
  const norm = (t) => t.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
  let shown = $derived(videos.groups.map((g) => {
    const words = norm(filter).split(/\s+/).filter(Boolean);
    let list = g.videos.map((v, i) => ({ ...v, i })).filter((v) => words.every((w) => norm(v.title).includes(w)));
    list = videoSort[g.name] === 'az'
      ? list.sort((a, b) => compareText(a.title, b.title, { numeric: true, sensitivity: 'base' }))
      : list.sort((a, b) => (videoPlays[b.id] || 0) - (videoPlays[a.id] || 0) || a.i - b.i);
    return { name: g.name, videos: list };
  }).filter((g) => g.videos.length || !filter.trim()));
</script>

<div class="wrap">
  <div class="groups">
    {#each shown as g (g.name)}
      <section>
        <div class="head">
          <h2>{nm(g.name)}</h2>
          <SortButton az={videoSort[g.name] === 'az'} timeLabel="Most recently played" onchange={(az) => setVideoSort(g.name, az ? 'az' : 'recent')} />
        </div>
        <div class="row">
          {#each g.videos as v, i (v.id)}
            <button class="card" onclick={() => Object.assign(nowVideo, { list: g.videos, index: i, shared: false })}>
              <span class="pic"><img src={thumb(v.id)} alt="" loading="lazy" decoding="async" />{#if v.seconds}<span class="len num">{length(v.seconds)}</span>{/if}</span>
              <span class="t">{v.title}</span>
            </button>
          {/each}
        </div>
      </section>
    {:else}
      <div class="sheet empty">{filter.trim() ? 'Nothing matches “' + filter.trim() + '”.' : 'No videos set up yet (YOUTUBE_VIDEOS; see docs/music.md).'}</div>
    {/each}
  </div>
  <section class="sheet bar">
    <MediaSwitch />
    {#if videos.groups.length}
      <label class="find">
        <Icon name="search" size={20} />
        <input type="search" bind:value={filter} placeholder="Find a video" enterkeyhint="search" />
        {#if filter}<button class="clear" onclick={() => (filter = '')} aria-label="Clear"><Icon name="close" size={18} /></button>{/if}
      </label>
    {/if}
  </section>
</div>


<style>
  .wrap { height: 100%; padding: 10px 28px 28px; display: flex; flex-direction: column; gap: 16px; }
  .groups { flex: 1; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 22px; }
  .head { display: flex; align-items: center; gap: 12px; margin: 0 0 10px; }
  h2 { margin: 0; font-size: 26px; font-weight: 800; }
  .find { margin-left: auto; display: flex; align-items: center; gap: 8px; height: 50px; width: 360px; padding: 0 14px; border-radius: 14px; background: var(--fill); color: var(--secondary); }
  .find input { flex: 1; min-width: 0; border: 0; background: transparent; font: inherit; font-size: 19px; color: var(--label); outline: none; }
  .find input::-webkit-search-cancel-button { display: none; }
  .clear { width: 36px; height: 36px; border-radius: 50%; display: grid; place-items: center; color: var(--secondary); }
  /* One row per group, scrolled sideways: big cards a small finger can hit. */
  .row { display: flex; gap: 16px; overflow-x: auto; padding-bottom: 6px; }
  .card { flex: none; width: 300px; text-align: left; display: flex; flex-direction: column; gap: 8px; }
  .pic { position: relative; display: block; }
  .card img { display: block; width: 300px; height: 169px; object-fit: cover; border-radius: 16px; background: var(--fill); }
  .len { position: absolute; right: 8px; bottom: 8px; padding: 2px 8px; border-radius: 8px; background: rgba(0, 0, 0, .78); color: #fff; font-size: 16px; font-weight: 700; }
  .t { font-size: 17px; font-weight: 600; line-height: 1.25; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
  .card:active { opacity: .7; }
  .empty { margin: auto; padding: 40px 48px; font-size: 22px; color: var(--secondary); }
  .bar { flex: none; display: flex; align-items: center; gap: 10px; padding: 14px 18px; }
</style>
