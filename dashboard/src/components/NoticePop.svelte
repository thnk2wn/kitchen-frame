<script>
  // A new notice, large, on any screen (lib/noticepop.svelte.js): its icon, title, message and when it
  // started, in its colour, with a chime. It goes by itself after SHOW_MS, shrinking into the bell, and
  // stays unread there; Got it (or a tap outside) closes it and marks notices read; Dismiss removes it in
  // Home Assistant; a tap on the card opens the notices sheet. Several at once share one card.
  // It waits while something more pressing covers the screen: a ringing timer, the doorbell, an agent
  // message, a video.
  import Txt from './Txt.svelte';
  import Icon from './Icon.svelte';
  import { ui, clock, messages, nowVideo } from '../lib/state.svelte.js';
  import { ringing } from '../lib/timers.svelte.js';
  import { bell } from '../lib/doorbell.svelte.js';
  import { markSeen, dismissNotice, iconOf, startedAt } from '../lib/notices.svelte.js';
  import { pop, clearPop, popChime } from '../lib/noticepop.svelte.js';

  const SHOW_MS = 10000;
  const MAX_ROWS = 3;
  let blocked = $derived((messages.items.length > 0 && !ui.demo) || ringing().length > 0 || !!bell.ringing || !!nowVideo.list);
  let show = $derived(pop.list.length > 0 && !blocked);
  let first = $derived(pop.list[0]);
  let leaving = $state(null); // 'fly' (timed out, into the bell) or 'fade'

  // The sheet opening takes over from the card.
  $effect(() => { if (ui.noticesOpen && pop.list.length) clearPop(); });

  // The countdown, from when the card is up, again for each new arrival.
  $effect(() => {
    if (!show || pop.hold) return;
    pop.round;
    const t = setTimeout(() => close('fly'), SHOW_MS);
    return () => clearTimeout(t);
  });

  // The chime, once per arrival, when the card shows.
  let chimed = 0;
  $effect(() => { if (show && pop.round !== chimed) { chimed = pop.round; if (pop.chime) popChime(pop.chime); } });

  function close(how) {
    const round = pop.round;
    leaving = how;
    setTimeout(() => { leaving = null; if (pop.round === round) clearPop(); }, 350);
  }
  const gotIt = () => { markSeen(); close('fade'); };
  const dismiss = () => { for (const n of pop.list) dismissNotice(n.id); close('fade'); };
  const openSheet = () => { ui.noticesOpen = true; };
</script>

{#if show}
  <div class="pop" class:fly={leaving === 'fly'} class:fade={leaving === 'fade'} onclick={gotIt} role="presentation">
    <section class="card {first.tone}" role="alertdialog" aria-label={pop.list.length > 1 ? pop.list.length + ' new notices' : 'New notice'} onclick={(e) => e.stopPropagation()}>
      <button class="body" onclick={openSheet}>
        {#if pop.list.length === 1}
          <span class="ic"><Icon name={iconOf(first)} size={44} /></span>
          <span class="txt">
            <span class="title"><Txt text={first.title || first.message} /></span>
            {#if first.title && first.message}<span class="msg"><Txt text={first.message} /></span>{/if}
            {#if startedAt(first, clock.now)}<span class="at num">{startedAt(first, clock.now)}</span>{/if}
          </span>
        {:else}
          <span class="txt">
            <span class="title">{pop.list.length} new notices</span>
            {#each pop.list.slice(0, MAX_ROWS) as n (n.id)}
              <span class="row"><span class="ri {n.tone}"><Icon name={iconOf(n)} size={22} /></span><span class="rt"><Txt text={n.title || n.message} /></span></span>
            {/each}
            {#if pop.list.length > MAX_ROWS}<span class="at">and {pop.list.length - MAX_ROWS} more</span>{/if}
          </span>
        {/if}
      </button>
      <div class="foot">
        <button class="dismiss" onclick={dismiss}>{pop.list.length > 1 ? 'Dismiss all' : 'Dismiss'}</button>
        <button class="ok" onclick={gotIt}>Got it</button>
      </div>
      {#if !pop.hold}{#key pop.round}<i class="left" style="animation-duration:{SHOW_MS}ms"></i>{/key}{/if}
    </section>
  </div>
{/if}

<style>
  .pop { position: fixed; inset: 0; z-index: 45; display: grid; place-items: center; padding: 48px; background: rgba(0, 0, 0, .5); animation: dim .3s ease-out; transition: opacity .35s; }
  .card { position: relative; width: 100%; max-width: 940px; overflow: hidden; border-radius: 32px; background: var(--orange); color: #fff; animation: rise .35s ease-out; transition: transform .35s ease-in, opacity .35s ease-in; }
  .card.alert { background: var(--red); }
  .card.info { background: var(--blue); }
  .body { display: flex; align-items: flex-start; gap: 24px; width: 100%; padding: 36px 40px 8px; color: inherit; text-align: left; }
  .ic { flex: none; width: 84px; height: 84px; border-radius: 50%; display: grid; place-items: center; background: rgba(255, 255, 255, .22); }
  .txt { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 10px; }
  .title { font-size: 44px; font-weight: 800; letter-spacing: -.02em; line-height: 1.1; overflow-wrap: anywhere; }
  .msg { font-size: 26px; font-weight: 500; line-height: 1.3; overflow-wrap: anywhere; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
  .at { font-size: 19px; font-weight: 600; opacity: .85; }
  /* Several: one row each, its icon in its own colour. */
  .row { display: flex; align-items: center; gap: 12px; padding: 10px 14px; border-radius: 14px; background: rgba(255, 255, 255, .18); font-size: 24px; font-weight: 700; }
  .ri { flex: none; width: 38px; height: 38px; border-radius: 50%; display: grid; place-items: center; background: var(--orange); }
  .ri.alert { background: var(--red); }
  .ri.info { background: var(--blue); }
  .rt { min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .foot { display: flex; justify-content: flex-end; gap: 14px; padding: 18px 40px 34px; }
  .foot button { height: 60px; padding: 0 30px; border-radius: 30px; font-size: 21px; font-weight: 700; }
  .dismiss { background: rgba(255, 255, 255, .2); color: #fff; }
  .ok { background: #fff; color: #1c1c1e; }
  .foot button:active, .body:active { opacity: .7; }
  /* What's left of the countdown, along the bottom edge. */
  .left { position: absolute; left: 0; right: 0; bottom: 0; height: 6px; background: rgba(255, 255, 255, .55); transform-origin: left center; animation: drain linear forwards; }
  /* Timed out: into the bell, top right. */
  .fly { opacity: 0; }
  .fly .card { transform: translate(38vw, -44vh) scale(.06); opacity: 0; }
  .fade .card { transform: scale(.94); opacity: 0; }
  .fade { opacity: 0; }
  @keyframes dim { from { opacity: 0; } }
  @keyframes rise { from { transform: translateY(40px) scale(.96); opacity: 0; } }
  @keyframes drain { from { transform: scaleX(1); } to { transform: scaleX(0); } }
</style>
