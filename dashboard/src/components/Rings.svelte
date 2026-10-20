<script>
  // Three concentric activity rings (move outside, exercise, stand inside). Values are shares of each
  // goal; past 100% the ring stays full (Apple draws a second lap; not worth it at this size).
  // size: px across; light: the darker set of colours for light backgrounds.
  // When all three are closed a check sits in the middle; celebrate: also a bounce and a glow fading
  //   out, three times (the Fitness tab, as it appears). pulse: a ring ('move', 'exercise' or
  //   'stand') that pulses for about 8 s, the one furthest behind. Animations are transform and
  //   opacity only, and end; the views replay them now and then (lib/fitness.js replayBeat).
  import { RING_COLORS, RING_COLORS_LIGHT } from '../lib/fitness.js';
  let { move = 0, exercise = 0, stand = 0, size = 120, light = false, celebrate = false, pulse = null } = $props();
  let colors = $derived(light ? RING_COLORS_LIGHT : RING_COLORS);
  // Ring width and gap scale with the size, like the watch face.
  let w = $derived(size * 0.12);
  let gap = $derived(size * 0.02);
  let rings = $derived([
    { key: 'move', v: move, r: size / 2 - w / 2 },
    { key: 'exercise', v: exercise, r: size / 2 - w * 1.5 - gap },
    { key: 'stand', v: stand, r: size / 2 - w * 2.5 - gap * 2 },
  ]);
  let done = $derived(move >= 1 && exercise >= 1 && stand >= 1);
  // The check fills the middle, inside the stand ring.
  let hole = $derived(size / 2 - w * 3 - gap * 2);
</script>

<span class="rings" class:celebrate={celebrate && done} style="width:{size}px;height:{size}px">
  {#if celebrate && done}<span class="glow" style="border-color:{colors.move}"></span>{/if}
  <svg width={size} height={size} viewBox="0 0 {size} {size}" aria-hidden="true">
    {#each rings as ring (ring.key)}
      {@const c = 2 * Math.PI * ring.r}
      {@const v = ring.v == null ? 0 : Math.max(0, Math.min(1, ring.v))}
      <g class:pulse={pulse === ring.key}>
        <circle cx={size / 2} cy={size / 2} r={ring.r} fill="none" stroke={colors[ring.key]} stroke-opacity=".22" stroke-width={w} />
        {#if v > 0}
          <circle cx={size / 2} cy={size / 2} r={ring.r} fill="none" stroke={colors[ring.key]} stroke-width={w} stroke-linecap="round"
            stroke-dasharray="{c * v} {c}" transform="rotate(-90 {size / 2} {size / 2})" />
        {/if}
      </g>
    {/each}
    {#if done && hole > 6}
      <path d="M {size / 2 - hole * 0.45} {size / 2 + hole * 0.02} L {size / 2 - hole * 0.1} {size / 2 + hole * 0.36} L {size / 2 + hole * 0.48} {size / 2 - hole * 0.32}"
        fill="none" stroke={colors.exercise} stroke-width={Math.max(2, hole * 0.22)} stroke-linecap="round" stroke-linejoin="round" />
    {/if}
  </svg>
</span>

<style>
  .rings { position: relative; display: inline-block; flex: none; }
  svg { display: block; }
  .celebrate svg { animation: bounce 1.2s ease-out 3; }
  .glow { position: absolute; inset: 0; border-radius: 50%; border: 4px solid; opacity: 0; animation: glow 1.2s ease-out .2s 3; }
  @keyframes bounce { 0% { transform: scale(.92); } 45% { transform: scale(1.06); } 100% { transform: scale(1); } }
  @keyframes glow { 0% { transform: scale(1); opacity: .7; } 100% { transform: scale(1.3); opacity: 0; } }
  .pulse { animation: ring-pulse 1.4s ease-in-out 6; }
  @keyframes ring-pulse { 0%, 100% { opacity: 1; } 50% { opacity: .35; } }
</style>
