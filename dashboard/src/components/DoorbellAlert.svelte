<script>
  // Full screen when a doorbell rings (lib/doorbell.svelte.js): live video once it starts, the
  // latest snapshot until then. Closes itself after a while, or on Dismiss.
  import Icon from './Icon.svelte';
  import { bell, dismiss, startLive } from '../lib/doorbell.svelte.js';
  import { haUrl } from '../lib/ha.svelte.js';
  import { time } from '../lib/format.js';

  let d = $derived(bell.ringing);
  let video = $state();
  let live = $state(false);
  let muted = $state(true);

  // The still: its entity_picture carries a rotating token, and a new snapshot bumps the timestamp.
  let still = $derived.by(() => {
    if (!d || !d.still) return null;
    const s = bell.states[d.still];
    const pic = s && s.attributes && s.attributes.entity_picture;
    return pic ? haUrl(pic) + '&t=' + (s.attributes.timestamp || s.attributes.access_token || '') : null;
  });

  // Start the live view when a ring opens the pop-up; stop it when it closes.
  $effect(() => {
    if (!d || !d.live || !video) return;
    let stop = null, gone = false;
    live = false;
    startLive(d.live, video, () => (live = true))
      .then((s) => { if (gone) s && s(); else stop = s; })
      .catch((e) => console.error('doorbell live view', e));
    return () => { gone = true; live = false; muted = true; if (stop) stop(); };
  });
</script>

{#if d}
  <div class="door" role="alertdialog" aria-label="{d.name} doorbell">
    <div class="media">
      {#if still}<img src={still} alt="" class:hide={live} />{/if}
      {#if !still && !live}<div class="wait"><Icon name="camera" size={56} /></div>{/if}
      <!-- svelte-ignore a11y_media_has_caption -->
      <video bind:this={video} {muted} autoplay playsinline class:hide={!live}></video>
    </div>
    <div class="bar">
      <span class="ic"><Icon name="bell" size={28} /></span>
      <div class="txt">
        <div class="title">{d.name}</div>
        <div class="sub">{d.test ? 'Test ring' : 'Someone’s at the door'} · {time(new Date(d.at))}{#if d.live && !live} · connecting…{/if}</div>
      </div>
      {#if live}
        <button class="snd" onclick={() => (muted = !muted)} aria-label={muted ? 'Sound on' : 'Sound off'}>
          <Icon name={muted ? 'volumeOff' : 'volume'} size={24} />{muted ? 'Sound' : 'Mute'}
        </button>
      {/if}
      <button class="done" onclick={dismiss}>Dismiss</button>
    </div>
  </div>
{/if}

<style>
  .door { position: fixed; inset: 0; z-index: 60; background: #000; display: flex; flex-direction: column; }
  .media { position: relative; flex: 1; min-height: 0; }
  img, video { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; background: #000; }
  .hide { opacity: 0; }
  .wait { position: absolute; inset: 0; display: grid; place-items: center; color: rgba(255, 255, 255, .4); }
  .bar { flex: none; display: flex; align-items: center; gap: 16px; padding: 14px 24px; background: #1c1c1e; color: #fff; }
  .ic { flex: none; width: 52px; height: 52px; border-radius: 50%; display: grid; place-items: center; background: var(--orange); }
  .txt { flex: 1; min-width: 0; }
  .title { font-size: 26px; font-weight: 800; letter-spacing: -.01em; }
  .sub { font-size: 17px; color: rgba(255, 255, 255, .7); }
  .bar button { height: 56px; padding: 0 26px; border-radius: 28px; font-size: 20px; font-weight: 700; display: flex; align-items: center; gap: 8px; }
  .snd { background: rgba(255, 255, 255, .16); color: #fff; }
  .done { background: var(--orange); color: #fff; }
  .bar button:active { opacity: .7; }
</style>
