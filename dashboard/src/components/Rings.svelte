<script>
  // Three concentric activity rings (move outside, exercise, stand inside). Values are shares of each
  // goal; past 100% the ring stays full (Apple draws a second lap; not worth it at this size).
  // size: px across; light: the darker set of colours for light backgrounds.
  import { RING_COLORS, RING_COLORS_LIGHT } from '../lib/fitness.js';
  let { move = 0, exercise = 0, stand = 0, size = 120, light = false } = $props();
  let colors = $derived(light ? RING_COLORS_LIGHT : RING_COLORS);
  // Ring width and gap scale with the size, like the watch face.
  let w = $derived(size * 0.12);
  let gap = $derived(size * 0.02);
  let rings = $derived([
    { key: 'move', v: move, r: size / 2 - w / 2 },
    { key: 'exercise', v: exercise, r: size / 2 - w * 1.5 - gap },
    { key: 'stand', v: stand, r: size / 2 - w * 2.5 - gap * 2 },
  ]);
</script>

<svg width={size} height={size} viewBox="0 0 {size} {size}" aria-hidden="true">
  {#each rings as ring (ring.key)}
    {@const c = 2 * Math.PI * ring.r}
    {@const v = ring.v == null ? 0 : Math.max(0, Math.min(1, ring.v))}
    <circle cx={size / 2} cy={size / 2} r={ring.r} fill="none" stroke={colors[ring.key]} stroke-opacity=".22" stroke-width={w} />
    {#if v > 0}
      <circle cx={size / 2} cy={size / 2} r={ring.r} fill="none" stroke={colors[ring.key]} stroke-width={w} stroke-linecap="round"
        stroke-dasharray="{c * v} {c}" transform="rotate(-90 {size / 2} {size / 2})" />
    {/if}
  {/each}
</svg>
